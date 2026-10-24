# Chrome Web Store listing: Lensprout 0.7.0

Live: https://chromewebstore.google.com/detail/lensprout/eoikohnhcikanpomopphklcicidmlkaj

Upload `extension/.output/lensprout-0.7.0-chrome.zip` (build it with `npm run zip` in `extension/`).

## Product details

**Title** (comes from the package): Lensprout

**Summary** (comes from the package): Record your screen with automatic zoom, edit it and export, all on your device.

**Description** (paste as plain text):

```
Lensprout turns plain screen recordings into polished videos that zoom where you click.

Record your screen or a window in Chrome. Lensprout notes where you click and type on web pages, and turns that into smooth camera moves. Then fine-tune everything in a full editor inside the extension and export an MP4 or a GIF. No account, no upload, no watermark: your recordings never leave your device.

RECORD
• Record a screen or a window, up to 4K at 60 fps
• System audio and a microphone, with level meter, volume and noise suppression
• Webcam, recorded separately so you can change its layout later
• Countdown before recording, pause and resume, start or stop with Ctrl+Shift+Y

AUTOMATIC ZOOM
• Zooms placed automatically from clicks, long presses and typing on web pages
• Smooth spring camera that follows the cursor, with an adjustable offset
• Every zoom is editable: move, resize, change depth, or pin a fixed focus point

EDIT
• Multi-track timeline: zoom, trim, speed, audio volume, text, blur and camera segments
• Smart trim suggests speed-ups for idle and typing stretches and cuts for silences
• Crop, including one-click removal of browser bars
• Undo and redo, menubar, Ctrl+K command palette, light and dark themes

STYLE
• Wallpapers, gradients, solid colors or your own image as the background
• Padding, rounded corners and shadow; 16:9, 9:16, 1:1 and 4:3 formats
• Vertical 9:16 fill that follows the cursor, for shorts and reels
• Cursor overlays and highlights, click animations, click and keyboard sounds
• 3D stage with tilt, orbit, dolly and swing camera moves and device frames
• Webcam layouts: bubble, side by side, stacked or full screen
• Save your look as a preset and reuse it

EXPORT
• MP4 from 720p to 4K at 30 or 60 fps, with audio
• GIF at 480, 720 or 960 px
• Rendered locally on your computer

PRIVATE BY DESIGN
Recordings, projects and exports are stored only in the extension's storage on your computer. Lensprout has no servers and collects no data.

Note: automatic zoom follows clicks and typing on web pages in Chrome. In other desktop apps, place zooms by hand in the editor.
```

**Category:** Productivity → Tools (or Workflow & Planning).

**Language:** English.

## Visual assets (this folder)

- Store icon: `icon-128.png`
- Screenshots (1280×800, 24-bit PNG, up to 5): `screenshots/1-auto-zoom.png` … `5-export.png`
- Small promo tile (440×280): `promo-tile-440x280.png`
- Marquee promo tile (1400×560): `marquee-1400x560.png`
- All of these are rebuilt by `node store/scripts/capture.mjs` then `node store/scripts/compose.mjs` (they record the landing site's fictional Acme demo dashboard with the real extension).
- Promo video (optional): a YouTube URL. Upload `landing/public/media/auto-zoom-demo.mp4` to YouTube first if you want one. That clip shows an Apple wallpaper, so re-export it with a Lensprout background before using it publicly.

## Privacy practices tab

**Single purpose:** Record the user's screen or a window, add automatic zoom from their clicks and typing, and let them edit and export the video locally.

**Permission justifications:**

- `desktopCapture`: Records the screen or window the user picks in Chrome's picker.
- `activeTab`, `scripting`: Show the recording countdown on the user's page and inject the input collector that records click and typing positions for automatic zoom.
- Host permission (`http://*/*`, `https://*/*`): Automatic zoom needs click and typing positions on whatever page the user records. Nothing is sent anywhere.
- `tabs`, `webNavigation`: Find the page being recorded and keep collecting input when it navigates or opens frames.
- `system.display`: Map pointer positions to the captured screen when there are several displays.
- `storage`, `unlimitedStorage`: Store recordings, projects and settings on the user's device; videos can be large.

**Remote code:** No, all code is in the package.

**Data usage:** Collects no user data. Check "I do not sell or transfer user data…" and the other certifications.

**Privacy policy URL:** https://lensprout.myudak.com/privacy/

**Homepage URL** (optional): https://lensprout.myudak.com/
