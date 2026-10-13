import {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarGroup,
  MenubarItem,
  MenubarMenu,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from '@/src/components/ui/menubar';
import type { ItemKind } from '../domain/segments';
import { KIND_INFO } from './kinds';
import { FONTS, useTheme, type FontChoice, type ThemeChoice } from './theme';

export type EditorPanel = 'style' | 'zoom' | 'segment' | 'crop' | 'clip' | 'camera' | 'help';
export type MenuActions = {
  library: () => void;
  newRecording: () => void;
  exportVideo: () => void;
  exportGif: () => void;
  presets: () => void;
  smartTrim: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  split: () => void;
  remove: () => void;
  hasSelection: boolean;
  regenerate: () => void;
  add: (kind: ItemKind | 'crop') => void;
  hasCamera: boolean;
  panel: (panel: EditorPanel) => void;
  fitTimeline: () => void;
  toggleInspector: () => void;
  inspectorOpen: boolean;
  fullscreen: () => void;
  togglePlay: () => void;
  playing: boolean;
  loop: boolean;
  setLoop: (loop: boolean) => void;
  rate: number;
  setRate: (rate: number) => void;
  muted: boolean;
  setMuted: (muted: boolean) => void;
};

/** Desktop-style menubar for the editor (shadcn Menubar on Base UI). Mirrors the palette actions. */
export function EditorMenubar({ actions: a }: { actions: MenuActions }) {
  const { theme, setTheme, font, setFont } = useTheme();
  const kinds = (Object.keys(KIND_INFO) as (ItemKind | 'crop')[]).filter(
    (k) => a.hasCamera || k !== 'camera',
  );
  return (
    <Menubar aria-label="Editor menu" className="h-9 border-none bg-transparent shadow-none">
      <MenubarMenu>
        <MenubarTrigger>File</MenubarTrigger>
        <MenubarContent className="w-60">
          <MenubarGroup>
            <MenubarItem onClick={a.library}>Library</MenubarItem>
            <MenubarItem onClick={a.newRecording}>New recording…</MenubarItem>
          </MenubarGroup>
          <MenubarSeparator />
          <MenubarGroup>
            <MenubarItem onClick={a.exportVideo}>
              Export video… <MenubarShortcut>E</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onClick={a.exportGif}>Export GIF…</MenubarItem>
          </MenubarGroup>
          <MenubarSeparator />
          <MenubarItem onClick={a.presets}>Style presets…</MenubarItem>
        </MenubarContent>
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger>Edit</MenubarTrigger>
        <MenubarContent className="w-60">
          <MenubarGroup>
            <MenubarItem disabled={!a.canUndo} onClick={a.undo}>
              Undo <MenubarShortcut>Ctrl Z</MenubarShortcut>
            </MenubarItem>
            <MenubarItem disabled={!a.canRedo} onClick={a.redo}>
              Redo <MenubarShortcut>Ctrl ⇧ Z</MenubarShortcut>
            </MenubarItem>
          </MenubarGroup>
          <MenubarSeparator />
          <MenubarGroup>
            <MenubarItem onClick={a.split}>
              Split at playhead <MenubarShortcut>S</MenubarShortcut>
            </MenubarItem>
            <MenubarItem disabled={!a.hasSelection} onClick={a.remove}>
              Delete selection <MenubarShortcut>Del</MenubarShortcut>
            </MenubarItem>
          </MenubarGroup>
          <MenubarSeparator />
          <MenubarItem onClick={a.regenerate}>Regenerate auto zoom</MenubarItem>
        </MenubarContent>
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger>Insert</MenubarTrigger>
        <MenubarContent className="w-52">
          {kinds.map((kind) => {
            const Icon = KIND_INFO[kind].icon;
            return (
              <MenubarItem key={kind} onClick={() => a.add(kind)}>
                <Icon style={{ color: KIND_INFO[kind].color }} /> {KIND_INFO[kind].label}
                {kind === 'zoom' && <MenubarShortcut>A</MenubarShortcut>}
              </MenubarItem>
            );
          })}
        </MenubarContent>
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger>View</MenubarTrigger>
        <MenubarContent className="w-60">
          <MenubarSub>
            <MenubarSubTrigger>Panel</MenubarSubTrigger>
            <MenubarSubContent>
              {(
                [
                  ['style', 'Style'],
                  ['zoom', 'Zoom'],
                  ['segment', 'Segment'],
                  ['crop', 'Crop'],
                  ['clip', 'Clip'],
                  ...(a.hasCamera ? [['camera', 'Camera'] as const] : []),
                ] as const
              ).map(([id, label]) => (
                <MenubarItem key={id} onClick={() => a.panel(id)}>
                  {label}
                </MenubarItem>
              ))}
            </MenubarSubContent>
          </MenubarSub>
          <MenubarCheckboxItem checked={a.inspectorOpen} onCheckedChange={a.toggleInspector}>
            Inspector
          </MenubarCheckboxItem>
          <MenubarItem onClick={a.fitTimeline}>
            Fit timeline <MenubarShortcut>Ctrl 0</MenubarShortcut>
          </MenubarItem>
          <MenubarItem onClick={a.fullscreen}>Fullscreen preview</MenubarItem>
          <MenubarSeparator />
          <MenubarSub>
            <MenubarSubTrigger>Theme</MenubarSubTrigger>
            <MenubarSubContent>
              <MenubarRadioGroup value={theme} onValueChange={(v) => setTheme(v as ThemeChoice)}>
                <MenubarRadioItem value="light">Light</MenubarRadioItem>
                <MenubarRadioItem value="dark">Dark</MenubarRadioItem>
                <MenubarRadioItem value="system">System</MenubarRadioItem>
              </MenubarRadioGroup>
            </MenubarSubContent>
          </MenubarSub>
          <MenubarSub>
            <MenubarSubTrigger>Font</MenubarSubTrigger>
            <MenubarSubContent>
              <MenubarRadioGroup value={font} onValueChange={(v) => setFont(v as FontChoice)}>
                {FONTS.map((f) => (
                  <MenubarRadioItem key={f.id} value={f.id}>
                    {f.label}
                  </MenubarRadioItem>
                ))}
              </MenubarRadioGroup>
            </MenubarSubContent>
          </MenubarSub>
        </MenubarContent>
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger>Playback</MenubarTrigger>
        <MenubarContent className="w-52">
          <MenubarItem onClick={a.togglePlay}>
            {a.playing ? 'Pause' : 'Play'} <MenubarShortcut>Space</MenubarShortcut>
          </MenubarItem>
          <MenubarCheckboxItem checked={a.loop} onCheckedChange={(v) => a.setLoop(!!v)}>
            Loop
          </MenubarCheckboxItem>
          <MenubarCheckboxItem checked={a.muted} onCheckedChange={(v) => a.setMuted(!!v)}>
            Mute
          </MenubarCheckboxItem>
          <MenubarSub>
            <MenubarSubTrigger>Speed</MenubarSubTrigger>
            <MenubarSubContent>
              <MenubarRadioGroup value={String(a.rate)} onValueChange={(v) => a.setRate(Number(v))}>
                {[0.5, 1, 1.5, 2].map((r) => (
                  <MenubarRadioItem key={r} value={String(r)}>
                    {r}×
                  </MenubarRadioItem>
                ))}
              </MenubarRadioGroup>
            </MenubarSubContent>
          </MenubarSub>
        </MenubarContent>
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger>Tools</MenubarTrigger>
        <MenubarContent className="w-56">
          <MenubarItem onClick={a.smartTrim}>Smart trim…</MenubarItem>
          <MenubarItem onClick={a.presets}>Style presets…</MenubarItem>
        </MenubarContent>
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger>Help</MenubarTrigger>
        <MenubarContent className="w-52">
          <MenubarItem onClick={() => a.panel('help')}>Keyboard shortcuts</MenubarItem>
        </MenubarContent>
      </MenubarMenu>
    </Menubar>
  );
}
