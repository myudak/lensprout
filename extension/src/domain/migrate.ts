import {
  ENGINE,
  FULL_FRAME,
  QUALITIES,
  SCHEMA,
  clamp,
  defaultCursor,
  defaultStage,
  defaultWebcam,
  type Aspect,
  type OutputSettings,
  type Project,
  type Recording,
} from './model';

/** Schema 1 stored a fixed output size, pixel padding and one color. */
type ProjectV1 = Omit<
  Project,
  'composition' | 'effects' | 'output' | 'autoZoom' | 'segments' | 'zooms'
> & {
  zooms: Omit<Project['zooms'][number], 'track'>[];
  composition: { width: number; height: number; paddingPx: number; background: string };
};
/** Schema 5 had no fill mode or sounds. */
type ProjectV5 = Omit<Project, 'composition' | 'effects'> & {
  composition: Omit<Project['composition'], 'fit'>;
  effects: Omit<Project['effects'], 'sounds'>;
};
/** Schema 4 had no stage, background motion, cursor packs or webcam arrangement. */
type ProjectV4 = Omit<ProjectV5, 'stage' | 'composition' | 'webcam' | 'cursor'> & {
  composition: Omit<Project['composition'], 'backgroundMotion' | 'fit'>;
  webcam: Omit<Project['webcam'], 'layout' | 'split'>;
  cursor: {
    overlay: Omit<Project['cursor']['overlay'], 'pack'>;
    highlight: Project['cursor']['highlight'];
  };
};
/** Schema 3 had no webcam, cursor or follow offset settings. */
type ProjectV3 = Omit<ProjectV4, 'webcam' | 'cursor' | 'autoZoom' | 'schemaVersion'> & {
  schemaVersion: number;
  autoZoom: { depth: number; typing: boolean };
};
/** Schema 2 had no tracks, segments or crop. */
type ProjectV2 = Omit<ProjectV3, 'segments' | 'zooms' | 'composition'> & {
  zooms: Omit<Project['zooms'][number], 'track'>[];
  composition: Omit<Project['composition'], 'crop' | 'backgroundMotion' | 'fit'>;
};

export function migrateRecording(recording: Recording): Recording {
  if (recording?.schemaVersion === 1) return { ...recording, schemaVersion: SCHEMA, source: 'tab' };
  if ([2, 3, 4, 5].includes(recording?.schemaVersion))
    return { ...recording, schemaVersion: SCHEMA };
  return recording;
}

function fromV1(old: ProjectV1): ProjectV2 {
  const c = old.composition,
    short = Math.min(c.width, c.height),
    ratio = c.width / c.height;
  const near = (r: number) => Math.abs(ratio - r) < 0.01;
  const aspect: Aspect = near(16 / 9)
    ? '16:9'
    : near(9 / 16)
      ? '9:16'
      : near(1)
        ? '1:1'
        : near(4 / 3)
          ? '4:3'
          : 'native';
  const quality = QUALITIES.reduce((best, q) =>
    Math.abs(q - short) < Math.abs(best - short) ? q : best,
  ) as OutputSettings['quality'];
  return {
    ...old,
    schemaVersion: 2,
    engineVersion: ENGINE,
    composition: {
      aspect,
      background: {
        type: 'color',
        color: /^#[0-9a-f]{6}$/i.test(c.background) ? c.background : '#233c36',
      },
      padding: clamp(c.paddingPx / short, 0, 0.3),
      radius: clamp((12 * 1080) / short, 0, 80),
      shadow: true,
    },
    // Schema 1 rendered none of these effects; keep migrated exports visually unchanged.
    effects: {
      click: { style: 'none', force: 'moderate', color: '#ff4d4d' },
      motionBlur: false,
      keystrokes: false,
    },
    output: { quality, fps: 30 },
    autoZoom: { depth: 1.7, typing: true },
  };
}

export function migrateProject(
  input: Project | ProjectV1 | ProjectV2 | ProjectV3 | ProjectV4 | ProjectV5,
): Project {
  let p = input as ProjectV1 | ProjectV2 | ProjectV3 | ProjectV4 | ProjectV5 | Project;
  if (p?.schemaVersion === 1) p = fromV1(p as ProjectV1);
  if (p?.schemaVersion === 2) {
    const v2 = p as ProjectV2;
    p = {
      ...v2,
      schemaVersion: 3,
      zooms: v2.zooms.map((z) => ({ ...z, track: 0 })),
      segments: [],
      composition: { ...v2.composition, crop: { ...FULL_FRAME } },
    } satisfies ProjectV3;
  }
  if (p?.schemaVersion === 3) {
    // Overlay cursor off and highlight none keep migrated exports visually unchanged.
    const v3 = p as ProjectV3;
    const { layout: _l, split: _s, ...webcam } = defaultWebcam();
    const { pack: _p, ...overlay } = defaultCursor().overlay;
    p = {
      ...v3,
      schemaVersion: 4,
      autoZoom: { ...v3.autoZoom, offset: { x: 0, y: 0 } },
      webcam,
      cursor: { overlay, highlight: defaultCursor().highlight },
    } satisfies ProjectV4;
  }
  if (p?.schemaVersion === 4) {
    // Flat stage, no device, still background, classic cursor and PiP keep the look unchanged.
    const v4 = p as ProjectV4;
    p = {
      ...v4,
      schemaVersion: 5,
      composition: { ...v4.composition, backgroundMotion: { kind: 'none', speed: 1 } },
      webcam: { ...v4.webcam, layout: 'pip', split: 0.4 },
      cursor: { ...v4.cursor, overlay: { ...v4.cursor.overlay, pack: 'classic' } },
      stage: defaultStage(),
    } satisfies ProjectV5;
  }
  if (p?.schemaVersion === 5) {
    // Contain and silence keep migrated exports unchanged.
    const v5 = p as ProjectV5;
    p = {
      ...v5,
      schemaVersion: SCHEMA,
      composition: { ...v5.composition, fit: 'contain' },
      effects: { ...v5.effects, sounds: { clicks: false, keys: false, volume: 0.6 } },
    } satisfies Project;
  }
  return p as Project;
}
