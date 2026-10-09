import { openDB, type DBSchema } from 'idb';
import {
  validateProject,
  type Background,
  type InputEvent,
  type Project,
  type Recording,
} from '../domain/model';
import { loadWallpaper } from '../engine/wallpaper-pack';
import { migrateProject, migrateRecording } from '../domain/migrate';
interface StoreSchema extends DBSchema {
  recordings: { key: string; value: Recording };
  projects: { key: string; value: Project };
  events: {
    key: [string, number];
    value: { recordingId: string; batch: number; events: InputEvent[] };
  };
}
// Versions 2–4 migrate older recordings/projects in place inside the upgrade transaction.
const db = () =>
  openDB<StoreSchema>('zoom-recorder', 6, {
    async upgrade(database, oldVersion, _newVersion, tx) {
      if (oldVersion < 1) {
        database.createObjectStore('recordings', { keyPath: 'id' });
        database.createObjectStore('projects', { keyPath: 'id' });
        database.createObjectStore('events', { keyPath: ['recordingId', 'batch'] });
      }
      if (oldVersion >= 1 && oldVersion < 6) {
        for (const r of await tx.objectStore('recordings').getAll())
          await tx.objectStore('recordings').put(migrateRecording(r));
        for (const p of await tx.objectStore('projects').getAll())
          await tx.objectStore('projects').put(migrateProject(p));
      }
    },
  });
export async function saveRecording(recording: Recording) {
  const d = await db();
  try {
    await d.put('recordings', recording);
  } finally {
    d.close();
  }
}
export async function saveCompleted(recording: Recording, project: Project) {
  validateProject(project, recording);
  const d = await db();
  try {
    const tx = d.transaction(['recordings', 'projects'], 'readwrite');
    await Promise.all([
      tx.objectStore('recordings').put(recording),
      tx.objectStore('projects').put(project),
    ]);
    await tx.done;
  } finally {
    d.close();
  }
}
export async function saveProject(project: Project, expectedRevision?: number) {
  const d = await db();
  try {
    const recording = await d.get('recordings', project.recordingId);
    if (!recording) throw new Error('Recording missing.');
    validateProject(project, recording);
    const tx = d.transaction('projects', 'readwrite');
    const previous = await tx.store.get(project.id);
    if (expectedRevision !== undefined && previous?.revision !== expectedRevision) {
      await tx.done;
      throw new Error(
        'This project changed in another editor. Reload it before making further edits.',
      );
    }
    await tx.store.put(project);
    await tx.done;
  } finally {
    d.close();
  }
}
/** Library rename: bumps the revision so an open editor detects the change instead of overwriting it. */
export async function renameProject(id: string, name: string) {
  const d = await db();
  try {
    const project = await d.get('projects', id);
    if (!project) throw new Error('Saved project not found.');
    await saveProject(
      {
        ...project,
        name: name.trim().slice(0, 200) || project.name,
        revision: project.revision + 1,
      },
      project.revision,
    );
  } finally {
    d.close();
  }
}
export async function saveEvents(recordingId: string, batch: number, events: InputEvent[]) {
  const d = await db();
  try {
    await d.put('events', { recordingId, batch, events });
  } finally {
    d.close();
  }
}
export async function listRecordings() {
  const d = await db();
  try {
    const [records, projects] = await Promise.all([d.getAll('recordings'), d.getAll('projects')]);
    return records
      .map((r) => ({ ...r, name: projects.find((p) => p.recordingId === r.id)?.name ?? r.name }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } finally {
    d.close();
  }
}
export async function loadRecording(id: string) {
  const d = await db();
  try {
    const recording = await d.get('recordings', id);
    if (!recording) throw new Error('Recording not found.');
    return recording;
  } finally {
    d.close();
  }
}
export async function loadProject(id: string) {
  const d = await db();
  try {
    const project = await d.get('projects', id);
    if (!project) throw new Error('Saved project not found.');
    const recording = await d.get('recordings', project.recordingId);
    if (!recording) throw new Error('Source recording not found.');
    validateProject(project, recording);
    const batches = await d.getAll(
      'events',
      IDBKeyRange.bound([recording.id, 0], [recording.id, Number.MAX_SAFE_INTEGER]),
    );
    return { project, recording, events: batches.flatMap((b) => b.events) };
  } finally {
    d.close();
  }
}
const root = () => navigator.storage.getDirectory();
export async function mediaFile(name: string) {
  return (await (await root()).getFileHandle(name)).getFile();
}
export async function mediaWriter(name: string) {
  return (await (await root()).getFileHandle(name, { create: true })).createWritable();
}
export async function removeMedia(name: string) {
  try {
    await (await root()).removeEntry(name);
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
  }
}
export async function saveBackgroundImage(file: Blob) {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
  if (file.size > 25 * 1024 * 1024) throw new Error('Choose an image smaller than 25 MB.');
  // Decoding first rejects files the renderer could not draw.
  (await createImageBitmap(file)).close();
  const name = `background-${crypto.randomUUID()}`;
  const writer = await mediaWriter(name);
  try {
    await writer.write(file);
    await writer.close();
  } catch (error) {
    await writer.abort().catch(() => {});
    throw error;
  }
  return name;
}
export async function loadBackgroundImage(name: string) {
  return createImageBitmap(await mediaFile(name));
}
/** The image a background paints (custom upload or pack wallpaper); null for the others. */
export function loadBackgroundSource(background: Background): Promise<ImageBitmap | null> {
  if (background.type === 'custom') return loadBackgroundImage(background.mediaRef);
  if (background.type === 'wallpaper') return loadWallpaper(background.id);
  return Promise.resolve(null);
}
/** Removes temporary exports and custom backgrounds that no project references. */
export async function clearTemporaryExports() {
  const directory = await root();
  const d = await db();
  const referenced = new Set(
    (await d.getAll('projects').finally(() => d.close()))
      .map((p) =>
        p.composition.background.type === 'custom' ? p.composition.background.mediaRef : '',
      )
      .filter(Boolean),
  );
  let removed = 0,
    skipped = 0;
  for await (const [name] of directory as unknown as AsyncIterable<[string, FileSystemHandle]>) {
    const unusedBackground = /^background-[a-f0-9-]+$/.test(name) && !referenced.has(name);
    if (!/^export-[a-f0-9-]+\.mp4$/.test(name) && !unusedBackground) continue;
    try {
      await directory.removeEntry(name);
      removed++;
    } catch {
      skipped++;
    }
  }
  return { removed, skipped };
}
export async function deleteRecording(id: string) {
  const d = await db();
  try {
    const recording = await d.get('recordings', id);
    if (!recording) return;
    // One source owns one project. Keep this explicit before adding sharing.
    const project = await d.get('projects', id);
    await removeMedia(recording.mediaRef);
    if (recording.camera) await removeMedia(recording.camera.mediaRef).catch(() => {});
    if (project?.composition.background.type === 'custom')
      await removeMedia(project.composition.background.mediaRef).catch(() => {});
    const tx = d.transaction(['recordings', 'projects', 'events'], 'readwrite');
    await Promise.all([
      tx.objectStore('recordings').delete(id),
      tx.objectStore('projects').delete(id),
      tx.objectStore('events').delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER])),
    ]);
    await tx.done;
  } finally {
    d.close();
  }
}
