# Product specification

Lensprout 0.7.x. A Chrome extension that records a screen or window, adds automatic zoom, and lets the user edit and export the video locally. There is no account, backend or upload.

## Primary flow

Toolbar button or **Ctrl+Shift+Y** → recorder tab (system audio, microphone, webcam, countdown) → **Start recording** → Chrome's screen/window picker → work → stop (recorder tab or toolbar) → editor opens with automatic zooms → edit and preview → export MP4 or GIF.

Saving a project and exporting a video are separate actions. The recording and its input events are immutable inputs; the project holds the edits.

## Scope

| Shipped | Not in scope (yet) |
| --- | --- |
| Screen/window capture via Chrome's picker, system audio, microphone mixed in, webcam as a separate file | Webcam background removal; desktop-wide pointer tracking (needs a native companion) |
| Start, pause/resume, stop from the recorder or toolbar; countdown Off/3/5/10 s, cancellable | Countdown on pages Chrome forbids scripting (badge only) |
| Pointer, caret and modifier-chord timelines with surface geometry | Pointer tracking in non-Chrome apps |
| Automatic editable zooms from click clusters, long presses and typing | Captions and transcripts |
| Multi-track segments: zoom, trim/cut, speed, audio volume, text, blur, camera; project crop including "crop browser bars" | Per-time-range crop; audio boost above 100% |
| Styling: aspect presets, vertical fill, backgrounds, padding/corners/shadow, overlay cursor packs and highlight, click animation, sounds, motion blur, shortcut overlay, presets | Replacing or smoothing the real cursor baked into captures |
| 3D stage with camera moves, device frames, background motion; webcam layouts | Photographic or licensed device models |
| Local MP4 export 720p–4K at 30/60 fps with audio; GIF export | Cloud publishing, sharing and collaboration |
| Local projects with schema migrations; library with search, sort, rename, delete | Project import/export packages |

## Editor

- **Top bar:** logo, project name, a menubar (File, Edit, Insert, View, Playback, Tools, Help), save status, undo/redo, Ctrl+K palette, Export, and the theme toggle.
- **Preview:** transport (volume, frame step, play, time, scrub, speed, loop, fullscreen).
- **Icon rail and inspector:**
  - **Style:** presets, stage, canvas, background, frame, cursor, effects, sounds.
  - **Zoom:** Segment and Global scopes.
  - **Segment**, **Crop**, **Clip**, **Camera**, **Export**, **Help**.
- **Timeline:** add-segment menu, split/delete/undo/regenerate, smart trim, timeline zoom (Ctrl + wheel), numbered tracks, filmstrip and trim handles.
- **Themes:** light and dark.

**Zooms:**
- Select one with a click, or several with Shift. Drag to move, drag edges to resize, edit start and end numerically, split at the playhead, or add with a double-click.
- Fixed focus is set on a minimap; follow-cursor mode follows the recorded pointer with an adjustable offset.
- Regenerating replaces only generated segments and preserves manual edits.

## Functional requirements

| ID | Requirement | Acceptance criterion |
| --- | --- | --- |
| F01 | Capture | Media corresponds to the chosen screen/window; the recorder tab is not captured by accident. |
| F02 | Recording controls | State is visible; stop produces a saved project; pausing leaves no gap in the project timebase. |
| F03 | Input collection | Pointer activity is captured only for the active session, with coordinates, timestamps and geometry. |
| F04 | Persistence | Media writes complete before a recording is marked ready; reopening loads media, events and edits. |
| F05 | Auto zoom | The planner produces valid, bounded, deterministic segments from a fixed input timeline. |
| F06 | Edit zooms | Add, resize, adjust and delete change the preview and survive reload; invalid ranges are prevented. |
| F07 | Preview and seek | Seeking to the same timestamp gives the same camera transform, whatever the playback path. |
| F08 | Trim | Preview and export use the selected range; the source video is kept. |
| F09 | Export | Output matches the preview's range, composition and camera within tested tolerances. |
| F10 | Audio | Captured audio is kept in export; unsupported encoding is explained, never silently dropped. |
| F11 | Local operation | Recording, editing and export work without any backend. |
| F12 | Failure recovery | Permission denial, source closure, storage and codec failures show a clear status and never claim success. |
| F13 | Cancel export | Cancelling cleans up and never produces a file labelled complete. |
| F14 | Accessibility | Controls have labels, focus and keyboard operation; state never relies on color alone (axe: 0 violations). |
| F15 | Countdown | Visible on the recorded page, absent from the recording; cancelling releases the capture. |
| F16 | Microphone | The recording's audio contains the mic at the chosen volume, plus system audio when enabled. |
| F17 | Webcam | Recorded separately, aligned to the screen, styled globally and per segment, identical in preview and export. |
| F18 | Cursor | Overlay and highlight follow the recorded pointer exactly in preview and export. |
| F19 | Offset | Follow-cursor zooms keep the cursor at the chosen off-center position (per zoom, with a default). |
| F20 | 3D stage | Moves, device frames and background motion match between preview and export; without WebGL2 both render flat with a notice. |
| F21 | Webcam layouts | Picture in picture, side by side, stacked, full and hidden, globally and per segment, with eased transitions. |
| F22 | Cursor packs | Pack styles draw exactly on the recorded pointer, in the screen plane. |
| F23 | GIF export | A GIF of the edited video (same renderer) at the chosen width, fps and loop setting. |
| F24 | Smart trim | Suggested speed-ups and cuts become editable segments; speech over a still screen is never cut. |
| F25 | Sounds | Optional click and key sounds play in preview and are exported, even for recordings without audio. |
| F26 | Vertical fill | Non-native aspects can fill the frame and follow the cursor. |
| F27 | Presets | A saved look can be applied to any project and set as the default for new recordings. |

## States

- Recording: idle, requesting access, preparing, countdown, recording, paused, stopping, saved, failed.
- Editor: loading, ready, modified, saving, saved, failed.
- Export: idle, checking capabilities, rendering, finalizing, completed, cancelled, failed.

Starting or stopping twice, stale messages, and closing the recorder must never create an untracked session. One recording at a time.

## Limits the UI explains

- **Pointer tracking:** content scripts cannot see Chrome-internal pages or other desktop apps, so zooms there need manual placement. When the captured surface cannot be mapped, the editor says so.
- **Output:** aspect native/16:9/9:16/1:1/4:3, short side 720–2160 px, 30/60 fps (long side ≤ 3840). Combinations beyond 720p30 depend on the hardware encoder and are checked at export time.
- **Session length:** a 30-minute wall-clock guard exists; long sessions and the oldest allowed Chrome version are unmeasured.
