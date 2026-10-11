import type { Project, Segment, SegmentKind } from './model';

/** Uniform view over zooms and other segments for timeline placement rules. */
export type ItemKind = 'zoom' | SegmentKind;
export type Item = { id: string; kind: ItemKind; startUs: number; endUs: number; track: number };
/** Kinds whose effect would be ambiguous if two of them overlapped anywhere in time. */
export const EXCLUSIVE: ItemKind[] = ['zoom', 'speed', 'audio', 'camera'];

export const overlaps = (
  a: { startUs: number; endUs: number },
  b: { startUs: number; endUs: number },
) => a.startUs < b.endUs && b.startUs < a.endUs;
export const conflicts = (a: Item, b: Item) =>
  a.id !== b.id && (a.track === b.track || (a.kind === b.kind && EXCLUSIVE.includes(a.kind)));

export function items(project: Pick<Project, 'zooms' | 'segments'>): Item[] {
  return [
    ...project.zooms.map((z) => ({
      id: z.id,
      kind: 'zoom' as const,
      startUs: z.startUs,
      endUs: z.endUs,
      track: z.track,
    })),
    ...project.segments.map((s) => ({
      id: s.id,
      kind: s.kind,
      startUs: s.startUs,
      endUs: s.endUs,
      track: s.track,
    })),
  ];
}

export function findItem(project: Pick<Project, 'zooms' | 'segments'>, id: string) {
  return items(project).find((i) => i.id === id);
}

/** Applies timing/track changes to whichever list holds the item. */
export function patchItems(
  project: Project,
  patch: (item: Item) => Partial<Pick<Item, 'startUs' | 'endUs' | 'track'>> | undefined,
): Project {
  return {
    ...project,
    zooms: project.zooms.map((z) => {
      const p = patch({
        id: z.id,
        kind: 'zoom',
        startUs: z.startUs,
        endUs: z.endUs,
        track: z.track,
      });
      return p ? { ...z, ...p, provenance: 'manual' as const } : z;
    }),
    segments: project.segments.map((s) => {
      const p = patch({
        id: s.id,
        kind: s.kind,
        startUs: s.startUs,
        endUs: s.endUs,
        track: s.track,
      });
      return p ? ({ ...s, ...p } as Segment) : s;
    }),
  };
}
