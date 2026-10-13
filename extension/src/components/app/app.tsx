import { useEffect, useState, type ReactNode } from 'react';
import {
  ChevronRight,
  RefreshCw,
  TriangleAlert,
  type LucideIcon,
} from '@/src/components/app/icons';
import { Logo, Mascot } from '@/src/components/brand/brand';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/src/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/src/components/ui/popover';
import { Input } from '@/src/components/ui/input';
import { Button, buttonVariants } from '@/src/components/ui/button';
import { AnimatedThemeToggler } from '@/src/components/ui/animated-theme-toggler';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/src/components/ui/tooltip';
import { Toaster } from '@/src/components/ui/sonner';
import { Kbd } from '@/src/components/ui/kbd';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/src/components/ui/alert';
import { Switch } from '@/src/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/src/components/ui/toggle-group';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@/src/components/ui/input-group';
import { cn } from '@/src/lib/utils';
import { staleInstall } from '@/src/lib/format';
import { ThemeProvider, useTheme } from '@/src/ui/theme';

/** Theme, tooltips and toasts for every extension page. */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <TooltipProvider delay={350}>
        {children}
        <Toaster position="bottom-right" closeButton />
      </TooltipProvider>
    </ThemeProvider>
  );
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <a
      href="/editor.html"
      title="Lensprout library"
      aria-label="Lensprout library"
      className="flex shrink-0 items-center rounded-xl px-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {compact ? <Mascot className="size-8" /> : <Logo />}
    </a>
  );
}

/**
 * Light/dark toggle with Magic UI's circular reveal (View Transitions). "System" stays available
 * under View → Theme in the editor menubar.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <AnimatedThemeToggler
            theme={resolvedTheme}
            onThemeChange={setTheme}
            aria-label={resolvedTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            className={buttonVariants({ variant: 'ghost', size: 'icon' })}
          />
        }
      />
      <TooltipContent>{resolvedTheme === 'dark' ? 'Light theme' : 'Dark theme'}</TooltipContent>
    </Tooltip>
  );
}

/** Shown when Chrome still runs an older manifest than the rebuilt pages (see staleInstall). */
export function UpdateNotice({ className }: { className?: string }) {
  const [stale] = useState(staleInstall);
  if (!stale) return null;
  return (
    <Alert className={cn('rounded-none border-x-0 border-t-0', className)}>
      <TriangleAlert />
      <AlertTitle>Reload needed</AlertTitle>
      <AlertDescription>
        Lensprout was updated on disk, but Chrome is still running version{' '}
        {chrome.runtime.getManifest().version}. Reload it to finish the update (Chrome may ask to
        allow screen capture).
      </AlertDescription>
      <AlertAction>
        <Button size="sm" onClick={() => chrome.runtime.reload()}>
          <RefreshCw /> Reload extension
        </Button>
      </AlertAction>
    </Alert>
  );
}

export function AppHeader({
  crumb,
  menubar,
  children,
  className,
}: {
  crumb?: ReactNode;
  /** Editor menubar, shown after the breadcrumb on wide screens. */
  menubar?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <>
      <header
        className={cn(
          'sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-card/80 px-3 backdrop-blur-md sm:px-4',
          className,
        )}
      >
        <Brand compact={!!crumb} />
        {crumb && (
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-sm">
            <a
              href="/editor.html"
              className="rounded px-1.5 py-1 text-muted-foreground hover:text-foreground"
            >
              Library
            </a>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            {crumb}
          </nav>
        )}
        {menubar && (
          <>
            <span aria-hidden className="mx-1 hidden h-5 w-px bg-border lg:block" />
            <div className="hidden lg:block">{menubar}</div>
          </>
        )}
        <span className="flex-1" />
        {children}
        <ThemeToggle />
      </header>
      <UpdateNotice />
    </>
  );
}

