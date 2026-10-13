import { useEffect, useRef, useState } from 'react';
import type { InputEvent, Project, Recording } from '../domain/model';
import { seconds } from '../domain/model';
import type { AnalyzeReply, AnalyzeRequest } from '../analysis/analyze.worker';
import {
  applySuggestions,
  silentRanges,
  staticRanges,
  suggest,
  toLogical,
  type Suggestion,
} from '../engine/smart-trim';
import { Button } from '@/src/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/src/components/ui/dialog';
import { Progress } from '@/src/components/ui/progress';
import { Alert, AlertDescription } from '@/src/components/ui/alert';
import { Switch } from '@/src/components/ui/switch';
import { Mascot } from '@/src/components/brand/brand';

const REASON: Record<Suggestion['reason'], string> = {
  idle: 'Nothing happens',
  typing: 'Typing',
  silence: 'Silent and still',
};

/**
 * Smart trim: analyses the recording (in a worker), then lists speed-ups and cuts to apply as
 * normal timeline segments, so they stay editable and undoable.
 */
export function SmartTrimDialog({
  open,
  project,
  recording,
  events,
  onApply,
  onClose,
}: {
  open: boolean;
  project: Project;
  recording: Recording;
  events: InputEvent[];
  onApply: (next: Project, applied: number, skipped: number) => void;
  onClose: () => void;
}) {
  const [state, setState] = useState<'idle' | 'running' | 'done'>('idle'),
    [progress, setProgress] = useState(0),
    [error, setError] = useState(''),
    [suggestions, setSuggestions] = useState<Suggestion[]>([]),
    [chosen, setChosen] = useState<Set<string>>(new Set());
  const worker = useRef<Worker | null>(null);
  useEffect(() => () => worker.current?.terminate(), []);
  function analyze() {
    worker.current?.terminate();
    setState('running');
    setProgress(0);
    setError('');
    const job = new Worker(new URL('../analysis/analyze.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.current = job;
    job.onerror = (e) => {
      setError(`Analysis failed: ${e.message}`);
      setState('idle');
      job.terminate();
    };
    job.onmessage = (e: MessageEvent<AnalyzeReply>) => {
      const m = e.data;
      if (m.type === 'progress') return setProgress(m.progress);
      job.terminate();
      worker.current = null;
      if (m.type === 'error') {
        setError(`Analysis failed: ${m.error}`);
        setState('idle');
        return;
      }
      const found = suggest({
        durationUs: recording.durationUs,
        trim: project.trim,
        staticLogical: toLogical(recording, staticRanges(m.frames)),
        silentLogical: m.windows ? toLogical(recording, silentRanges(m.windows)) : null,
        events,
      });
      setSuggestions(found);
      setChosen(new Set(found.map((s) => s.id)));
      setState('done');
    };
    job.postMessage({ type: 'start', recording } satisfies AnalyzeRequest);
  }
  const picked = suggestions.filter((s) => chosen.has(s.id));
  const saved = picked.reduce(
    (sum, s) => sum + (s.endUs - s.startUs) * (s.kind === 'cut' ? 1 : 1 - 1 / (s.speed ?? 1)),
    0,
  );
  return (
    <Dialog open={open} onOpenChange={(next) => !next && state !== 'running' && onClose()}>
      <DialogContent className="gap-4 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg">Smart trim</DialogTitle>
          <DialogDescription>
            Finds still moments with no input, typing, and silences
            {recording.hasAudio ? '' : ' (silences need a recording with audio)'}. Suggestions
            become ordinary speed and trim segments you can edit or undo.
          </DialogDescription>
        </DialogHeader>
        {state === 'running' && (
          <div className="grid justify-items-center gap-2" role="status">
            <Mascot pose="thinking" className="size-14" />
            <Progress
              className="w-full"
              value={Math.round(progress * 100)}
              aria-label="Analysis progress"
            />
            <span className="text-sm text-muted-foreground">
              Analysing {Math.round(progress * 100)}%
            </span>
          </div>
        )}
        {state === 'done' &&
          (suggestions.length ? (
            <ul className="grid max-h-72 gap-1.5 overflow-auto" aria-label="Suggestions">
              {suggestions.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2 text-sm"
                >
                  <Switch
                    aria-label={`${REASON[s.reason]} ${seconds(s.startUs).toFixed(1)} to ${seconds(s.endUs).toFixed(1)} seconds`}
                    checked={chosen.has(s.id)}
                    onCheckedChange={(on) =>
                      setChosen((c) => {
                        const next = new Set(c);
                        if (on) next.add(s.id);
                        else next.delete(s.id);
                        return next;
                      })
                    }
                  />
                  <span className="flex-1">
                    <strong>{s.kind === 'cut' ? 'Cut' : `Speed ${s.speed}×`}</strong> ·{' '}
                    {REASON[s.reason]}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {seconds(s.startUs).toFixed(1)}–{seconds(s.endUs).toFixed(1)} s
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nothing to trim: no long still, silent or typing stretches were found.
            </p>
          ))}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={state === 'running'} onClick={onClose}>
            Close
          </Button>
          {state === 'done' && suggestions.length > 0 ? (
            <Button
              disabled={!picked.length}
              onClick={() => {
                const result = applySuggestions(project, picked);
                onApply(result.project, result.applied, result.skipped.length);
              }}
            >
              Apply {picked.length} · saves {seconds(saved).toFixed(1)} s
            </Button>
          ) : (
            <Button disabled={state === 'running'} onClick={analyze}>
              {state === 'done' ? 'Analyse again' : 'Analyse recording'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
