import {
  Crop,
  EyeOff,
  Gauge,
  Scissors,
  Type,
  Video,
  Volume2,
  ZoomIn,
  type LucideIcon,
} from '@/src/components/app/icons';
import type { ItemKind } from '../domain/segments';

/** Display name, icon and color token for each timeline item type (and the project-wide crop). */
export const KIND_INFO: Record<
  ItemKind | 'crop',
  { label: string; icon: LucideIcon; color: string }
> = {
  zoom: { label: 'Zoom', icon: ZoomIn, color: 'var(--seg-zoom)' },
  cut: { label: 'Trim', icon: Scissors, color: 'var(--seg-cut)' },
  crop: { label: 'Crop', icon: Crop, color: 'var(--primary)' },
  speed: { label: 'Speed', icon: Gauge, color: 'var(--seg-speed)' },
  audio: { label: 'Audio', icon: Volume2, color: 'var(--seg-audio)' },
  text: { label: 'Text', icon: Type, color: 'var(--seg-text)' },
  blur: { label: 'Blur', icon: EyeOff, color: 'var(--seg-blur)' },
  camera: { label: 'Camera', icon: Video, color: 'var(--seg-camera)' },
};
