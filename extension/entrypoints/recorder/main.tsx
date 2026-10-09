import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Check,
  Circle,
  LibraryBig,
  Pause,
  Play,
  Square,
  TriangleAlert,
} from '@/src/components/app/icons';
import { CancelledError, startRecording, request } from '../../src/capture/record';
import type { CaptureMode, Session, Message } from '../../src/domain/model';
import { formatTime, errorText } from '../../src/lib/format';
import { AppHeader, AppProviders, SwitchRow } from '../../src/components/app/app';
import { Button, buttonVariants } from '../../src/components/ui/button';
import { Card } from '../../src/components/ui/card';
import { Badge } from '../../src/components/ui/badge';
import { Kbd } from '../../src/components/ui/kbd';
import { Spinner } from '../../src/components/ui/spinner';
import { Alert, AlertDescription, AlertTitle } from '../../src/components/ui/alert';
import { cn } from '../../src/lib/utils';
import {
  DevicePanel,
  DEFAULT_PREFS,
  deviceOptions,
  loadPrefs,
  savePrefs,
  type Prefs,
} from './devices';
import { Mascot } from '../../src/components/brand/brand';
import '../../src/ui/globals.css';
type Controller = Awaited<ReturnType<typeof startRecording>>;
type State =
  | 'loading'
  | 'ready'
  | 'preparing'
  | 'recording'
  | 'paused'
  | 'stopping'
  | 'finalizing'
  | 'saved'
  | 'failed';

function Step({
  n,
  title,
  children,
  done,
  highlight,
}: {
  n: number;
  title: string;
  children: ReactNode;
  done?: boolean;
  highlight?: boolean;
}) {
  return (
    <li>
      <Card
        className={cn(
          'grid grid-cols-[3rem_1fr] gap-5 p-5 sm:grid-cols-[3.5rem_1fr] sm:p-6',
          highlight &&
            'border-green-200 bg-gradient-to-b from-accent to-card dark:border-green-900',
        )}
      >
        <span
          className={cn(
            'grid size-12 place-items-center rounded-full border bg-card text-xl font-bold shadow-sm sm:size-14',
            done && 'border-primary bg-primary text-primary-foreground',
          )}
          aria-hidden
        >
          {done ? <Check className="size-5" /> : n}
        </span>
        <div className="grid content-start gap-3">
          <h2 className="mt-1 text-lg font-semibold">{title}</h2>
          {children}
        </div>
      </Card>
    </li>
  );
}

