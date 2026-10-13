/**
 * Lensprout mascot geometry: an original vector redraw of the user's Coral Playground icon
 * concept, a lopsided coral seed with one lens eye, two leaf sprouts and an apricot dot. Shared by the React component and the icon build
 * script (scripts/build-icons.mjs), so this file is plain TypeScript with no imports.
 */
export type MascotPose = 'idle' | 'recording' | 'success' | 'empty' | 'thinking';
export type Shape = {
  el: 'path' | 'circle' | 'ellipse' | 'rect';
  attrs: Record<string, string | number>;
};

export const BRAND = {
  coral: '#E86A47',
  coralShade: '#D4573A',
  apricot: '#FABD62',
  purple: '#453D70',
  cream: '#FFF4E5',
  white: '#FFFFFF',
  rec: '#E5484D',
};
export const MASCOT_VIEWBOX = '-3 -2 108 106';

const BODY =
  'M1.8 74.1C0 57.6 14.1 31.8 37.6 30.6C47.1 30.1 58.8 28.2 69.4 30.6C82.4 36.5 88.2 51.8 87.6 69.4' +
  'C87.1 88.2 80 96.5 65.9 98.2C47.1 100 21.2 100 10.6 96.5C3.5 93.5 2.4 83.5 1.8 74.1Z';
const SHADE =
  'M87.6 69.4C87.1 88.2 80 96.5 65.9 98.2C47.1 100 21.2 100 10.6 96.5C24 97 52 95.5 68 90C79 86 85 79 87.6 69.4Z';

/** Shapes in drawing order for a pose. */
export function mascotShapes(pose: MascotPose = 'idle'): Shape[] {
  const shapes: Shape[] = [
    {
      el: 'ellipse',
      attrs: {
        cx: 51.5,
        cy: 19,
        rx: 12,
        ry: 6.2,
        transform: 'rotate(55 51.5 19)',
        fill: BRAND.coral,
      },
    },
    {
      el: 'ellipse',
      attrs: {
        cx: 78.2,
        cy: 11.8,
        rx: 12.4,
        ry: 6.5,
        transform: 'rotate(-55 78.2 11.8)',
        fill: BRAND.coral,
      },
    },
    {
      el: 'ellipse',
      attrs: {
        cx: 91.2,
        cy: 25.3,
        rx: 8.8,
        ry: 5.3,
        transform: 'rotate(-25 91.2 25.3)',
        fill: BRAND.apricot,
      },
    },
    { el: 'path', attrs: { d: BODY, fill: BRAND.coral } },
    { el: 'path', attrs: { d: SHADE, fill: BRAND.coralShade, opacity: 0.55 } },
  ];
  if (pose === 'success') {
    // Happy closed eye, a wide smile and two sparkles.
    shapes.push(
      {
        el: 'path',
        attrs: {
          d: 'M34 63Q48 46 62 63',
          fill: 'none',
          stroke: BRAND.purple,
          'stroke-width': 5.5,
          'stroke-linecap': 'round',
        },
      },
      {
        el: 'path',
        attrs: {
          d: 'M60 80Q70 90 80 79',
          fill: 'none',
          stroke: BRAND.purple,
          'stroke-width': 3,
          'stroke-linecap': 'round',
        },
      },
      ...sparkle(14, 40, 5),
      ...sparkle(96, 52, 4),
    );
    return shapes;
  }
  const pupil =
    pose === 'empty'
      ? { cx: 43, cy: 67 }
      : pose === 'thinking'
        ? { cx: 58, cy: 53 }
        : { cx: 57.1, cy: 60.6 };
  shapes.push(
    { el: 'circle', attrs: { cx: 48, cy: 60.4, r: 23.5, fill: BRAND.cream } },
    { el: 'circle', attrs: { cx: pupil.cx, cy: pupil.cy, r: 14.1, fill: BRAND.purple } },
  );
  if (pose === 'recording')
    shapes.push({ el: 'circle', attrs: { cx: pupil.cx, cy: pupil.cy, r: 5.2, fill: BRAND.rec } });
  else
    shapes.push({
      el: 'circle',
      attrs: { cx: pupil.cx + 4.1, cy: pupil.cy - 7.1, r: 3.2, fill: BRAND.white },
    });
  shapes.push({
    el: 'path',
    attrs: {
      d: pose === 'empty' ? 'M64 84L75 83' : 'M64.1 81.8Q70 86.5 75.9 80',
      fill: 'none',
      stroke: BRAND.purple,
      'stroke-width': 2.6,
      'stroke-linecap': 'round',
    },
  });
  if (pose === 'thinking')
    shapes.push(
      { el: 'circle', attrs: { cx: 96, cy: 40, r: 2.2, fill: BRAND.apricot } },
      { el: 'circle', attrs: { cx: 100, cy: 33, r: 1.6, fill: BRAND.apricot } },
    );
  return shapes;
}

function sparkle(cx: number, cy: number, r: number): Shape[] {
  const d = `M${cx} ${cy - r}Q${cx + r * 0.18} ${cy - r * 0.18} ${cx + r} ${cy}Q${cx + r * 0.18} ${cy + r * 0.18} ${cx} ${cy + r}Q${cx - r * 0.18} ${cy + r * 0.18} ${cx - r} ${cy}Q${cx - r * 0.18} ${cy - r * 0.18} ${cx} ${cy - r}Z`;
  return [{ el: 'path', attrs: { d, fill: BRAND.apricot } }];
}

const attrs = (a: Shape['attrs']) =>
  Object.entries(a)
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ');
export const shapesToMarkup = (shapes: Shape[]) =>
  shapes.map((s) => `<${s.el} ${attrs(s.attrs)}/>`).join('');

/** Extension icon: the mascot on a purple rounded tile (as in the concept). */
export function iconSvg(size: number) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">` +
    `<rect x="4" y="4" width="120" height="120" rx="30" fill="${BRAND.purple}"/>` +
    `<g transform="translate(20 22) scale(0.86)">${shapesToMarkup(mascotShapes('idle'))}</g></svg>`
  );
}
