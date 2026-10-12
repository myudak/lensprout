import type { BackgroundMotion } from '../domain/model';
import { projectPoint, shade, type Mesh, type Quad } from './stage';

/**
 * WebGL2 compositor for the 3D stage, used by both the editor preview and the export worker (an
 * OffscreenCanvas works in both). It draws a background (with optional motion), a soft shadow and
 * the device meshes through a pinhole camera with a depth buffer. Perspective-correct texturing
 * comes from passing w per vertex; solids are lit per vertex. Several poses are averaged for 3D
 * motion blur.
 */
export type StagePose = {
  meshes: Mesh[];
  shadow: Quad | null;
  shadowAlpha: number;
  /** Glare band position across the screen glass (moves with the turn). */
  glare: number;
  eye: number;
  focal: number;
  center: { x: number; y: number };
};
export type StageSource = {
  source: TexImageSource;
  /** Static textures upload again only when the key changes; null uploads every frame. */
  key: string | null;
};
export type StageDraw = {
  width: number;
  height: number;
  background: StageSource | null;
  motion: BackgroundMotion;
  timeSec: number;
  poses: StagePose[];
  textures: Record<string, StageSource>;
};

const MESH_VS = `#version 300 es
in vec4 a_pos; in vec2 a_uv; in vec4 a_shade; out vec2 v_uv; out vec4 v_shade;
void main(){ v_uv = a_uv; v_shade = a_shade; gl_Position = a_pos; }`;
const MESH_FS = `#version 300 es
precision highp float;
in vec2 v_uv; in vec4 v_shade; out vec4 o;
uniform sampler2D u_tex; uniform float u_alpha; uniform float u_glass; uniform float u_glare;
void main(){
  vec4 c = texture(u_tex, v_uv);
  float glare = u_glass * 0.07 * max(0.0, 1.0 - abs(dot(v_uv, vec2(0.7, 0.3)) - u_glare) * 3.0);
  o = vec4(c.rgb * v_shade.rgb + (v_shade.a + glare) * c.a, c.a) * u_alpha;
}`;
const BLIT_FS = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o; uniform sampler2D u_tex; uniform float u_alpha;
void main(){ o = texture(u_tex, v_uv) * u_alpha; }`;
const BG_FS = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_tex; uniform int u_mode; uniform float u_t; uniform vec2 u_res;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
vec2 zoomed(vec2 uv, float z, vec2 pan){ return (uv - 0.5) / z + 0.5 + pan; }
void main(){
  float t = u_t; vec2 uv = v_uv;
  if (u_mode == 0) { o = texture(u_tex, uv); return; }
  if (u_mode == 1) {
    float z = 1.12 + 0.05 * sin(6.2831853 * t / 20.0);
    vec2 pan = 0.03 * vec2(sin(6.2831853 * t / 27.0), cos(6.2831853 * t / 23.0));
    o = texture(u_tex, zoomed(uv, z, pan)); return;
  }
  if (u_mode == 3) {
    vec2 q = zoomed(uv, 1.08, vec2(0.0));
    float a = sin(q.x * 6.0 + q.y * 4.0 + t * 0.9), b = sin(-q.x * 3.0 + q.y * 7.0 - t * 0.7);
    o = texture(u_tex, q + 0.012 * vec2(a, b)); return;
  }
  vec2 q = zoomed(uv, 1.1, vec2(0.0));
  vec2 flow = vec2(noise(q * 3.0 + vec2(t * 0.15, 0.0)), noise(q * 3.0 + vec2(5.2, t * 0.12))) - 0.5;
  vec3 base = texture(u_tex, q + flow * 0.06).rgb, light = vec3(0.0);
  float aspect = u_res.x / u_res.y;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 c = vec2(0.5 + 0.35 * sin(t * 0.21 + fi * 2.1), 0.5 + 0.3 * cos(t * 0.17 + fi * 1.7));
    vec3 col = texture(u_tex, clamp(c, 0.0, 1.0)).rgb;
    vec2 d = (uv - c) * vec2(aspect, 1.0);
    light += col * exp(-dot(d, d) / 0.08) * 0.55;
  }
  o = vec4(clamp(base * 0.85 + light, 0.0, 1.0), 1.0);
}`;
const FULL_VS = `#version 300 es
in vec2 a_xy; out vec2 v_uv; uniform int u_flip;
void main(){ v_uv = u_flip == 1 ? (a_xy + 1.0) * 0.5 : vec2((a_xy.x + 1.0) * 0.5, (1.0 - a_xy.y) * 0.5); gl_Position = vec4(a_xy, 0.0, 1.0); }`;
const MOTION_MODES = { none: 0, drift: 1, aurora: 2, waves: 3 } as const;
type Shade = [number, number, number, number];

