import { defineContentScript } from '#imports';
import type { CaptureMode, CursorStyle, Message, MeasuredEvent } from '../src/domain/model';

/** Fields whose caret position or shortcuts are never measured. */
function sensitive(element: Element) {
  if (element instanceof HTMLInputElement) {
    if (!['text', 'search', 'url', 'email', 'tel', ''].includes(element.type)) return true;
  }
  const auto = (element.getAttribute('autocomplete') ?? '').toLowerCase();
  return /password|one-time-code|cc-|credit|card/.test(auto);
}

function editable(target: EventTarget | null): HTMLElement | null {
  const element = target instanceof Element ? target : null;
  if (!element) return null;
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement)
    return sensitive(element) ? null : element;
  const host = element.closest<HTMLElement>('[contenteditable]:not([contenteditable="false"])');
  return host && !sensitive(host) ? host : null;
}

const MIRRORED = [
  'boxSizing',
  'width',
  'height',
  'overflowX',
  'overflowY',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderStyle',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'fontStyle',
  'fontVariant',
  'fontWeight',
  'fontStretch',
  'fontSize',
  'lineHeight',
  'fontFamily',
  'textAlign',
  'textTransform',
  'textIndent',
  'letterSpacing',
  'wordSpacing',
  'tabSize',
] as const;

/** Client coordinates of the caret. Text controls use an off-screen mirror; others use the selection. */
function caretPoint(element: HTMLElement): { x: number; y: number } | null {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const position = element.selectionEnd ?? element.value.length,
      rect = element.getBoundingClientRect(),
      style = getComputedStyle(element),
      mirror = document.createElement('div'),
      marker = document.createElement('span');
    for (const key of MIRRORED) mirror.style[key] = style[key];
    mirror.style.position = 'fixed';
    mirror.style.visibility = 'hidden';
    mirror.style.left = '-10000px';
    mirror.style.top = '0';
    mirror.style.whiteSpace = element instanceof HTMLTextAreaElement ? 'pre-wrap' : 'pre';
    mirror.style.overflowWrap = 'break-word';
    mirror.textContent = element.value.slice(0, position);
    marker.textContent = '​';
    mirror.append(marker);
    document.documentElement.append(mirror);
    const x = marker.offsetLeft - element.scrollLeft,
      y = marker.offsetTop - element.scrollTop + marker.offsetHeight / 2;
    mirror.remove();
    return {
      x: Math.min(rect.right, Math.max(rect.left, rect.left + x)),
      y: Math.min(rect.bottom, Math.max(rect.top, rect.top + y)),
    };
  }
  const selection = getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0).cloneRange();
  range.collapse(false);
  const r = range.getClientRects()[0] ?? range.getBoundingClientRect();
  if (r && (r.width || r.height || r.left || r.top)) return { x: r.left, y: r.top + r.height / 2 };
  const box = element.getBoundingClientRect();
  return { x: box.left + 8, y: box.top + Math.min(box.height / 2, 16) };
}

