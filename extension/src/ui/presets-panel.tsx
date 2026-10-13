import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { Project, Recording } from '../domain/model';
import {
  applyStyle,
  extractStyle,
  loadPresets,
  savePresets,
  type Preset,
  type PresetStore,
} from '../domain/presets';
import { errorText } from '@/src/lib/format';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { SwitchRow, Choice } from '@/src/components/app/app';

type Update = (change: (p: Project) => Project, coalesce?: string) => void;

/**
 * Style presets: save this project's look, apply a saved look, and pick the default for new
 * recordings. The timeline, crop and name are never part of a preset.
 */
export function PresetControls({
  project,
  recording,
  update,
}: {
  project: Project;
  recording: Recording;
  update: Update;
}) {
  const [store, setStore] = useState<PresetStore>({ presets: [], defaultId: null }),
    [selected, setSelected] = useState(''),
    [name, setName] = useState('');
  useEffect(() => {
    void loadPresets().then((s) => {
      setStore(s);
      setSelected(s.presets[0]?.id ?? '');
    });
  }, []);
  const persist = async (next: PresetStore) => {
    setStore(next);
    await savePresets(next).catch((e) => toast.error(errorText(e)));
  };
  const current = store.presets.find((p) => p.id === selected);
  async function save() {
    const preset: Preset = {
      id: crypto.randomUUID(),
      name: name.trim().slice(0, 60) || `Style ${store.presets.length + 1}`,
      style: extractStyle(project),
      createdAt: new Date().toISOString(),
    };
    await persist({ ...store, presets: [...store.presets, preset] });
    setSelected(preset.id);
    setName('');
    toast.success(`Saved “${preset.name}”`);
  }
  function apply() {
    if (!current) return;
    try {
      update((p) => applyStyle(p, current.style, recording));
      toast.success(`Applied “${current.name}”`);
    } catch (e) {
      toast.error(`This preset no longer fits: ${errorText(e)}`);
    }
  }
  return (
    <div className="grid gap-3">
      {store.presets.length > 0 && (
        <>
          <div className="flex items-center gap-2">
            <Choice
              label="Style preset"
              className="min-w-0 flex-1"
              value={selected}
              options={store.presets.map((p) => ({
                id: p.id,
                label: `${p.name}${p.id === store.defaultId ? ' (default)' : ''}`,
              }))}
              onChange={setSelected}
            />
            <Button size="sm" onClick={apply} disabled={!current}>
              Apply
            </Button>
          </div>
          {current && (
            <div className="flex flex-wrap items-center gap-2">
              <SwitchRow
                label="Use for new recordings"
                checked={store.defaultId === current.id}
                onChange={(on) => void persist({ ...store, defaultId: on ? current.id : null })}
              />
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive"
                onClick={() =>
                  void persist({
                    presets: store.presets.filter((p) => p.id !== current.id),
                    defaultId: store.defaultId === current.id ? null : store.defaultId,
                  }).then(() =>
                    setSelected(store.presets.find((p) => p.id !== current.id)?.id ?? ''),
                  )
                }
              >
                Delete preset
              </Button>
            </div>
          )}
        </>
      )}
      <div className="flex items-center gap-2">
        <Input
          aria-label="New preset name"
          placeholder="Preset name"
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-8 min-w-0 flex-1"
        />
        <Button size="sm" variant="secondary" onClick={() => void save()}>
          Save current style
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        A preset keeps the look (background, frame, 3D, cursor, webcam, effects, zoom defaults,
        export) but not the crop or the timeline.
      </p>
    </div>
  );
}
