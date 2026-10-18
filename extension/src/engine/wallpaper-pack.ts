/**
 * The optional local wallpaper pack (see scripts/build-wallpapers.py). Local builds copy it to
 * wallpapers/ inside the extension; release zips leave it out, so every caller must handle an
 * empty pack and a missing image.
 */
import { IS_EXTENSION, assetUrl } from '../platform';
export type PackWallpaper = { id: string; name: string; width: number; height: number };

const url = (path: string) => assetUrl(`wallpapers/${path}`);

export const wallpaperThumbUrl = (id: string) => url(`${id}-thumb.webp`);

let index: Promise<PackWallpaper[]> | undefined;
/** The pack's wallpapers, or an empty list when this build has none. */
export function loadWallpaperIndex(): Promise<PackWallpaper[]> {
  // The web editor never ships the pack.
  if (!IS_EXTENSION) return Promise.resolve([]);
  index ??= fetch(url('index.json'))
    .then((r) => (r.ok ? (r.json() as Promise<PackWallpaper[]>) : []))
    .then((list) =>
      Array.isArray(list) ? list.filter((w) => /^[a-z0-9-]{1,40}$/.test(w?.id)) : [],
    )
    .catch(() => []);
  return index;
}

export async function loadWallpaper(id: string): Promise<ImageBitmap> {
  const response = await fetch(url(`${id}.webp`));
  if (!response.ok) throw new Error(`Wallpaper “${id}” is not in this build.`);
  return createImageBitmap(await response.blob());
}
