import {
  Crop,
  Download,
  HelpCircle,
  Maximize2,
  Moon,
  Redo2,
  RefreshCw,
  Scissors,
  SlidersHorizontal,
  SquareSplitHorizontal,
  Sun,
  Trash2,
  Undo2,
  ZoomIn,
  type LucideIcon,
  Sparkles,
} from '@/src/components/app/icons';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/src/components/ui/command';
import type { ItemKind } from '../domain/segments';
import { KIND_INFO } from './kinds';

export type PaletteActions = {
  add: (kind: ItemKind | 'crop') => void;
  split: () => void;
  remove: () => void;
  undo: () => void;
  redo: () => void;
  regenerate: () => void;
  panel: (panel: 'style' | 'zoom' | 'crop' | 'clip' | 'camera' | 'help') => void;
  exportVideo: () => void;
  smartTrim: () => void;
  fitTimeline: () => void;
  theme: (theme: 'light' | 'dark') => void;
};

/** Ctrl/⌘+K: every editor action searchable by name. */
export function CommandPalette({
  open,
  onOpenChange,
  actions,
  hasSelection,
  hasCamera = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: PaletteActions;
  hasSelection: boolean;
  hasCamera?: boolean;
}) {
  const run = (fn: () => void) => () => {
    onOpenChange(false);
    // Let the dialog close (and return focus) before the action changes the page.
    setTimeout(fn, 0);
  };
  const item = (
    icon: LucideIcon,
    label: string,
    fn: () => void,
    shortcut?: string,
    disabled = false,
  ) => {
    const Icon = icon;
    return (
      <CommandItem key={label} value={label} disabled={disabled} onSelect={run(fn)}>
        <Icon /> {label}
        {shortcut && <CommandShortcut>{shortcut}</CommandShortcut>}
      </CommandItem>
    );
  };
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      description="Search editor actions"
    >
      {/* cmdk needs its own root; its `label` names the search input for assistive technology. */}
      <Command label="Search commands" className="p-2 shadow-none">
        <CommandInput placeholder="Type a command or search…" />
        <CommandList>
          <CommandEmpty>No matching command.</CommandEmpty>
          <CommandGroup heading="Add">
            {(Object.keys(KIND_INFO) as (ItemKind | 'crop')[])
              .filter((kind) => hasCamera || kind !== 'camera')
              .map((kind) =>
                item(
                  KIND_INFO[kind].icon,
                  `Add ${KIND_INFO[kind].label.toLowerCase()}`,
                  () => actions.add(kind),
                  kind === 'zoom' ? 'A' : undefined,
                ),
              )}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Edit">
            {item(SquareSplitHorizontal, 'Split segment at playhead', actions.split, 'S')}
            {item(Trash2, 'Delete selected segments', actions.remove, 'Del', !hasSelection)}
            {item(Undo2, 'Undo', actions.undo, 'Ctrl Z')}
            {item(Redo2, 'Redo', actions.redo, 'Ctrl ⇧ Z')}
            {item(RefreshCw, 'Regenerate auto zoom', actions.regenerate)}
            {item(Sparkles, 'Smart trim', actions.smartTrim)}
            {item(Maximize2, 'Fit timeline', actions.fitTimeline, 'Ctrl 0')}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Go to">
            {item(SlidersHorizontal, 'Style panel', () => actions.panel('style'))}
            {item(ZoomIn, 'Zoom panel', () => actions.panel('zoom'))}
            {item(Crop, 'Crop panel', () => actions.panel('crop'))}
            {item(Scissors, 'Clip panel', () => actions.panel('clip'))}
            {item(HelpCircle, 'Keyboard shortcuts', () => actions.panel('help'))}
            {item(Download, 'Export video', actions.exportVideo)}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Theme">
            {item(Sun, 'Light theme', () => actions.theme('light'))}
            {item(Moon, 'Dark theme', () => actions.theme('dark'))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