/** Null when WebGL2 is unavailable; callers then use the flat path. */
export function createStageRenderer(canvas: OffscreenCanvas = new OffscreenCanvas(2, 2)) {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: true,
    depth: true,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
  }) as WebGL2RenderingContext | null;
  if (!gl) return null;
  const compile = (vs: string, fs: string) => {
    const program = gl.createProgram()!;
    for (const [type, src] of [
      [gl.VERTEX_SHADER, vs],
      [gl.FRAGMENT_SHADER, fs],
    ] as const) {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new Error(`Stage shader failed: ${gl.getShaderInfoLog(shader)}`);
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(`Stage program failed: ${gl.getProgramInfoLog(program)}`);
    return program;
  };
  const meshProgram = compile(MESH_VS, MESH_FS),
    bgProgram = compile(FULL_VS, BG_FS),
    blitProgram = compile(FULL_VS, BLIT_FS);
  const meshBuffer = gl.createBuffer()!,
    fullBuffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, fullBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const newTexture = () => {
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const white = newTexture();
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([255, 255, 255, 255]),
  );
  const textures = new Map<string, { texture: WebGLTexture; key: string | null }>();
  const texture = (name: string, s: StageSource) => {
    let entry = textures.get(name);
    if (!entry) {
      entry = { texture: newTexture(), key: '\u0000' };
      textures.set(name, entry);
    }
    gl.bindTexture(gl.TEXTURE_2D, entry.texture);
    if (s.key === null || s.key !== entry.key) {
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, s.source);
      entry.key = s.key;
    }
    return entry.texture;
  };
  // Motion blur: a multisampled layer (color + depth) resolved into a texture, and an accumulator.
  const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) as number);
  type Target = { fbo: WebGLFramebuffer; texture: WebGLTexture };
  let targets: {
    msFbo: WebGLFramebuffer;
    msColor: WebGLRenderbuffer;
    msDepth: WebGLRenderbuffer;
    layer: Target;
    acc: Target;
  } | null = null;
  let targetSize = '';
  const textureTarget = (w: number, h: number): Target => {
    const t = newTexture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return { fbo, texture: t };
  };
  const freeTargets = () => {
    if (!targets) return;
    gl.deleteFramebuffer(targets.msFbo);
    gl.deleteRenderbuffer(targets.msColor);
    gl.deleteRenderbuffer(targets.msDepth);
    for (const t of [targets.layer, targets.acc]) {
      gl.deleteFramebuffer(t.fbo);
      gl.deleteTexture(t.texture);
    }
    targets = null;
  };
  const ensureTargets = (w: number, h: number) => {
    if (targets && targetSize === `${w}x${h}`) return targets;
    freeTargets();
    const msFbo = gl.createFramebuffer()!,
      msColor = gl.createRenderbuffer()!,
      msDepth = gl.createRenderbuffer()!;
    gl.bindRenderbuffer(gl.RENDERBUFFER, msColor);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, w, h);
    gl.bindRenderbuffer(gl.RENDERBUFFER, msDepth);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, msFbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, msColor);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, msDepth);
    targets = { msFbo, msColor, msDepth, layer: textureTarget(w, h), acc: textureTarget(w, h) };
    targetSize = `${w}x${h}`;
    return targets;
  };
  const fullscreen = (program: WebGLProgram, flip: boolean) => {
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, fullBuffer);
    const loc = gl.getAttribLocation(program, 'a_xy');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1i(gl.getUniformLocation(program, 'u_flip'), flip ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  const blit = (source: WebGLTexture) => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, source);
    gl.useProgram(blitProgram);
    gl.uniform1i(gl.getUniformLocation(blitProgram, 'u_tex'), 0);
    gl.uniform1f(gl.getUniformLocation(blitProgram, 'u_alpha'), 1);
    fullscreen(blitProgram, true);
  };
  const at = {
    pos: gl.getAttribLocation(meshProgram, 'a_pos'),
    uv: gl.getAttribLocation(meshProgram, 'a_uv'),
    shade: gl.getAttribLocation(meshProgram, 'a_shade'),
    tex: gl.getUniformLocation(meshProgram, 'u_tex'),
    alpha: gl.getUniformLocation(meshProgram, 'u_alpha'),
    glass: gl.getUniformLocation(meshProgram, 'u_glass'),
    glare: gl.getUniformLocation(meshProgram, 'u_glare'),
  };
  /** Draws triangles: positions are world points; shade is an rgb multiplier plus a sheen. */
  const drawTriangles = (
    d: StageDraw,
    pose: StagePose,
    points: { p: [number, number, number]; uv: [number, number]; shade: Shade }[],
  ) => {
    // Hyperbolic NDC depth from the eye distance (near/far bracket the device).
    const near = pose.eye * 0.15,
      far = pose.eye * 4,
      a = (far + near) / (far - near),
      b = (2 * far * near) / (far - near);
    const data = new Float32Array(points.length * 10);
    points.forEach((v, i) => {
      const q = projectPoint(v.p, pose.eye, pose.center, pose.focal),
        dist = pose.eye - v.p[2];
      const nx = (q.x / d.width) * 2 - 1,
        ny = 1 - (q.y / d.height) * 2;
      data.set(
        [nx * q.w, ny * q.w, (a * dist - b) / pose.focal, q.w, v.uv[0], v.uv[1], ...v.shade],
        i * 10,
      );
    });
    gl.bindBuffer(gl.ARRAY_BUFFER, meshBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STREAM_DRAW);
    gl.enableVertexAttribArray(at.pos);
    gl.enableVertexAttribArray(at.uv);
    gl.enableVertexAttribArray(at.shade);
    gl.vertexAttribPointer(at.pos, 4, gl.FLOAT, false, 40, 0);
    gl.vertexAttribPointer(at.uv, 2, gl.FLOAT, false, 40, 16);
    gl.vertexAttribPointer(at.shade, 4, gl.FLOAT, false, 40, 24);
    gl.drawArrays(gl.TRIANGLES, 0, points.length);
  };
  const drawPose = (d: StageDraw, pose: StagePose) => {
    gl.useProgram(meshProgram);
    gl.uniform1i(at.tex, 0);
    gl.activeTexture(gl.TEXTURE0);
    // Shadow first, behind everything, without depth.
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    if (pose.shadow && pose.shadowAlpha > 0 && d.textures.shadow) {
      texture('shadow', d.textures.shadow);
      gl.uniform1f(at.alpha, pose.shadowAlpha);
      gl.uniform1f(at.glass, 0);
      const uvs: [number, number][] = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ];
      drawTriangles(
        d,
        pose,
        [0, 1, 2, 0, 2, 3].map((i) => ({ p: pose.shadow![i]!, uv: uvs[i]!, shade: [1, 1, 1, 0] })),
      );
    }
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.uniform1f(at.alpha, 1);
    for (const mesh of pose.meshes) {
      const m = mesh.material;
      let shadeOf: (n: [number, number, number]) => Shade;
      if (m.kind === 'texture') {
        const source = d.textures[m.name];
        if (!source) continue;
        texture(m.name, source);
        // The screen glows on its own; the keyboard deck is lit like the metal around it.
        shadeOf = m.name === 'face' ? () => [1, 1, 1, 0] : (n) => [...shade(n, [1, 1, 1], 0.25), 0];
        gl.uniform1f(at.glass, m.name === 'face' ? 1 : 0);
        gl.uniform1f(at.glare, pose.glare);
      } else {
        gl.bindTexture(gl.TEXTURE_2D, white);
        shadeOf = (n) => [...shade(n, m.color, m.shine), 0];
        gl.uniform1f(at.glass, 0);
      }
      drawTriangles(
        d,
        pose,
        mesh.tris.map((v) => ({ p: v.p, uv: v.uv, shade: shadeOf(v.n) })),
      );
    }
    gl.disable(gl.DEPTH_TEST);
  };

  return {
    canvas,
    draw(d: StageDraw) {
      if (canvas.width !== d.width || canvas.height !== d.height) {
        canvas.width = d.width;
        canvas.height = d.height;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, d.width, d.height);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.depthMask(true);
      gl.clearColor(0, 0, 0, 1);
      gl.clearDepth(1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (d.background) {
        gl.activeTexture(gl.TEXTURE0);
        texture('background', d.background);
        gl.useProgram(bgProgram);
        gl.uniform1i(gl.getUniformLocation(bgProgram, 'u_tex'), 0);
        gl.uniform1i(gl.getUniformLocation(bgProgram, 'u_mode'), MOTION_MODES[d.motion.kind]);
        gl.uniform1f(gl.getUniformLocation(bgProgram, 'u_t'), d.timeSec * d.motion.speed);
        gl.uniform2f(gl.getUniformLocation(bgProgram, 'u_res'), d.width, d.height);
        fullscreen(bgProgram, false);
      }
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      if (d.poses.length === 1) {
        drawPose(d, d.poses[0]!);
        return canvas;
      }
      // Motion blur: average the device layers across poses (A ← A·(1−w) + B·w, w = 1/(i+1)).
      const t = ensureTargets(d.width, d.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.acc.fbo);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      d.poses.forEach((pose, i) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, t.msFbo);
        gl.depthMask(true);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        drawPose(d, pose);
        // Resolve the multisampled layer, then fold it into the average.
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, t.msFbo);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, t.layer.fbo);
        gl.blitFramebuffer(
          0,
          0,
          d.width,
          d.height,
          0,
          0,
          d.width,
          d.height,
          gl.COLOR_BUFFER_BIT,
          gl.NEAREST,
        );
        gl.bindFramebuffer(gl.FRAMEBUFFER, t.acc.fbo);
        gl.blendColor(0, 0, 0, 1 / (i + 1));
        gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
        blit(t.layer.texture);
      });
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      blit(t.acc.texture);
      return canvas;
    },
    dispose() {
      for (const { texture: t } of textures.values()) gl.deleteTexture(t);
      gl.deleteTexture(white);
      freeTargets();
      gl.deleteBuffer(meshBuffer);
      gl.deleteBuffer(fullBuffer);
      [meshProgram, bgProgram, blitProgram].forEach((p) => gl.deleteProgram(p));
      textures.clear();
    },
  };
}
export type StageRenderer = NonNullable<ReturnType<typeof createStageRenderer>>;
