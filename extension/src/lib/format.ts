/** mm:ss.cc */
export function formatTime(us: number) {
  const s = Math.max(0, us / 1_000_000);
  const cs = Math.floor((s % 1) * 100);
  return `${Math.floor(s / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(s % 60)
    .toString()
    .padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
}
export function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
/**
 * An unpacked extension serves rebuilt pages from disk immediately, but keeps the old manifest
 * (permissions) and service worker until it is reloaded in chrome://extensions.
 */
export function staleInstall() {
  const m = chrome.runtime.getManifest();
  return m.version !== __BUILD_VERSION__ || !m.permissions?.includes('desktopCapture');
}
