import type { Project, Recording, InputEvent } from '../domain/model';
export type GifOptions = { width: 480 | 720 | 960; fps: 10 | 15 | 20; loop: boolean };
export const GIF_DEFAULTS: GifOptions = { width: 720, fps: 15, loop: true };
export type ExportRequest =
  | {
      type: 'start';
      project: Project;
      recording: Recording;
      events: InputEvent[];
      outputName: string;
      /** Present for an animated GIF instead of an MP4. */
      gif?: GifOptions;
    }
  | { type: 'cancel' };
export type ExportReply =
  | { type: 'progress'; progress: number }
  | { type: 'done'; name: string }
  | { type: 'cancelled' }
  | { type: 'error'; error: string };
