# Changelog

## Unreleased (0.7.x)

- **Privacy policy** page on the landing site (`/privacy/`). The site is deployed on Vercel at https://lensprout-mu.vercel.app.
- **Store packaging:** the release manifest no longer requests `tabCapture` (only the browser tests' tab mode uses it). `npm run zip` omits the manifest `key` (the Chrome Web Store assigns the ID), test files and the local wallpaper pack. The package is renamed `lensprout`.
- **Wallpaper backgrounds:** an optional local pack built from your own images by `scripts/build-wallpapers.py`. It is used by preview, MP4, GIF and the 3D stage, and is never part of a release zip.
- **Inspector:** consistent spacing, round segmented controls that shrink in narrow panels, and the zoom time range on one line.
- **Animated theme toggle** (Magic UI) with a View Transitions reveal; reduced motion switches instantly.
- **Library:** large 16:9 cards with a hover menu; selected toggles keep their contrast in dark mode; shadcn-style scrollbars everywhere.
- **Landing site and blog** (`landing/`).
- **Cleanup:** removed unused components and code, and TypeScript now rejects unused locals and parameters.

## 0.7.0 · 13 Oct 2026

- **Renamed Lensprout:** a new cartoon mascot drawn in SVG, the Coral Playground palette, and generated extension icons.
- **UI kit:** the whole UI is rebuilt on shadcn/ui (Base UI, base-maia) with Hugeicons, and the editor gets a desktop-style menubar.
- **Font switcher:** View → Font offers six bundled pairings.
- **GIF export:** 480/720/960 px, 10/15/20 fps, optional loop.
- **Smart trim:** finds still, idle and typing stretches and silences, and suggests editable speed-up and cut segments.
- **Click and keyboard sounds**, synthesized in code, in both preview and export.
- **Vertical fill:** 9:16 output pans to follow the cursor.
- **Style presets:** save a look and optionally make it the default for new recordings.
- **Cursor:** redrawn pointing hand, grab hand and I-beam.

## 0.6.0 · 12 Oct 2026

- **WebGL2 3D stage:** resting tilt and perspective, and per-zoom tilt, orbit, dolly and swing camera moves with 3D motion blur.
- **Device frames:** procedural browser, laptop, tablet, phone and monitor frames.
- **Animated backgrounds:** drift, aurora and waves.
- **Webcam layouts:** picture in picture, side by side, stacked and full.
- **Cursor packs:** Classic, Glass, Pop, Ink and Sprout.
- **Recorder:** records screens and windows only.
- **Fallback:** without WebGL2, preview and export both render flat.

## 0.5.0 · 12 Oct 2026

- **Countdown** before recording; Esc or the toolbar button cancels it.
- **Microphone** mixed into the recording, with a level meter, volume and noise suppression.
- **Webcam** recorded as its own file, with global style and camera segments (hidden, small, large, fullscreen).
- **Overlay cursor and highlight:** ring, halo or spotlight; cursor size, color and shadow.
- **Follow-cursor offset**, set globally and per zoom.

## 0.4.0 · 11 Oct 2026

- **New UI:** component-based with Tailwind v4, light and dark themes, a resizable layout, right-click menus and a Ctrl+K command palette.
- **Library:** search, sort, rename, and confirmation dialogs.

## 0.3.0 · 11 Oct 2026

- **Multi-track segments:** trim (cut), speed, audio volume, text and blur, alongside zooms.
- **Edit map:** cuts and speed are reflected in preview, the clock and export.
- **Crop:** custom crop, plus one-click removal of browser bars for screen captures.
- **Timeline:** Ctrl + wheel zooms the timeline, not the page.

## 0.2.0 · 11 Oct 2026

- **Capture:** screen and window capture via Chrome's picker, up to 4K/60, and a seekable remux after recording.
- **Typing zoom** from caret positions; password and card fields are ignored.
- **Camera:** a dead-zone camera with look-ahead and smoother springs.
- **Styling:** aspect presets, output quality 720p–4K at 30 or 60 fps, backgrounds, padding, corners, shadow, click effects, motion blur and the shortcut overlay.
- **Schema 2**, with automatic migration of existing projects.

## 0.1.0 · 9 Oct 2026

- **Tab recording** with audio, pause and resume.
- **Automatic zoom** from click clusters.
- **Local editor** with preview, trim and zoom editing.
- **MP4 export** with WebCodecs, saved in IndexedDB and OPFS.