/** The cursor shape the page shows over `target` (CSS `cursor`; `auto` guessed from the element). */
function cursorStyle(target: EventTarget | null): CursorStyle {
  const element = target instanceof Element ? target : null;
  if (!element) return 'arrow';
  const value = getComputedStyle(element).cursor.split(',').pop()!.trim();
  if (value === 'pointer') return 'pointer';
  if (value === 'text' || value === 'vertical-text') return 'text';
  if (value === 'grab' || value === 'grabbing' || value === 'move') return 'grab';
  if (value === 'default') return 'arrow';
  if (value !== 'auto') return 'other';
  if (element.closest('a[href], button, [role="button"], summary, select, label[for]'))
    return 'pointer';
  if (
    element.closest(
      'textarea, input:not([type]), input[type="text"], input[type="search"], input[type="url"], input[type="email"], input[type="tel"], input[type="password"], input[type="number"], [contenteditable]:not([contenteditable="false"])',
    )
  )
    return 'text';
  return 'arrow';
}

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock']);
const mac = /mac/i.test(navigator.platform);
function chordLabel(e: KeyboardEvent): string | null {
  if (!(e.ctrlKey || e.metaKey || e.altKey) || MODIFIER_KEYS.has(e.key) || e.isComposing)
    return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push(mac ? '⌃' : 'Ctrl');
  if (e.altKey) parts.push(mac ? '⌥' : 'Alt');
  if (e.shiftKey) parts.push(mac ? '⇧' : 'Shift');
  if (e.metaKey) parts.push(mac ? '⌘' : 'Win');
  const named: Record<string, string> = {
    ' ': 'Space',
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowUp: '↑',
    ArrowDown: '↓',
    Escape: 'Esc',
  };
  // Physical letter/digit codes keep the label stable across layouts and modifiers.
  const code = /^Key([A-Z])$/.exec(e.code)?.[1] ?? /^Digit(\d)$/.exec(e.code)?.[1];
  parts.push(code ?? named[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key));
  return parts.join('+').slice(0, 60);
}

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  registration: 'runtime',
  main() {
    const key = '__zoomRecorderDispose';
    const holder = window as unknown as Record<string, unknown>;
    (holder[key] as (() => void) | undefined)?.();
    let sessionId = '',
      mode: CaptureMode = 'tab',
      lastMove = 0,
      lastCaret = 0,
      caretTimer = 0,
      // Viewport origin in screen DIPs, learned from pointer events (exact in nested frames too).
      origin: { x: number; y: number } | null = null;
    const top = window === window.top;
    const controller = new AbortController();
    const listener = (message: Message) => {
      if (message.type === 'collector-start') {
        sessionId = message.sessionId;
        mode = message.mode;
      }
      if (message.type === 'collector-stop') sessionId = '';
    };
    chrome.runtime.onMessage.addListener(listener);
    // Tab capture maps viewport pixels; only the top document has them without frame offsets.
    const active = () => !!sessionId && (top || mode === 'screen');
    function send(
      kind: MeasuredEvent['kind'],
      x: number,
      y: number,
      extra?: { keys?: string; cursor?: CursorStyle },
    ) {
      // Before any pointer event, the top frame estimates its origin from the window frame.
      const border = (outerWidth - innerWidth) / 2,
        o =
          origin ??
          (top ? { x: screenX + border, y: screenY + outerHeight - innerHeight - border } : null);
      const measured: MeasuredEvent = {
        kind,
        epochMs: performance.timeOrigin + performance.now(),
        x,
        y,
        width: innerWidth,
        height: innerHeight,
        dpr: devicePixelRatio,
        screenX: o ? o.x + x : null,
        screenY: o ? o.y + y : null,
        win: { x: screenX, y: screenY, width: outerWidth, height: outerHeight },
        top,
        ...extra,
      };
      void chrome.runtime
        .sendMessage({ type: 'collector-event', sessionId, event: measured })
        .catch(() => {});
    }
    function pointer(e: PointerEvent) {
      if (!active() || !e.isPrimary || e.button > 0) return;
      origin = { x: e.screenX - e.clientX, y: e.screenY - e.clientY };
      const now = performance.now();
      // 60 Hz sampling keeps the editor's overlay cursor on top of the captured one.
      if (e.type === 'pointermove' && now - lastMove < 16) return;
      lastMove = now;
      send(
        e.type === 'pointerdown'
          ? 'pointer-down'
          : e.type === 'pointerup'
            ? 'pointer-up'
            : 'pointer-move',
        e.clientX,
        e.clientY,
        { cursor: cursorStyle(e.target) },
      );
    }
    /** `pointerout` with no related target means the pointer left this document. */
    function leave(e: PointerEvent) {
      if (!active() || !e.isPrimary || e.relatedTarget) return;
      send('pointer-leave', e.clientX, e.clientY);
    }
    function caret(e: Event) {
      if (!active()) return;
      const element = editable(e.target);
      if (!element) return;
      // Throttled to one measurement per 80 ms, trailing so the final caret position is kept.
      const wait = Math.max(0, 80 - (performance.now() - lastCaret));
      clearTimeout(caretTimer);
      caretTimer = window.setTimeout(() => {
        lastCaret = performance.now();
        const p = caretPoint(element);
        if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) send('caret', p.x, p.y);
      }, wait);
    }
    function chord(e: KeyboardEvent) {
      if (
        !active() ||
        (e.target instanceof Element && e.target.matches('input') && sensitive(e.target))
      )
        return;
      const keys = chordLabel(e);
      if (keys) send('chord', innerWidth / 2, innerHeight / 2, { keys });
    }
    const options = { capture: true, passive: true, signal: controller.signal };
    for (const type of ['pointerdown', 'pointerup', 'pointermove'])
      window.addEventListener(type, pointer as EventListener, options);
    window.addEventListener('pointerout', leave as EventListener, options);
    window.addEventListener('input', caret, options);
    window.addEventListener('keydown', chord, options);
    holder[key] = () => {
      controller.abort();
      clearTimeout(caretTimer);
      chrome.runtime.onMessage.removeListener(listener);
      delete holder[key];
    };
  },
});