/** Labelled rail tab (icon over a short label), as in the Lensprout editor concept. */
export function RailButton({
  icon: Icon,
  label,
  active,
  onClick,
  title,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={title}
      onClick={onClick}
      className="flex w-[3.75rem] flex-col items-center gap-1 rounded-xl px-1 py-2 text-[11px] leading-none font-semibold text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-pressed:bg-accent aria-pressed:text-accent-foreground"
    >
      <Icon className="size-5" />
      {label}
    </button>
  );
}

/** Icon-only button with a tooltip (and optional shortcut); the label is its accessible name. */
export function IconAction({
  icon: Icon,
  label,
  shortcut,
  active,
  className,
  variant = 'ghost',
  size = 'icon',
  side = 'top',
  ...rest
}: {
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  active?: boolean;
  variant?: 'ghost' | 'outline' | 'secondary' | 'default';
  size?: 'icon' | 'icon-sm' | 'icon-lg';
  side?: 'top' | 'bottom' | 'left' | 'right';
} & Omit<React.ComponentProps<typeof Button>, 'size' | 'variant'>) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant={variant}
            size={size}
            aria-label={label}
            aria-pressed={active}
            className={cn(active && 'bg-accent text-accent-foreground hover:bg-accent', className)}
            {...rest}
          />
        }
      >
        <Icon />
      </TooltipTrigger>
      <TooltipContent side={side} className="flex items-center gap-2">
        {label}
        {shortcut && <Kbd className="bg-background/20 text-background">{shortcut}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}

/** Single-choice segmented control (ToggleGroup). Items are buttons with aria-pressed. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T;
  options: { id: T; label: ReactNode; title?: string }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <ToggleGroup
      aria-label={label}
      value={[value]}
      onValueChange={(values) => {
        const next = values[0] as T | undefined;
        if (next !== undefined && next !== value) onChange(next);
      }}
      variant="outline"
      className={cn('w-full rounded-full bg-muted/70 p-1', className)}
      spacing={1}
    >
      {options.map((o) => (
        <ToggleGroupItem
          key={o.id}
          value={o.id}
          title={o.title}
          className="h-8 min-w-0 flex-1 shrink truncate rounded-full border-transparent px-2 text-[13px] font-medium text-muted-foreground hover:text-foreground aria-pressed:border-primary/45 aria-pressed:bg-accent aria-pressed:font-semibold aria-pressed:text-accent-foreground aria-pressed:shadow-sm"
        >
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export function SwitchRow({
  label,
  checked,
  onChange,
  disabled,
  description,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  description?: string;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center justify-between gap-3 py-1 text-sm font-medium',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span className="grid gap-0.5">
        {label}
        {description && (
          <span className="text-xs font-normal text-muted-foreground">{description}</span>
        )}
      </span>
      <Switch
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onChange(value)}
      />
    </label>
  );
}

/** Label on the left, control on the right (reference inspector style). */
export function FieldRow({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex min-h-9 items-center justify-between gap-3', className)}>
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex min-w-0 items-center justify-end gap-2">{children}</div>
    </div>
  );
}

/** Numeric input that commits on blur/Enter, so typing does not create one edit per keystroke. */
export function NumberField({
  label,
  value,
  onValue,
  min,
  max,
  step = 0.1,
  suffix,
}: {
  label: string;
  value: number;
  onValue: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  const shown = String(Math.round(value * 1000) / 1000);
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <InputGroup className="h-9">
        <InputGroupInput
          type="number"
          aria-label={label}
          value={draft}
          min={min}
          max={max}
          step={step}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const n = Number(draft);
            if (draft !== '' && Number.isFinite(n)) onValue(n);
            setDraft(shown);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        {suffix && (
          <InputGroupAddon align="inline-end">
            <InputGroupText aria-hidden>{suffix}</InputGroupText>
          </InputGroupAddon>
        )}
      </InputGroup>
    </label>
  );
}

