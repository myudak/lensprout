# Lensprout · 0.7.0

An independently written Chrome Manifest V3 extension in TypeScript. It records a screen or a window (with optional countdown, microphone and webcam), and generates smooth zooms from clicks and typing on web pages. You edit in a local studio (light and dark themes) and export MP4 or GIF. Nothing leaves the device.

## Build and load

Prerequisites: Node 24 or newer, npm, and Chrome with WebCodecs H.264/AAC encoding. Development used Windows, Node 25.6.0 and Chrome for Testing 156.0.8078.4. The manifest minimum is Chrome 116, which is **not** runtime-tested.

```powershell
cd extension
npm ci
npm run build
```

To load it:

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select `extension/.output/chrome-mv3`.
3. Pin **Lensprout**.

**After every rebuild, click the reload arrow on Lensprout in `chrome://extensions`.** Chrome serves rebuilt pages immediately but keeps the old manifest/service worker until reloaded; the pages show a Reload extension notice when that happens. When upgrading from 0.1.0, Chrome may ask you to approve the new screen-capture and display permissions. Existing projects migrate automatically.

## Record

1. Click the toolbar button or press **Ctrl+Shift+Y**. A pinned recorder tab opens.
2. Choose whether to include system audio. (Recording is screen or window only; Chrome asks which one after you click Start.)
   - Optionally pick a **Camera** (preview shown) and a **Microphone** (level meter, volume, Noise suppression). Chrome asks for permission on this page the first time.
   - Pick a **Countdown**: Off, 3, 5 or 10 s. These choices are remembered.
3. Click **Start recording**.
   - In screen mode, Chrome's picker appears. Pick a screen or window, then hide Chrome's "sharing your screen" bar.
   - You return to your page. The countdown shows there (and on the toolbar badge); press **Esc** or the toolbar button to cancel. It is never part of the video.
4. Pause or resume from the pinned tab. To stop, use **Stop & open editor** or the **toolbar button**; while paused, the toolbar button resumes.

**What becomes an automatic zoom:**

- clusters of clicks;
- presses longer than 2 s;
- typing in text fields.

A single isolated click does not zoom.

**Tracking coverage:**

- Tab mode tracks the tab's top document.
- Screen mode tracks Chrome web pages, including frames, but not other applications or browser UI.
- If a capture cannot be mapped, the editor says so; add zooms manually with a fixed focus.

**Privacy:** password, one-time-code and card fields are never measured. Only shortcut chords with Ctrl/Alt/Win/⌘ are recorded (for the shortcut overlay); plain typed text never is. The cursor is drawn by Chrome or the OS into the video; the editor can cover it with a larger overlay cursor. The microphone is mixed into the recording's audio; the webcam is saved as a second local file.

## Edit

- **Preview:** volume, frame step, jump to start/end, play, scrub, speed, loop, fullscreen. The clock shows the exported video's time, after cuts and speed changes.
- **Timeline:**
  - **Add segment** adds Zoom, Trim (cut out), Crop, Speed, Audio, Text or Blur at the playhead; the magnifier button adds a zoom directly.
  - Segments sit on numbered tracks. Drag to move (up or down to change track), pull the edges to resize, Shift-click to select several, and **Split** at the playhead.
  - Zooms, speed and audio segments can't overlap their own kind.
  - **Ctrl/⌘ + scroll** (or pinch) zooms the timeline. **Ctrl/⌘ = / − / 0** zoom in, out or fit instead of zooming the page.
  - Orange handles on the clip lane trim the start and end.
- **Segment panel:**
  - Trim removes the range.
  - Speed offers 0.25–8×; the audio pitch follows.
  - Audio offers mute or volume.
  - Text has content, style, size and color; you position it with presets or by dragging on the preview.
  - Blur has an area box (it follows the camera) and a strength.
- **Crop:**
  - **Crop browser bars** (screen/window recordings) keeps only the web page, so the video feels full screen.
  - You can also drag a crop frame or type percentages.
  - The crop applies to the whole video.
- **Style:** aspect (Native, 16:9, 9:16, 1:1, 4:3); background (Image: local wallpaper pack in local builds, Lensprout wallpapers or custom image, with blur; Hidden, Gradient, Color); padding, corners, shadow; **cursor** (overlay cursor with size, shape, color, shadow; highlight ring/halo/spotlight with color, size, opacity); click animation; motion blur; keyboard-shortcut overlay.
- **Zoom:** per segment, Follow cursor or Fixed focus. Fixed focus is set on a minimap in Target or Frame mode. Follow cursor has an **offset pad**: drag where the cursor should sit inside the zoomed view (for example lower left to see more up and to the right). Depth has presets plus a slider, and timing is numeric. The Global tab holds the default depth, the default cursor offset (with apply-to-all), the typing toggle and regenerate.
- **Stage** (Style): Flat or **3D**; device frame (browser, laptop, tablet, phone, monitor) in silver or space gray; resting tilt and perspective. Each zoom picks a **camera move** (tilt, orbit, dolly, swing toward clicks) in the Zoom panel, with a default for automatic zooms. Motion blur covers the turns. Background **motion** (drift, aurora, waves) and **cursor packs** live in Style too. 3D needs WebGL2.
- **Camera** (recordings with a webcam): layout (bubble, side by side, stacked) with camera share; shape, corner, size, margin, mirror, shadow, border. **Camera segments** on the timeline hide the webcam or make it small, large or full frame for a range, easing in and out.
- **Clip:** numeric trim and source information.
- **Shortcuts:**
  - Space: play/pause
  - ←/→: frame step (⇧ for 1 s)
  - Home/End: jump to start/end
  - A: add zoom; S: split
  - Delete: remove selection
  - Ctrl+Z / Ctrl+Shift+Z: undo / redo
  - Esc: deselect
