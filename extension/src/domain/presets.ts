import { settings } from '../platform';
import { validateProject, type Project, type Recording } from './model';

/**
 * Style presets: the look of a project without anything tied to one recording (crop, trim, zooms,
 * segments and name stay with the project). Stored in chrome.storage.local.
 */
export type Style = {
  composition: Omit<Project['composition'], 'crop'>;
  effects: Project['effects'];
  cursor: Project['cursor'];
  webcam: Project['webcam'];
  stage: Project['stage'];
  autoZoom: Project['autoZoom'];
  output: Project['output'];
};
export type Preset = { id: string; name: string; style: Style; createdAt: string };
export type PresetStore = { presets: Preset[]; defaultId: string | null };

export function extractStyle(project: Project): Style {
  const { crop: _crop, ...composition } = project.composition;
  return structuredClone({
    composition,
    effects: project.effects,
    cursor: project.cursor,
    webcam: project.webcam,
    stage: project.stage,
    autoZoom: project.autoZoom,
    output: project.output,
  });
}

/** Applies a style; the project's crop, timeline and identity are kept. Throws if invalid. */
export function applyStyle(project: Project, style: Style, recording: Recording): Project {
  const next: Project = {
    ...project,
    ...structuredClone(style),
    composition: { ...structuredClone(style.composition), crop: project.composition.crop },
  };
  // A custom background image belongs to one profile; drop it if this one lacks it (caller checks).
  validateProject(next, recording);
  return next;
}

const KEY = 'stylePresets';
export async function loadPresets(): Promise<PresetStore> {
  const stored = (await settings.get([KEY]).catch(() => ({}) as Record<string, unknown>))[KEY] as
    Partial<PresetStore> | undefined;
  return { presets: stored?.presets ?? [], defaultId: stored?.defaultId ?? null };
}
export async function savePresets(store: PresetStore) {
  await settings.set({ [KEY]: store });
}
export const defaultPreset = (store: PresetStore) =>
  store.presets.find((p) => p.id === store.defaultId) ?? null;
