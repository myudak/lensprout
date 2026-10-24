// Synthesizes the promo's soundtrack (music bed + UI sounds) into assets/audio/bed.wav.
// Everything is generated from oscillators and a seeded noise source, so there is no
// third-party audio and no licence to track. Usage: node scripts/make-audio.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SR = 44100;
const DUR = 45;
const N = SR * DUR;
const L = new Float32Array(N);
const R = new Float32Array(N);

// Deterministic noise (LCG).
let seed = 1234567;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;

const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
const add = (i, v, pan = 0) => {
  if (i < 0 || i >= N) return;
  L[i] += v * (1 - Math.max(0, pan));
  R[i] += v * (1 + Math.min(0, pan));
};

// A tone with attack/decay envelope; `harm` adds a soft second and third partial.
function tone(t0, dur, f, amp, { attack = 0.005, release = dur, harm = 0.25, pan = 0, glide = 0 } = {}) {
  const s0 = Math.floor(t0 * SR);
  const len = Math.floor((dur + 0.05) * SR);
  let ph = 0;
  for (let k = 0; k < len; k++) {
    const t = k / SR;
    const env = Math.min(1, t / attack) * Math.exp(-t / (release / 4));
    const fr = f * (1 + glide * t);
    ph += (2 * Math.PI * fr) / SR;
    const v = Math.sin(ph) + harm * Math.sin(2 * ph) * 0.5 + harm * Math.sin(3 * ph) * 0.2;
    add(s0 + k, v * env * amp, pan);
  }
}

function noiseBurst(t0, dur, amp, { hp = 0.6, rise = false, pan = 0 } = {}) {
  const s0 = Math.floor(t0 * SR);
  const len = Math.floor(dur * SR);
  let prev = 0;
  let lp = 0;
  for (let k = 0; k < len; k++) {
    const x = k / len;
    const env = rise ? Math.sin(Math.PI * x) ** 2 : Math.exp(-x * 8);
    const n = rnd();
    const h = n - prev * hp; // crude high-pass
    prev = n;
    lp += (h - lp) * (rise ? 0.08 + 0.5 * x : 0.6);
    add(s0 + k, lp * env * amp, pan);
  }
}

function kick(t0, amp) {
  const s0 = Math.floor(t0 * SR);
  const len = Math.floor(0.35 * SR);
  let ph = 0;
  for (let k = 0; k < len; k++) {
    const t = k / SR;
    const f = 48 + 90 * Math.exp(-t * 28);
    ph += (2 * Math.PI * f) / SR;
    add(s0 + k, Math.sin(ph) * Math.exp(-t * 9) * amp);
  }
}

// --- Music: 100 BPM, F major, I–V–vi–IV, two bars per chord. ---
const BEAT = 0.6;
const BAR = BEAT * 4;
const chords = [
  [53, 57, 60, 65], // F
  [48, 55, 60, 64], // C
  [50, 57, 62, 65], // Dm
  [46, 53, 58, 62], // Bb
];
const end = 43.2;
for (let bar = 0, t = 0; t < end; bar++, t += BAR) {
  const c = chords[Math.floor(bar / 2) % 4];
  const intro = t < 5.4;
  // Pad: slow-attack chord.
  for (const m of c) tone(t, BAR + 0.4, hz(m), intro ? 0.018 : 0.022, { attack: 0.5, release: 9, harm: 0.1, pan: (m % 3) * 0.2 - 0.2 });
  tone(t, BAR, hz(c[0] - 12), intro ? 0.0 : 0.05, { attack: 0.02, release: 2.4, harm: 0.4 });
  // Plucked arpeggio on eighth notes.
  const arp = [c[1] + 12, c[2] + 12, c[3] + 12, c[2] + 12, c[1] + 24, c[3] + 12, c[2] + 12, c[3] + 12];
  for (let e = 0; e < 8; e++) {
    if (intro && e % 2) continue;
    tone(t + e * (BEAT / 2), 0.5, hz(arp[e]), 0.032, { attack: 0.004, release: 0.9, harm: 0.35, pan: e % 2 ? 0.35 : -0.35 });
  }
  if (!intro) {
    for (let b = 0; b < 4; b++) {
      if (b % 2 === 0) kick(t + b * BEAT, 0.22);
      noiseBurst(t + b * BEAT + BEAT / 2, 0.06, 0.05, { hp: 0.95, pan: 0.2 });
    }
  }
}
// Final ring-out on the tonic.
for (const m of [53, 57, 60, 65, 72]) tone(end, 2.2, hz(m), 0.03, { attack: 0.01, release: 6, harm: 0.2 });
kick(end, 0.25);