/** A labelled single-choice dropdown (shadcn Select); the trigger is a combobox named `label`. */
export function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
  size = 'sm',
  className,
  disabled,
}: {
  label: string;
  value: T;
  options: { id: T; label: ReactNode }[];
  onChange: (value: T) => void;
  size?: 'sm' | 'default';
  className?: string;
  disabled?: boolean;
}) {
  return (
    <Select
      items={options.map((o) => ({ value: o.id, label: o.label }))}
      value={value}
      onValueChange={(v) => v !== null && onChange(v as T)}
      disabled={disabled}
    >
      <SelectTrigger size={size} aria-label={label} className={cn('min-w-32', className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const SWATCHES = [
  '#ffffff',
  '#111827',
  '#453d70',
  '#e86a47',
  '#b94025',
  '#fabd62',
  '#a6bfa0',
  '#3b82f6',
  '#facc15',
  '#ef4444',
  '#22c55e',
  '#ec4899',
];
/** Color choice: a swatch popover with a hex field and the system picker for anything else. */
export function ColorPicker({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (color: string) => void;
  disabled?: boolean;
}) {
  const [hex, setHex] = useState(value);
  useEffect(() => setHex(value), [value]);
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            aria-label={`${label}: ${value}`}
            className="gap-2 px-2"
          />
        }
      >
        <span
          aria-hidden
          className="size-5 rounded-full border border-black/10 shadow-inner"
          style={{ background: value }}
        />
        <span className="font-mono text-xs uppercase">{value}</span>
      </PopoverTrigger>
      <PopoverContent className="grid w-60 gap-3" align="end">
        <ToggleGroup
          aria-label={label}
          value={[value.toLowerCase()]}
          onValueChange={(v) => v[0] && onChange(v[0] as string)}
          className="grid grid-cols-6 gap-1.5"
        >
          {SWATCHES.map((c) => (
            <ToggleGroupItem
              key={c}
              value={c}
              aria-label={c}
              className="size-8 min-w-0 rounded-full border-2 border-transparent p-0 aria-pressed:border-ring aria-pressed:ring-2 aria-pressed:ring-ring/40"
              style={{ background: c }}
            />
          ))}
        </ToggleGroup>
        <div className="flex items-center gap-2">
          <Input
            aria-label={`${label} hex`}
            value={hex}
            maxLength={7}
            onChange={(e) => {
              setHex(e.target.value);
              if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onChange(e.target.value.toLowerCase());
            }}
            className="h-8 font-mono text-xs"
          />
          <label className="relative grid size-8 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-full border">
            <span className="sr-only">{label}: custom color</span>
            <span aria-hidden className="size-full" style={{ background: value }} />
            <input
              type="color"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Single-choice grid of tiles (shadcn ToggleGroup): device frames, cursor packs, wallpapers,
 * swatches. Each tile is a toggle button named by `label` (aria-pressed marks the choice).
 */
export function TileGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
  itemClassName,
}: {
  label: string;
  value: T | null;
  options: { id: T; label: string; content?: ReactNode; style?: React.CSSProperties }[];
  onChange: (value: T) => void;
  className?: string;
  itemClassName?: string;
}) {
  return (
    <ToggleGroup
      aria-label={label}
      value={value === null ? [] : [value]}
      onValueChange={(values) => {
        const next = values[0] as T | undefined;
        if (next !== undefined && next !== value) onChange(next);
      }}
      className={cn('grid w-full grid-cols-3 gap-1.5', className)}
    >
      {options.map((o) => (
        <ToggleGroupItem
          key={o.id}
          value={o.id}
          aria-label={o.content ? o.label : undefined}
          title={o.label}
          style={o.style}
          className={cn(
            'h-auto min-h-14 flex-col gap-1 rounded-xl border-2 border-transparent bg-muted/50 p-1.5 text-xs text-foreground hover:bg-muted aria-pressed:border-primary aria-pressed:bg-accent aria-pressed:text-accent-foreground',
            itemClassName,
          )}
        >
          {o.content ?? o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export function SectionTitle({ children, badge }: { children: ReactNode; badge?: ReactNode }) {
  return (
    <h3 className="flex items-center gap-2 text-[11px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
      {children}
      {badge}
    </h3>
  );
}