function Recorder() {
  const [session, setSession] = useState<Session>();
  const [state, setState] = useState<State>('loading'),
    [error, setError] = useState(''),
    [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS),
    [prefsLoaded, setPrefsLoaded] = useState(false),
    [mode, setMode] = useState<CaptureMode>('screen'),
    [time, setTime] = useState(0);
  const controller = useRef<Controller | null>(null),
    video = useRef<HTMLVideoElement>(null),
    busy = useRef(false),
    stateRef = useRef(state);
  stateRef.current = state;
  const audio = prefs.audio;
  useEffect(() => {
    void loadPrefs().then((p) => {
      setPrefs(p);
      setPrefsLoaded(true);
    });
  }, []);
  useEffect(() => {
    if (prefsLoaded) savePrefs(prefs);
  }, [prefs, prefsLoaded]);
  useEffect(() => {
    void (async () => {
      const id = new URLSearchParams(location.search).get('session');
      // The controller publishes the session just after creating this tab.
      for (let i = 0; i < 20; i++) {
        const s = (await chrome.storage.session.get('session')).session as Session | undefined;
        if (s?.id === id) {
          if (s.status !== 'ready' || s.mode) {
            await request({ type: 'end-session', sessionId: s.id });
            throw new Error(
              'The recording page was reloaded. The interrupted recording remains in the library; click Lensprout to start again.',
            );
          }
          setSession(s);
          // Screen or window only. Tab capture remains as internal plumbing for automated tests,
          // which cannot drive Chrome's screen picker (see DECISIONS D57).
          const dev = (await chrome.storage.local.get('devCaptureMode')) as {
            devCaptureMode?: string;
          };
          setMode(dev.devCaptureMode === 'tab' && s.sourceTabId !== undefined ? 'tab' : 'screen');
          setState('ready');
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error('Open this page by clicking the Lensprout toolbar button.');
    })().catch((e) => {
      setError(errorText(e));
      setState('failed');
    });
    const interval = setInterval(() => setTime(controller.current?.elapsed() ?? 0), 100);
    const listener = (m: Message) => {
      if (m.type !== 'control') return;
      if (m.command === 'stop' && controller.current) {
        controller.current.stop();
        setState('stopping');
      }
      if (m.command === 'resume' && stateRef.current === 'paused') void pause();
      if (m.command === 'pause' && stateRef.current === 'recording') void pause();
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => {
      clearInterval(interval);
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, []);
  useEffect(() => {
    const prevent = (e: BeforeUnloadEvent) => {
      if (controller.current && !['saved', 'failed'].includes(state)) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [state]);
  async function start() {
    if (!session || busy.current) return;
    busy.current = true;
    setState('preparing');
    setError('');
    try {
      controller.current = await startRecording(
        session,
        { audio, mode, ...deviceOptions(prefs) },
        (id) => {
          controller.current = null;
          setState('saved');
          location.replace(`/editor.html?project=${id}`);
        },
        (message) => {
          setError(message);
          setState('failed');
        },
        () => setState('finalizing'),
      );
      setState('recording');
    } catch (e) {
      if (e instanceof CancelledError) {
        setState('ready');
        return;
      }
      await request({ type: 'end-session', sessionId: session.id }).catch(() => {});
      setError(`${errorText(e)} Click Lensprout in the toolbar to start a new session.`);
      setState('failed');
    } finally {
      busy.current = false;
    }
  }
  async function pause() {
    if (!controller.current || busy.current) return;
    busy.current = true;
    try {
      if (stateRef.current === 'paused') {
        await controller.current.resume();
        setState('recording');
      } else {
        await controller.current.pause();
        setTime(controller.current.elapsed());
        setState('paused');
      }
    } catch (e) {
      setError(errorText(e));
      controller.current.stop();
      setState('stopping');
    } finally {
      busy.current = false;
    }
  }
  const live = state === 'recording' || state === 'paused';
  useEffect(() => {
    const v = video.current;
    if (live && v && controller.current && !v.srcObject) {
      v.srcObject = controller.current.stream;
      void v.play().catch(() => {});
    }
  }, [live]);
  const ending = state === 'stopping' || state === 'finalizing' || state === 'saved';
  const finished = state === 'preparing';
  return (
    <div className="min-h-screen">
      <AppHeader>
        <a href="/editor.html" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
          <LibraryBig /> Library
        </a>
      </AppHeader>
      <main className="mx-auto grid w-full max-w-3xl gap-6 px-4 py-8 sm:py-12">
        {live || ending ? (
          <Card className="grid gap-5 p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <Mascot
                pose={state === 'recording' ? 'recording' : ending ? 'thinking' : 'idle'}
                className="size-10"
              />
              <Badge
                variant={state === 'recording' ? 'destructive' : 'secondary'}
                className="gap-1.5 px-2.5 py-1 text-sm"
              >
                {state === 'recording' ? (
                  <span className="size-2 animate-pulse rounded-full bg-current" aria-hidden />
                ) : ending ? (
                  <Spinner className="size-3.5" />
                ) : (
                  <Pause className="size-3.5" aria-hidden />
                )}
                {state === 'finalizing'
                  ? 'Preparing your project…'
                  : ending
                    ? 'Saving recording…'
                    : state === 'paused'
                      ? 'Paused'
                      : 'Recording'}
              </Badge>
              <span className="flex-1" />
              <span className="time font-mono text-3xl font-semibold tabular-nums">
                {formatTime(time).slice(0, 5)}
              </span>
            </div>
            <video
              ref={video}
              muted
              playsInline
              className="max-h-[52vh] w-full rounded-xl bg-black"
            />
            <div className="flex flex-wrap justify-center gap-3">
              <Button variant="outline" size="lg" disabled={!live} onClick={pause}>
                {state === 'paused' ? <Play /> : <Pause />}
                {state === 'paused' ? 'Resume recording' : 'Pause recording'}
              </Button>
              <Button
                variant="destructive"
                size="lg"
                className="bg-destructive text-white hover:bg-destructive/90"
                disabled={!live}
                onClick={() => {
                  setState('stopping');
                  controller.current?.stop();
                }}
              >
                <Square className="fill-current" /> Stop & open editor
              </Button>
            </div>
            <p className="text-center text-sm text-muted-foreground">
              You can also stop with the Lensprout toolbar button or <Kbd>Ctrl</Kbd>{' '}
              <Kbd>Shift</Kbd> <Kbd>Y</Kbd>. Keep this pinned tab open until the editor opens.
            </p>
          </Card>
        ) : (
          <>
            <div className="grid justify-items-center gap-3">
              <Mascot pose="idle" className="size-20" />
              <h1 className="text-center text-3xl font-bold tracking-tight text-balance sm:text-4xl">
                Record your screen in <span className="text-primary">three simple steps</span>
              </h1>
            </div>
            <ol className="grid gap-4">
              <Step n={1} title="Set up sound, camera and countdown" done={finished} highlight>
                <SwitchRow
                  label={
                    mode === 'tab'
                      ? 'Include tab audio'
                      : 'Include system audio when Chrome offers it'
                  }
                  checked={audio}
                  onChange={(value) => setPrefs((p) => ({ ...p, audio: value }))}
                />
                {state === 'ready' && prefsLoaded && (
                  <DevicePanel prefs={prefs} onChange={setPrefs} />
                )}
              </Step>
              <Step
                n={2}
                title={mode === 'tab' ? 'Use the page as usual' : 'Hide the screen sharing bar'}
              >
                <p className="text-sm text-muted-foreground">
                  {mode === 'tab'
                    ? 'Only this tab is captured. Clicks and typing on the page become automatic zooms.'
                    : 'Chrome shows a “sharing your screen” bar; click Hide so it stays out of your recording. Clicks and typing inside Chrome pages become automatic zooms.'}
                </p>
              </Step>
              <Step n={3} title="Start recording">
                <p className="text-sm text-muted-foreground">
                  You will return to your previous tab and recording starts{' '}
                  {prefs.countdown ? `after a ${prefs.countdown}-second countdown` : 'immediately'}.
                  Stop from this pinned tab or with the Lensprout toolbar button.
                </p>
                <Button
                  size="lg"
                  className="h-12 justify-self-start px-6 text-base"
                  disabled={state !== 'ready'}
                  onClick={start}
                >
                  {state === 'preparing' ? (
                    <Spinner />
                  ) : (
                    <Circle className="fill-red-500 text-red-500" />
                  )}
                  {state === 'preparing'
                    ? prefs.countdown
                      ? 'Counting down…'
                      : 'Preparing capture…'
                    : 'Start recording'}
                </Button>
              </Step>
            </ol>
          </>
        )}
        {error && (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertTitle>Recording problem</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <p className="text-center text-xs text-muted-foreground">
          Up to 30 minutes per recording. Everything stays on this device.
        </p>
      </main>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(
  <AppProviders>
    <Recorder />
  </AppProviders>,
);
