import { defineBackground } from '#imports';
import type { Message, Session } from '../src/domain/model';

const COUNTDOWN_ID = 'lensprout-countdown';

// The three functions below run inside the recorded page (chrome.scripting); they must be
// self-contained. The overlay lives in an open shadow root so page styles cannot reach it.
function showCountdown(id: string, seconds: number) {
  document.getElementById(id)?.remove();
  const host = document.createElement('div');
  host.id = id;
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    .veil{position:fixed;inset:0;display:grid;place-content:center;justify-items:center;gap:20px;
      background:rgba(15,23,42,.35);font:600 16px/1.4 system-ui,sans-serif;color:#fff}
    .n{display:grid;place-items:center;width:168px;height:168px;border-radius:50%;
      background:rgba(15,23,42,.78);font-size:88px;font-weight:700;box-shadow:0 20px 60px rgba(0,0,0,.35);
      animation:pop 1s ease-out infinite}
    p{margin:0;padding:6px 14px;border-radius:999px;background:rgba(15,23,42,.78)}
    @keyframes pop{0%{transform:scale(1.12)}30%{transform:scale(1)}}
    @media (prefers-reduced-motion:reduce){.n{animation:none}}
  </style><div class="veil" role="status" aria-live="assertive"><div class="n">${seconds}</div>
  <p>Recording starts soon · Esc to cancel</p></div>`;
  document.documentElement.append(host);
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    void chrome.runtime.sendMessage({ type: 'countdown-cancel' });
  };
  addEventListener('keydown', onKey, true);
  (globalThis as { __zoomRecorderCountdown?: () => void }).__zoomRecorderCountdown = () =>
    removeEventListener('keydown', onKey, true);
}
function tickCountdown(id: string, seconds: number) {
  const n = document.getElementById(id)?.shadowRoot?.querySelector('.n');
  if (n) n.textContent = String(seconds);
}
/** Resolves after two frames without the overlay, so the capture has repainted before recording. */
function hideCountdown(id: string) {
  const g = globalThis as { __zoomRecorderCountdown?: () => void };
  g.__zoomRecorderCountdown?.();
  delete g.__zoomRecorderCountdown;
  document.getElementById(id)?.remove();
  return new Promise<boolean>((resolve) => {
    const done = () => resolve(true);
    setTimeout(done, 250);
    requestAnimationFrame(() => requestAnimationFrame(done));
  });
}

export default defineBackground(() => {
  let queue: Promise<unknown> = Promise.resolve();
  // Serialized mutations: action clicks, state changes and injections all rewrite the session.
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  };
  let cached: Session | undefined | null = null;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && 'session' in changes)
      cached = changes.session!.newValue as Session | undefined;
  });
  const session = async () => {
    if (cached === null)
      cached = (await chrome.storage.session.get('session')).session as Session | undefined;
    return cached;
  };
  const save = async (s: Session | undefined) => {
    cached = s;
    if (s) await chrome.storage.session.set({ session: s });
    else await chrome.storage.session.remove('session');
  };
  const http = (url?: string) => /^https?:/.test(url ?? '');
  let countdown: { cancel: () => void } | undefined;

  /** Shows 3-2-1 on the recorded page and badge; resolves { cancelled } when it ends. */
  async function runCountdown(
    message: Extract<Message, { type: 'countdown' }>,
    sender: chrome.runtime.MessageSender,
  ) {
    const s = await serial(async () => {
      const s = await session();
      if (!s || message.sessionId !== s.id)
        throw new Error('Session expired. Click the extension again to start a new recording.');
      if (sender.tab?.id !== s.recorderTabId) throw new Error('Invalid recorder context.');
      if (s.status !== 'ready' || !s.mode) throw new Error('The countdown cannot start now.');
      const updated: Session = { ...s, status: 'countdown' };
      await save(updated);
      return updated;
    });
    const seconds = Math.max(1, Math.min(10, Math.round(message.seconds)));
    let tabId = s.mode === 'screen' ? undefined : s.sourceTabId;
    if (s.mode === 'screen') {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab?.id !== undefined && http(tab.url)) tabId = tab.id;
    }
    const run = <A extends unknown[], R>(func: (...args: A) => R, args: A) =>
      chrome.scripting.executeScript({ target: { tabId: tabId!, frameIds: [0] }, func, args });
    let cancelled = false,
      wake = () => {};
    countdown = {
      cancel() {
        cancelled = true;
        wake();
      },
    };
    // Pages Chrome does not let extensions script (chrome://, the Web Store) get the badge only.
    const overlay =
      tabId !== undefined &&
      (await run(showCountdown, [COUNTDOWN_ID, seconds]).then(
        () => true,
        () => false,
      ));
    try {
      await chrome.action.setBadgeBackgroundColor({ color: '#e5484d' });
      for (let n = seconds; n > 0 && !cancelled; n--) {
        await chrome.action.setBadgeText({ text: String(n) });
        if (overlay && n !== seconds) await run(tickCountdown, [COUNTDOWN_ID, n]).catch(() => {});
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 1000);
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
      }
    } finally {
      countdown = undefined;
      if (overlay) await run(hideCountdown, [COUNTDOWN_ID]).catch(() => {});
      await chrome.action.setBadgeText({ text: '' });
      await serial(async () => {
        const current = await session();
        if (current?.id !== s.id) return;
        // A cancelled countdown releases the capture, so the session can capture again.
        const { mode: _mode, ...rest } = current;
        await save(cancelled ? { ...rest, status: 'ready' } : { ...current, status: 'ready' });
      });
    }
    return { cancelled };
  }

  async function inject(tabId: number, target: { allFrames?: boolean; frameIds?: number[] }) {
    const s = await session();
    if (!s) return;
    await chrome.scripting.executeScript({
      target: target.allFrames
        ? { tabId, allFrames: true }
        : { tabId, frameIds: target.frameIds ?? [0] },
      files: ['content-scripts/events.js'],
    });
    await chrome.tabs.sendMessage(tabId, {
      type: 'collector-start',
      sessionId: s.id,
      mode: s.mode ?? 'tab',
    } satisfies Message);
    await serial(async () => {
      const current = await session();
      if (current?.id === s.id && !current.injected?.includes(tabId))
        await save({ ...current, injected: [...(current.injected ?? []), tabId] });
    });
  }
  /** Tab mode watches the source document; screen mode watches whichever tab is visible in each window. */
  async function startCollection(s: Session) {
    if (s.mode === 'screen') {
      for (const tab of await chrome.tabs.query({ active: true }))
        if (tab.id !== undefined && http(tab.url))
          await inject(tab.id, { allFrames: true }).catch(() => {});
    } else if (s.sourceTabId !== undefined) await inject(s.sourceTabId, { frameIds: [0] });
  }
  async function stopCollection(s: Session) {
    const tabs = new Set([
      ...(s.injected ?? []),
      ...(s.sourceTabId !== undefined ? [s.sourceTabId] : []),
    ]);
    for (const id of tabs)
      await chrome.tabs
        .sendMessage(id, { type: 'collector-stop' } satisfies Message)
        .catch(() => {});
  }
  async function badge(status?: Session['status']) {
    await chrome.action.setBadgeText({
      text: status === 'recording' ? 'REC' : status === 'paused' ? 'Ⅱ' : '',
    });
    await chrome.action.setBadgeBackgroundColor({ color: '#e5484d' });
  }

  async function open(tab: chrome.tabs.Tab) {
    const old = await session();
    if (old) {
      try {
        const existing = await chrome.tabs.get(old.recorderTabId);
        if (existing.url?.startsWith(chrome.runtime.getURL('/recorder.html'))) {
          // Toolbar during capture: stop while recording, resume while paused, cancel a countdown,
          // else show the recorder.
          if (old.status === 'countdown') countdown?.cancel();
          else if (old.status === 'recording' || old.status === 'paused')
            await chrome.tabs.sendMessage(old.recorderTabId, {
              type: 'control',
              sessionId: old.id,
              command: old.status === 'recording' ? 'stop' : 'resume',
            } satisfies Message);
          else {
            await chrome.tabs.update(old.recorderTabId, { active: true });
            if (existing.windowId !== undefined)
              await chrome.windows.update(existing.windowId, { focused: true });
          }
          return;
        }
      } catch {
        /* Recorder closed. */
      }
      await stopCollection(old);
      await save(undefined);
      await badge();
    }
    const id = crypto.randomUUID();
    const recorder = await chrome.tabs.create({
      url: chrome.runtime.getURL(`/recorder.html?session=${id}`),
      pinned: true,
      index: 0,
      ...(tab.windowId !== undefined ? { windowId: tab.windowId } : {}),
    });
    await save({
      id,
      ...(tab.id !== undefined && http(tab.url) ? { sourceTabId: tab.id } : {}),
      ...(tab.windowId !== undefined ? { sourceWindowId: tab.windowId } : {}),
      ...(tab.id !== undefined ? { returnTabId: tab.id } : {}),
      recorderTabId: recorder.id!,
      sourceTitle: http(tab.url) ? (tab.title ?? 'Tab recording') : 'Screen recording',
      status: 'ready',
    });
  }
  chrome.action.onClicked.addListener((tab) => {
    void serial(() => open(tab)).catch(console.error);
  });

  chrome.runtime.onMessage.addListener((message: Message, sender, reply) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message.type === 'collector-event') {
      void (async () => {
        const s = await session();
        if (!s || message.sessionId !== s.id || s.status !== 'recording' || !sender.tab?.id) return;
        if (s.mode !== 'screen' && (sender.tab.id !== s.sourceTabId || sender.frameId !== 0))
          return;
        await chrome.tabs
          .sendMessage(s.recorderTabId, {
            type: 'input',
            sessionId: s.id,
            event: message.event,
            windowId: sender.tab.windowId,
            tabId: sender.tab.id,
          } satisfies Message)
          .catch(() => {});
      })();
      return;
    }
    if (message.type === 'countdown-cancel') {
      countdown?.cancel();
      return;
    }
    if (message.type === 'countdown') {
      runCountdown(message, sender).then(
        (value) => reply({ ok: true, value }),
        (error) =>
          reply({ ok: false, error: String(error instanceof Error ? error.message : error) }),
      );
      return true;
    }
    if (
      message.type === 'input' ||
      message.type === 'control' ||
      message.type === 'countdown-tick' ||
      message.type === 'collector-start' ||
      message.type === 'collector-stop'
    )
      return;
    void serial(async () => {
      const s = await session();
      if (!s || ('sessionId' in message && message.sessionId !== s.id))
        throw new Error('Session expired. Click the extension again to start a new recording.');
      if (sender.tab?.id !== s.recorderTabId) throw new Error('Invalid recorder context.');
      if (message.type === 'capture') {
        if (s.status !== 'ready' || s.mode) throw new Error('This session is already recording.');
        if (message.mode === 'tab') {
          if (s.sourceTabId === undefined)
            throw new Error('Tab recording needs a web page. Choose screen recording instead.');
          const streamId = await chrome.tabCapture.getMediaStreamId({
            targetTabId: s.sourceTabId,
            consumerTabId: s.recorderTabId,
          });
          // The page's own viewport in device pixels caps capture size (Chrome upscales otherwise).
          const [measured] = await chrome.scripting
            .executeScript({
              target: { tabId: s.sourceTabId },
              func: () => ({
                width: Math.round(innerWidth * devicePixelRatio),
                height: Math.round(innerHeight * devicePixelRatio),
              }),
            })
            .catch(() => []);
          await save({ ...s, mode: 'tab' });
          return { streamId, sourceTabId: s.sourceTabId, viewport: measured?.result };
        }
        await save({ ...s, mode: 'screen' });
        return {};
      }
      if (message.type === 'session-state') {
        const updated = { ...s, status: message.status };
        await save(updated);
        await badge(message.status);
        return updated;
      }
      if (message.type === 'end-session') {
        await stopCollection(s);
        await save(undefined);
        await badge();
      }
    }).then(
      async (value) => {
        // Injection runs outside the queue because it records injected tabs through it.
        if (message.type === 'session-state' && message.status === 'recording' && value)
          await startCollection(value as Session).catch(console.error);
        reply({ ok: true, value });
      },
      (error) =>
        reply({ ok: false, error: String(error instanceof Error ? error.message : error) }),
    );
    return true;
  });

  chrome.webNavigation.onCommitted.addListener(async (event) => {
    const s = await session();
    if (!s || s.status !== 'recording' || !http(event.url)) return;
    if (s.mode === 'screen') {
      const tab = await chrome.tabs.get(event.tabId).catch(() => undefined);
      if (tab?.active) await inject(event.tabId, { frameIds: [event.frameId] }).catch(() => {});
    } else if (event.tabId === s.sourceTabId && event.frameId === 0)
      await inject(s.sourceTabId, { frameIds: [0] }).catch(console.error);
  });
  chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    const s = await session();
    if (s?.mode !== 'screen' || s.status !== 'recording') return;
    const tab = await chrome.tabs.get(tabId).catch(() => undefined);
    if (tab && http(tab.url)) await inject(tabId, { allFrames: true }).catch(() => {});
  });
  chrome.tabs.onRemoved.addListener(async (id) => {
    const s = await session();
    if (!s) return;
    if (s.mode !== 'screen' && s.sourceTabId === id)
      await chrome.tabs
        .sendMessage(s.recorderTabId, {
          type: 'control',
          sessionId: s.id,
          command: 'stop',
        } satisfies Message)
        .catch(() => {});
    if (s.recorderTabId === id)
      await serial(async () => {
        await stopCollection(s);
        await save(undefined);
        await badge();
      });
  });
});