// --- UI sounds, timed to the composition (seconds on the root timeline). ---
const pop = (t, m, amp = 0.16) => tone(t, 0.18, hz(m), amp, { attack: 0.002, release: 0.35, harm: 0.15, glide: 0.8 });
const click = (t, amp = 0.2) => {
  noiseBurst(t, 0.03, amp, { hp: 0.98 });
  tone(t, 0.05, 2200, amp * 0.35, { attack: 0.001, release: 0.08, harm: 0 });
};
const whoosh = (t, amp = 0.09) => noiseBurst(t - 0.15, 0.5, amp, { rise: true, hp: 0.4 });
const chime = (t, notes, amp = 0.07) => notes.forEach((m, i) => tone(t + i * 0.07, 1.2, hz(m), amp, { attack: 0.003, release: 2.2, harm: 0.15 }));

// Intro: draw-on swell, body pop, eye, sprouts, blink, wordmark.
noiseBurst(0.15, 0.9, 0.05, { rise: true, hp: 0.2 });
pop(0.95, 65, 0.2);
pop(1.15, 72);
pop(1.32, 76, 0.12);
pop(1.62, 79, 0.12);
pop(1.78, 81, 0.12);
pop(2.0, 84, 0.12);
whoosh(2.95, 0.07);
chime(3.1, [77, 81, 84]);
// Scene transitions.
for (const t of [5.5, 9.5, 15.5, 20, 24.5, 29, 33, 36.5, 40]) whoosh(t);
// Tagline click on "click".
click(5.5 + 2.25);
// Auto zoom: two clicks, then typing.
click(9.5 + 1.5);
click(9.5 + 3.5);
for (let i = 0; i < 8; i++) click(9.5 + 3.75 + i * 0.09, 0.09);
// Smart trim: apply.
click(29 + 2.15);
// Export: done chimes.
chime(33 + 2.4, [84, 88], 0.05);
chime(33 + 2.5, [86, 89], 0.05);
// Private: lock snap.
pop(36.5 + 1.0, 70, 0.12);
// Outro: CTA and sparkles.
pop(40 + 0.95, 72, 0.14);
chime(40 + 2.0, [84, 88, 91, 96], 0.06);

// Fade in/out, soft clip, normalize to -3 dBFS, write 16-bit stereo WAV.
let peak = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const g = Math.min(1, t / 0.3) * Math.min(1, (DUR - t) / 1.2);
  L[i] = Math.tanh(L[i] * 1.2) * g;
  R[i] = Math.tanh(R[i] * 1.2) * g;
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const gain = (Math.pow(10, -3 / 20) / peak) || 1;
const buf = Buffer.alloc(44 + N * 4);
buf.write("RIFF", 0);
buf.writeUInt32LE(36 + N * 4, 4);
buf.write("WAVEfmt ", 8);
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20);
buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * 4, 28);
buf.writeUInt16LE(4, 32);
buf.writeUInt16LE(16, 34);
buf.write("data", 36);
buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * gain)) * 32767), 44 + i * 4);
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * gain)) * 32767), 46 + i * 4);
}
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "audio", "bed.wav");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, buf);
console.log("wrote", out, (buf.length / 1e6).toFixed(1) + " MB");
