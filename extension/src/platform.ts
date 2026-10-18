/**
 * The few places where the extension pages and the web editor (vite.web.config.ts, served at
 * lensprout.myudak.com/editor/) differ. Extension pages use chrome.storage and the manifest; the
 * web build keeps small settings in localStorage and has no manifest, recorder or wallpaper pack.
 */
// By protocol, not chrome.runtime: extension workers (export, analysis) have no chrome.runtime.
export const IS_EXTENSION =
  typeof location !== 'undefined' && location.protocol === 'chrome-extension:';

type Listener = (changes: Record<string, { newValue?: unknown }>) => void;
const PREFIX = 'lensprout:';
const listeners = new Set<Listener>();
const readLocal = (key: string): unknown => {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
};
if (!IS_EXTENSION && typeof window !== 'undefined')
  // Other tabs of the web editor.
  window.addEventListener('storage', (e) => {
    if (!e.key?.startsWith(PREFIX)) return;
    const key = e.key.slice(PREFIX.length);
    for (const l of listeners) l({ [key]: { newValue: readLocal(key) } });
  });

/** chrome.storage.local in the extension, localStorage on the web. */
export const settings = {
  async get(keys: string[]): Promise<Record<string, unknown>> {
    if (IS_EXTENSION) return chrome.storage.local.get(keys);
    return Object.fromEntries(keys.map((k) => [k, readLocal(k)]));
  },
  async set(items: Record<string, unknown>) {
    if (IS_EXTENSION) return chrome.storage.local.set(items);
    for (const [k, v] of Object.entries(items)) localStorage.setItem(PREFIX + k, JSON.stringify(v));
    for (const l of listeners)
      l(Object.fromEntries(Object.entries(items).map(([k, v]) => [k, { newValue: v }])));
  },
  /** Changes made by other pages (and, on the web, this one); returns an unsubscribe. */
  onChanged(listener: Listener) {
    if (IS_EXTENSION) {
      const wrapped = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
        if (area === 'local') listener(changes);
      };
      chrome.storage.onChanged.addListener(wrapped);
      return () => chrome.storage.onChanged.removeListener(wrapped);
    }
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
};

/** The active recording session (extension only; the web editor never records). */
export async function activeSessionId(): Promise<string | undefined> {
  if (!IS_EXTENSION) return undefined;
  const stored = await chrome.storage.session.get('session');
  return (stored.session as { id?: string } | undefined)?.id;
}

/** URL of a file shipped next to the pages (extension root, or the web build's base). */
export function assetUrl(path: string) {
  if (IS_EXTENSION) return `${location.origin}/${path}`;
  return `${import.meta.env.BASE_URL}${path}`;
}
