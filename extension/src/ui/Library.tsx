import { useEffect, useMemo, useState } from 'react';
import {
  AppWindow,
  EllipsisVertical,
  ExternalLink,
  Monitor,
  PanelsTopLeft,
  Pencil,
  Search,
  Trash2,
} from '@/src/components/app/icons';
import { toast } from 'sonner';
import type { Recording, Session } from '../domain/model';
import {
  deleteRecording,
  listRecordings,
  clearTemporaryExports,
  mediaFile,
  renameProject,
} from '../storage/store';
import { formatTime, errorText } from '@/src/lib/format';
import { AppHeader, Choice } from '@/src/components/app/app';
import { Button } from '@/src/components/ui/button';
import { Badge } from '@/src/components/ui/badge';
import { Card } from '@/src/components/ui/card';
import { Input } from '@/src/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/src/components/ui/input-group';
import { Skeleton } from '@/src/components/ui/skeleton';
import { Kbd } from '@/src/components/ui/kbd';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/src/components/ui/empty';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/src/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/src/components/ui/alert-dialog';
import { Alert, AlertDescription } from '@/src/components/ui/alert';
import { posterUrl } from './thumbs';
import { Mascot } from '@/src/components/brand/brand';

function Poster({ recording }: { recording: Recording }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (recording.status !== 'ready') return;
    let disposed = false,
      created: string | null = null;
    void mediaFile(recording.mediaRef)
      .then((file) => posterUrl(file, recording))
      .then((u) => {
        created = u;
        if (disposed && u) URL.revokeObjectURL(u);
        else setUrl(u);
      })
      .catch(() => {});
    return () => {
      disposed = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [recording.id, recording.status, recording.mediaRef]);
  const SourceIcon = recording.source === 'tab' ? AppWindow : Monitor;
  return (
    <div className="relative grid aspect-[16/9] place-items-center overflow-hidden bg-gradient-to-br from-accent to-muted text-muted-foreground">
      {url ? (
        <img
          src={url}
          alt=""
          className="size-full object-cover object-top transition-transform duration-300 group-hover:scale-[1.02]"
        />
      ) : (
        <SourceIcon className="size-8" aria-hidden />
      )}
    </div>
  );
}

type Sort = 'newest' | 'oldest' | 'name' | 'length';

