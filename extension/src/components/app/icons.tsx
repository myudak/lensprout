import type { CSSProperties } from 'react';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  Alert02Icon,
  ArrowExpand01Icon,
  ArrowLeftDoubleIcon,
  ArrowRight01Icon,
  ArrowRightDoubleIcon,
  BlurIcon,
  BrowserIcon,
  Camera01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  CircleIcon,
  CloudOffIcon,
  CloudSavingDone01Icon,
  CloudUploadIcon,
  CommandIcon,
  ComputerIcon,
  Copy01Icon,
  CropIcon,
  CubeIcon,
  DashboardSpeed01Icon,
  DashboardSquare01Icon,
  Delete02Icon,
  Download04Icon,
  FullScreenIcon,
  HelpCircleIcon,
  ImageAdd02Icon,
  KeyboardIcon,
  LaptopIcon,
  Layers01Icon,
  LibraryIcon,
  LinkSquare02Icon,
  MagicWand01Icon,
  Menu01Icon,
  Mic01Icon,
  Moon02Icon,
  MoreVerticalIcon,
  Cursor01Icon,
  NextIcon,
  PaintBoardIcon,
  PauseIcon,
  PencilEdit01Icon,
  PlayIcon,
  PlusSignIcon,
  PreviousIcon,
  Redo03Icon,
  RefreshIcon,
  RepeatIcon,
  RotateLeft01Icon,
  Scissor01Icon,
  Search01Icon,
  SidebarRight01Icon,
  SidebarRightIcon,
  SlidersHorizontalIcon,
  SmartPhone01Icon,
  SparklesIcon,
  SplitIcon,
  StopIcon,
  Sun03Icon,
  Tablet01Icon,
  Target02Icon,
  TextFontIcon,
  Tick02Icon,
  Timer01Icon,
  Undo03Icon,
  Video01Icon,
  ViewOffIcon,
  VolumeHighIcon,
  VolumeMute02Icon,
  ZoomInAreaIcon,
} from '@hugeicons/core-free-icons';

/**
 * App icons from the free Hugeicons set (MIT), under the names the code used with lucide, so a
 * screen keeps reading `<Play />`. Size comes from CSS (`size-4`, or the parent's svg rules).
 */
export type IconProps = {
  className?: string;
  style?: CSSProperties;
  strokeWidth?: number;
  'aria-hidden'?: boolean | 'true' | 'false';
  'aria-label'?: string;
};
export type IconComponent = ((props: IconProps) => React.ReactElement) & { displayName?: string };
function make(icon: IconSvgElement, name: string): IconComponent {
  const Icon = ({ strokeWidth = 1.8, ...props }: IconProps) => (
    <HugeiconsIcon icon={icon} strokeWidth={strokeWidth} aria-hidden={true} {...props} />
  );
  Icon.displayName = name;
  return Icon;
}
/** For code that typed icon props as `LucideIcon`. */
export type LucideIcon = IconComponent;

export const AppWindow = make(BrowserIcon, 'AppWindow');
export const Box = make(CubeIcon, 'Box');
export const Camera = make(Camera01Icon, 'Camera');
export const Check = make(Tick02Icon, 'Check');
export const ChevronRight = make(ArrowRight01Icon, 'ChevronRight');
export const Circle = make(CircleIcon, 'Circle');
export const CircleCheck = make(CheckmarkCircle02Icon, 'CircleCheck');
export const CloudAlert = make(CloudOffIcon, 'CloudAlert');
export const CloudCheck = make(CloudSavingDone01Icon, 'CloudCheck');
export const CloudUpload = make(CloudUploadIcon, 'CloudUpload');
export const Command = make(CommandIcon, 'Command');
export const Copy = make(Copy01Icon, 'Copy');
export const Crop = make(CropIcon, 'Crop');
export const Crosshair = make(Target02Icon, 'Crosshair');
export const Download = make(Download04Icon, 'Download');
export const EllipsisVertical = make(MoreVerticalIcon, 'EllipsisVertical');
export const ExternalLink = make(LinkSquare02Icon, 'ExternalLink');
export const EyeOff = make(BlurIcon, 'EyeOff');
export const Gauge = make(DashboardSpeed01Icon, 'Gauge');
export const HelpCircle = make(HelpCircleIcon, 'HelpCircle');
export const ImagePlus = make(ImageAdd02Icon, 'ImagePlus');
export const Keyboard = make(KeyboardIcon, 'Keyboard');
export const Laptop = make(LaptopIcon, 'Laptop');
export const Layers = make(Layers01Icon, 'Layers');
export const LibraryBig = make(LibraryIcon, 'LibraryBig');
export const MagicWand = make(MagicWand01Icon, 'MagicWand');
export const Maximize = make(FullScreenIcon, 'Maximize');
export const Maximize2 = make(ArrowExpand01Icon, 'Maximize2');
export const Menu = make(Menu01Icon, 'Menu');
export const Mic = make(Mic01Icon, 'Mic');
export const Monitor = make(ComputerIcon, 'Monitor');
export const Moon = make(Moon02Icon, 'Moon');
export const MousePointer2 = make(Cursor01Icon, 'MousePointer2');
export const Palette = make(PaintBoardIcon, 'Palette');
export const PanelRightClose = make(SidebarRightIcon, 'PanelRightClose');
export const PanelRightOpen = make(SidebarRight01Icon, 'PanelRightOpen');
export const PanelsTopLeft = make(DashboardSquare01Icon, 'PanelsTopLeft');
export const Pause = make(PauseIcon, 'Pause');
export const Pencil = make(PencilEdit01Icon, 'Pencil');
export const Play = make(PlayIcon, 'Play');
export const Plus = make(PlusSignIcon, 'Plus');
export const Redo2 = make(Redo03Icon, 'Redo2');
export const RefreshCw = make(RefreshIcon, 'RefreshCw');
export const Repeat = make(RepeatIcon, 'Repeat');
export const RotateCcw = make(RotateLeft01Icon, 'RotateCcw');
export const Rows3 = make(Layers01Icon, 'Rows3');
export const Scissors = make(Scissor01Icon, 'Scissors');
export const Search = make(Search01Icon, 'Search');
export const SkipBack = make(PreviousIcon, 'SkipBack');
export const SkipForward = make(NextIcon, 'SkipForward');
export const SlidersHorizontal = make(SlidersHorizontalIcon, 'SlidersHorizontal');
export const Smartphone = make(SmartPhone01Icon, 'Smartphone');
export const Sparkles = make(SparklesIcon, 'Sparkles');
export const Square = make(StopIcon, 'Square');
export const SquareSplitHorizontal = make(SplitIcon, 'SquareSplitHorizontal');
export const StepBack = make(ArrowLeftDoubleIcon, 'StepBack');
export const StepForward = make(ArrowRightDoubleIcon, 'StepForward');
export const Sun = make(Sun03Icon, 'Sun');
export const Tablet = make(Tablet01Icon, 'Tablet');
export const Timer = make(Timer01Icon, 'Timer');
export const Trash2 = make(Delete02Icon, 'Trash2');
export const TriangleAlert = make(Alert02Icon, 'TriangleAlert');
export const Type = make(TextFontIcon, 'Type');
export const Undo2 = make(Undo03Icon, 'Undo2');
export const Video = make(Video01Icon, 'Video');
export const ViewOff = make(ViewOffIcon, 'ViewOff');
export const Volume2 = make(VolumeHighIcon, 'Volume2');
export const VolumeX = make(VolumeMute02Icon, 'VolumeX');
export const X = make(Cancel01Icon, 'X');
export const ZoomIn = make(ZoomInAreaIcon, 'ZoomIn');