- **Saving:** edits autosave after 400 ms.
- **Export video:** MP4 (720p–4K, 30/60 fps) or **GIF** (480–960 px, 10–20 fps, loop), then download.
- **Smart trim** (timeline sparkle button, Tools menu, Ctrl+K): finds still, silent and typing stretches and offers speed-ups and cuts as normal segments.
- **Style → Presets:** save the look, apply it to another project, or make it the default for new recordings. **Style → Sounds:** click and keyboard sounds. **Canvas → Fill and follow:** vertical (9:16) videos that pan with the cursor.

## UI stack

React 19 and Tailwind v4, with **shadcn/ui Base UI** components in the **base-maia** style, **Hugeicons** (free, MIT), sonner toasts, a cmdk palette, react-resizable-panels and a desktop-style **menubar**. The Lensprout look covers the palette, an SVG mascot and fonts bundled locally. Theme and font can be switched under View in the editor menu.

To add a component:

```powershell
node scripts/shadcn-add.mjs hover-card
```

This fetches the base-maia item and its registry dependencies, swaps icon placeholders for Hugeicons and rewrites imports. It records provenance in `src/components/ui/registry.json`; re-apply the local changes listed there after a re-fetch. Do not install the `shadcn` npm package, because it fails `npm audit`.

Extension icons are generated from the mascot by `scripts/build-icons.mjs`, which runs before build and zip.

## Development and verification

```powershell
npm run dev
npm run typecheck
npm test
npx playwright install chromium
npm run build
npm run test:browser
npm run build
npm run zip
```

Browser tests run a synthetic page on `127.0.0.1:4178` in a temporary Chromium profile, using `--allowlisted-extension-id`. The devices scenario injects a synthetic camera and microphone into the recorder page (Chromium's fake-device flag breaks tab capture). They add test-only modules to the unpacked output, so **build again before distributing**.

Screen mode is not automated: headless auto-selection crashed the browser, and a headed run would capture the real screen. Artifacts (screenshots, axe results, export summaries) go to `test-results/`.

## Limits

- 30-minute wall-clock guard (not a measured performance guarantee). Long sessions, HiDPI/multi-monitor and window-border mapping on other systems are unverified.
- Pausing disables tracks; the time map removes those intervals in preview and export.
- After stopping, the WebM is remuxed for fast seeking. If that fails, the original file is kept.
- Recordings live in this extension's profile storage (IndexedDB + OPFS). Uninstalling or clearing storage removes them.
- Interrupted recordings are marked and can be deleted; there is no repair.
- No account, backend, upload or native companion.
- The real cursor stays in the video under the overlay; it cannot be smoothed or removed. Very fast moves can briefly show it.
- Webcam/screen alignment uses recorder start times; lip-sync is not measured. Camera and microphone are tested with synthetic streams only.

## Code map

Start with [ARCHITECTURE](../docs/ARCHITECTURE.md); [DECISIONS](../docs/DECISIONS.md) explains why, and [CHANGELOG](../CHANGELOG.md) lists what changed per version.

| Area                                             | Files                                                                      |
| ------------------------------------------------ | -------------------------------------------------------------------------- |
| Controller, input collection                     | `entrypoints/background.ts`, `entrypoints/events.content.ts`               |
| Recorder, capture, mapping                       | `entrypoints/recorder/`, `src/capture/record.ts`, `clock.ts`, `mapping.ts` |
| Schema, migration, time map, edit commands       | `src/domain/`                                                              |
| Planner, camera, renderer, backgrounds, overlays | `src/engine/`                                                              |
| IndexedDB and OPFS                               | `src/storage/store.ts`                                                     |
| Editor, timeline, panels, library                | `entrypoints/editor/`, `src/ui/`                                           |
| MP4 worker                                       | `src/export/`                                                              |
| Unit, fixture and browser tests                  | `tests/`                                                                   |

The extension key is a newly generated public key, unrelated to the reference extension. Keep it to preserve the extension ID and stored projects. All source here is newly written; `../extracted/` and `../download.zip` are static research inputs only.

## Dependency notices

Build and zip regenerate `public/THIRD_PARTY_NOTICES.txt`, including license texts and pinned source URLs (Mediabunny is MPL-2.0). No distribution license has been selected for the new source.