function ProjectCard({
  recording,
  active,
  onRename,
  onDelete,
}: {
  recording: Recording;
  active: boolean;
  onRename: (name: string) => Promise<void>;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(recording.name);
  const ready = recording.status === 'ready';
  const href = `/editor.html?project=${recording.id}`;
  const finish = async (save: boolean) => {
    setEditing(false);
    if (save && draft.trim() && draft !== recording.name) await onRename(draft);
    else setDraft(recording.name);
  };
  const created = new Date(recording.createdAt).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  return (
    <Card className="group relative gap-0 overflow-hidden rounded-2xl border-2 border-primary/10 p-0 shadow-sm transition-[box-shadow,border-color,transform] hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-lg focus-within:border-primary/35">
      <Poster recording={recording} />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="secondary"
              size="icon-sm"
              aria-label={`Actions for ${recording.name}`}
              className="absolute top-2 right-2 z-10 bg-card/90 opacity-0 shadow-sm backdrop-blur group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
            />
          }
        >
          <EllipsisVertical />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44 p-1">
          {ready && (
            <DropdownMenuItem render={<a href={href} />}>
              <ExternalLink /> Open
            </DropdownMenuItem>
          )}
          {ready && (
            <DropdownMenuItem onClick={() => setEditing(true)}>
              <Pencil /> Rename
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={active}
            onClick={onDelete}
            aria-label={`Delete ${recording.name}`}
          >
            <Trash2 /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-4 pt-3.5 pb-4">
        {editing ? (
          <Input
            autoFocus
            aria-label="Project name"
            value={draft}
            maxLength={200}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void finish(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void finish(true);
              if (e.key === 'Escape') void finish(false);
            }}
            className="relative z-10 h-9"
          />
        ) : (
          <h2
            className="min-w-0 truncate font-heading text-lg leading-tight font-semibold"
            title={recording.name}
          >
            {ready ? (
              // Stretched link: the whole card opens the project.
              <a
                href={href}
                className="outline-none after:absolute after:inset-0 after:rounded-2xl focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
              >
                {recording.name}
              </a>
            ) : (
              recording.name
            )}
          </h2>
        )}
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Delete recording ${recording.name}`}
          title="Delete"
          disabled={active}
          onClick={onDelete}
          className="relative z-10 row-span-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="size-5" />
        </Button>
        <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
          <span className="truncate">{created}</span>
          <span className="flex-1" />
          {ready ? (
            <span className="font-medium tabular-nums">
              {formatTime(recording.durationUs).slice(0, 5)}
            </span>
          ) : (
            <Badge variant="secondary">{active ? 'Recording' : 'Interrupted'}</Badge>
          )}
        </div>
        {!ready && (
          <Alert className="col-span-2 mt-1 px-3 py-2 text-xs">
            <AlertDescription className="text-xs">
              {active
                ? 'Recording in progress — finish it in the pinned recorder tab.'
                : 'Interrupted recording. Capture ended before saving finished.'}
            </AlertDescription>
          </Alert>
        )}
      </div>
    </Card>
  );
}

export function Library() {
  const [recordings, setRecordings] = useState<Recording[]>([]),
    [loaded, setLoaded] = useState(false),
    [activeId, setActiveId] = useState<string>(),
    [usage, setUsage] = useState(''),
    [query, setQuery] = useState(''),
    [sort, setSort] = useState<Sort>('newest'),
    [pendingDelete, setPendingDelete] = useState<Recording | null>(null),
    [confirmClear, setConfirmClear] = useState(false);
  async function refresh() {
    try {
      const [records, stored, estimate] = await Promise.all([
        listRecordings(),
        chrome.storage.session.get('session'),
        navigator.storage.estimate(),
      ]);
      setRecordings(records);
      setActiveId((stored.session as Session | undefined)?.id);
      setUsage(`${((estimate.usage ?? 0) / 1024 / 1024).toFixed(1)} MB on this device`);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setLoaded(true);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = recordings.filter((r) => !q || r.name.toLowerCase().includes(q));
    const by: Record<Sort, (a: Recording, b: Recording) => number> = {
      newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
      oldest: (a, b) => a.createdAt.localeCompare(b.createdAt),
      name: (a, b) => a.name.localeCompare(b.name),
      length: (a, b) => b.durationUs - a.durationUs,
    };
    return [...list].sort(by[sort]);
  }, [recordings, query, sort]);
  return (
    <div className="min-h-screen">
      <AppHeader>
        <span className="hidden text-xs text-muted-foreground md:inline">{usage}</span>
        <Button variant="ghost" size="sm" onClick={() => setConfirmClear(true)}>
          Clear temporary exports
        </Button>
      </AppHeader>
      <main className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="grid gap-1.5">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Your recordings</h1>
            <p className="text-sm text-muted-foreground">
              Click Lensprout in the toolbar (or press <Kbd>Ctrl</Kbd> <Kbd>Shift</Kbd> <Kbd>Y</Kbd>
              ) to record your screen or a window.
            </p>
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <InputGroup className="h-9 w-full sm:w-64">
              <InputGroupAddon>
                <Search aria-hidden />
              </InputGroupAddon>
              <InputGroupInput
                aria-label="Search recordings"
                placeholder="Search recordings"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </InputGroup>
            <Choice
              label="Sort recordings"
              value={sort}
              size="default"
              options={[
                { id: 'newest', label: 'Newest first' },
                { id: 'oldest', label: 'Oldest first' },
                { id: 'name', label: 'Name' },
                { id: 'length', label: 'Longest first' },
              ]}
              onChange={(v) => setSort(v as Sort)}
            />
          </div>
        </div>
        {!loaded ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-6" aria-busy>
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-64 rounded-xl" />
            ))}
          </div>
        ) : !recordings.length ? (
          <Empty className="rounded-xl border border-dashed py-16">
            <EmptyHeader>
              <EmptyMedia>
                <Mascot pose="empty" className="size-24" />
              </EmptyMedia>
              <EmptyTitle className="font-heading text-xl">No recordings yet</EmptyTitle>
              <EmptyDescription>
                Click Lensprout in the toolbar (or press <Kbd>Ctrl</Kbd> <Kbd>Shift</Kbd>{' '}
                <Kbd>Y</Kbd>) and pick a screen or window. Clicks and typing become smooth zooms.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : !visible.length ? (
          <Empty className="rounded-xl border border-dashed py-12">
            <EmptyHeader>
              <EmptyMedia>
                <Mascot pose="thinking" className="size-20" />
              </EmptyMedia>
              <EmptyTitle className="font-heading text-xl">No matches</EmptyTitle>
              <EmptyDescription>No recording is named “{query}”.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] items-start gap-6">
            {visible.map((r) => (
              <ProjectCard
                key={r.id}
                recording={r}
                active={r.id === activeId}
                onRename={async (name) => {
                  try {
                    await renameProject(r.id, name);
                    toast.success('Renamed');
                    await refresh();
                  } catch (e) {
                    toast.error(errorText(e));
                  }
                }}
                onDelete={() => setPendingDelete(r)}
              />
            ))}
          </div>
        )}
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <PanelsTopLeft className="size-4" aria-hidden />
          Recordings live in this extension’s browser profile. Uninstalling the extension or
          clearing its storage removes them, so download finished videos to keep a copy.
        </p>
      </main>
      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{pendingDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The source recording and its edits are removed from this device. Exported videos you
              already downloaded are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                const target = pendingDelete;
                setPendingDelete(null);
                if (!target) return;
                try {
                  await deleteRecording(target.id);
                  toast.success(`Deleted “${target.name}”`);
                  await refresh();
                } catch (e) {
                  toast.error(errorText(e));
                }
              }}
            >
              Delete recording
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear temporary exports?</AlertDialogTitle>
            <AlertDialogDescription>
              Removes leftover MP4 exports and unused background images from this profile. Download
              any finished video first. Recordings and projects are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                setConfirmClear(false);
                try {
                  const result = await clearTemporaryExports();
                  toast.success(
                    `${result.removed} temporary exports removed${result.skipped ? `; ${result.skipped} busy files retained` : ''}.`,
                  );
                  await refresh();
                } catch (e) {
                  toast.error(errorText(e));
                }
              }}
            >
              Clear
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
