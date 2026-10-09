import { useEffect, useRef, useState } from 'react';
import { Camera, Mic, Timer } from '@/src/components/app/icons';
import type { RecordOptions } from '../../src/capture/record';
import { Segmented, SwitchRow, Choice } from '../../src/components/app/app';
import { Slider } from '../../src/components/ui/slider';
import { Separator } from '../../src/components/ui/separator';

export type Prefs = {
  audio: boolean;
  /** Device id; '' = none. */
  camera: string;
  mic: string;
  gain: number;
  noiseSuppression: boolean;
  countdown: number;
};
export const DEFAULT_PREFS: Prefs = {
  audio: true,
  camera: '',
  mic: '',
  gain: 1,
  noiseSuppression: true,
  countdown: 3,
};
const KEY = 'recorderPrefs';

export async function loadPrefs(): Promise<Prefs> {
  const stored = (await chrome.storage.local.get(KEY).catch(() => ({}) as Record<string, unknown>))[
    KEY
  ] as Partial<Prefs> | undefined;
  return { ...DEFAULT_PREFS, ...stored };
}
export function savePrefs(prefs: Prefs) {
  void chrome.storage.local.set({ [KEY]: prefs }).catch(() => {});
}

/** Recorder options for the chosen devices. */
export function deviceOptions(prefs: Prefs): Omit<RecordOptions, 'mode' | 'audio'> {
  return {
    countdown: prefs.countdown,
    ...(prefs.mic
      ? {
          mic: {
            deviceId: prefs.mic,
            gain: prefs.gain,
            noiseSuppression: prefs.noiseSuppression,
          },
        }
      : {}),
    ...(prefs.camera ? { camera: { deviceId: prefs.camera } } : {}),
  };
}

/** Before permission Chrome hides device ids; 'default' then means "ask, then use the default". */
function useDevices(kind: MediaDeviceKind) {
  const [devices, setDevices] = useState<{ id: string; label: string }[]>([]);
  const refresh = async () => {
    const all = (await navigator.mediaDevices.enumerateDevices()).filter(
      (d) => d.kind === kind && d.deviceId !== 'communications',
    );
    setDevices(
      all.map((d, i) => ({
        id: d.deviceId || 'default',
        label: d.label || `${kind === 'videoinput' ? 'Camera' : 'Microphone'} ${i + 1}`,
      })),
    );
  };
  useEffect(() => {
    void refresh();
    navigator.mediaDevices.addEventListener('devicechange', refresh);
    return () => navigator.mediaDevices.removeEventListener('devicechange', refresh);
  }, []);
  return { devices, refresh };
}

const constraint = (id: string) => (id && id !== 'default' ? { deviceId: { exact: id } } : {});

function DeviceSelect({
  label,
  icon: Icon,
  value,
  devices,
  onChange,
  disabled,
}: {
  label: string;
  icon: typeof Camera;
  value: string;
  devices: { id: string; label: string }[];
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const known = devices.some((d) => d.id === value);
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      <span className="flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" aria-hidden /> {label}
      </span>
      <Choice
        label={label}
        size="default"
        className="w-full"
        value={value || 'none'}
        disabled={disabled}
        options={[
          { id: 'none', label: 'None' },
          ...devices.map((d) => ({ id: d.id, label: d.label })),
          ...(value && !known ? [{ id: value, label: 'Unavailable device' }] : []),
        ]}
        onChange={(id) => onChange(id === 'none' ? '' : id)}
      />
    </label>
  );
}

/**
 * Camera, microphone and countdown choices with a live camera preview and mic level. Previews
 * are released when this unmounts (recording opens its own streams).
 */
export function DevicePanel({
  prefs,
  onChange,
  disabled,
}: {
  prefs: Prefs;
  onChange: (update: (prefs: Prefs) => Prefs) => void;
  disabled?: boolean;
}) {
  const cameras = useDevices('videoinput'),
    mics = useDevices('audioinput');
  const [problem, setProblem] = useState(''),
    [level, setLevel] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const gain = useRef(prefs.gain);
  gain.current = prefs.gain;
  const set = (patch: Partial<Prefs>) => onChange((p) => ({ ...p, ...patch }));

  useEffect(() => {
    if (!prefs.camera) return;
    let stream: MediaStream | undefined,
      gone = false;
    void navigator.mediaDevices
      .getUserMedia({ video: { ...constraint(prefs.camera), width: { ideal: 640 } } })
      .then(async (s) => {
        if (gone) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        setProblem('');
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play().catch(() => {});
        }
        // After the grant, labels and real ids become visible.
        await cameras.refresh();
        const id = s.getVideoTracks()[0]?.getSettings().deviceId;
        if (prefs.camera === 'default' && id) set({ camera: id });
      })
      .catch((e) => {
        if (gone) return;
        setProblem(`Camera unavailable (${e?.name ?? e}). Allow it in Chrome's site settings.`);
        set({ camera: '' });
      });
    return () => {
      gone = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [prefs.camera]);

  useEffect(() => {
    if (!prefs.mic) return;
    let stream: MediaStream | undefined,
      context: AudioContext | undefined,
      frame = 0,
      gone = false;
    const clean = prefs.noiseSuppression;
    void navigator.mediaDevices
      .getUserMedia({
        audio: {
          ...constraint(prefs.mic),
          noiseSuppression: clean,
          echoCancellation: clean,
          autoGainControl: clean,
        },
      })
      .then(async (s) => {
        if (gone) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        setProblem('');
        context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        // A silent path to the destination keeps the graph (and the analyser) running.
        const silent = context.createGain();
        silent.gain.value = 0;
        context
          .createMediaStreamSource(s)
          .connect(analyser)
          .connect(silent)
          .connect(context.destination);
        await context.resume().catch(() => {});
        const samples = new Float32Array(analyser.fftSize);
        const tick = () => {
          analyser.getFloatTimeDomainData(samples);
          let sum = 0;
          for (const v of samples) sum += v * v;
          const rms = Math.sqrt(sum / samples.length) * gain.current;
          // About −50 dBFS reads as empty, 0 dBFS as full.
          setLevel(Math.max(0, Math.min(1, 1 + (20 * Math.log10(rms || 1e-6)) / 50)));
          frame = requestAnimationFrame(tick);
        };
        tick();
        await mics.refresh();
        const id = s.getAudioTracks()[0]?.getSettings().deviceId;
        if (prefs.mic === 'default' && id) set({ mic: id });
      })
      .catch((e) => {
        if (gone) return;
        setProblem(`Microphone unavailable (${e?.name ?? e}). Allow it in Chrome's site settings.`);
        set({ mic: '' });
      });
    return () => {
      gone = true;
      cancelAnimationFrame(frame);
      setLevel(0);
      stream?.getTracks().forEach((t) => t.stop());
      void context?.close().catch(() => {});
    };
  }, [prefs.mic, prefs.noiseSuppression]);

  return (
    <div className="grid gap-4">
      <Separator />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid content-start gap-3">
          <DeviceSelect
            label="Camera"
            icon={Camera}
            value={prefs.camera}
            devices={cameras.devices}
            disabled={disabled}
            onChange={(camera) => set({ camera })}
          />
          {prefs.camera ? (
            <video
              ref={video}
              muted
              playsInline
              aria-label="Camera preview"
              className="aspect-video w-full -scale-x-100 rounded-lg bg-black object-cover"
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              The webcam is recorded separately; place and style it in the editor.
            </p>
          )}
        </div>
        <div className="grid content-start gap-3">
          <DeviceSelect
            label="Microphone"
            icon={Mic}
            value={prefs.mic}
            devices={mics.devices}
            disabled={disabled}
            onChange={(mic) => set({ mic })}
          />
          {prefs.mic ? (
            <>
              <div
                role="meter"
                aria-label="Microphone level"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(level * 100)}
                className="h-2 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-75"
                  style={{ width: `${level * 100}%` }}
                />
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-muted-foreground">Volume</span>
                <Slider
                  thumbLabel="Microphone volume"
                  className="flex-1"
                  min={0}
                  max={3}
                  step={0.05}
                  disabled={disabled}
                  value={prefs.gain}
                  onValueChange={(v) => set({ gain: v as number })}
                />
                <output className="w-10 text-right text-xs tabular-nums">
                  {Math.round(prefs.gain * 100)}%
                </output>
              </div>
              <SwitchRow
                label="Noise suppression"
                description="Chrome's noise suppression, echo cancellation and auto gain"
                checked={prefs.noiseSuppression}
                disabled={disabled}
                onChange={(noiseSuppression) => set({ noiseSuppression })}
              />
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              Your voice is mixed into the recording's audio track.
            </p>
          )}
        </div>
      </div>
      <div className="grid gap-1.5">
        <span className="flex items-center gap-2 text-sm font-medium">
          <Timer className="size-4 text-muted-foreground" aria-hidden /> Countdown
        </span>
        <Segmented
          label="Countdown"
          value={String(prefs.countdown)}
          options={[
            { id: '0', label: 'Off' },
            { id: '3', label: '3 s' },
            { id: '5', label: '5 s' },
            { id: '10', label: '10 s' },
          ]}
          onChange={(v) => set({ countdown: Number(v) })}
        />
      </div>
      {problem && <p className="text-xs text-destructive">{problem}</p>}
    </div>
  );
}
