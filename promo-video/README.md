# Lensprout promo video

A 45-second motion-graphics promo for the Chrome Web Store listing (via YouTube), the landing site and social media. It is built with [HyperFrames](https://hyperframes.heygen.com), so every scene is HTML/CSS animated by one paused GSAP timeline and rendered frame by frame to MP4.

| Output | Size | File |
| --- | --- | --- |
| 16:9 (YouTube, store, landing) | 1920×1080, 30 fps | `out/lensprout-promo-1920x1080.mp4` |
| 9:16 (Shorts, Reels, TikTok) | 1080×1920, 30 fps | `out/lensprout-promo-1080x1920.mp4` |

## Render

Needs Node.js and FFmpeg on `PATH` (built with Node 25 and FFmpeg 9). The scripts pin `hyperframes@0.8.172`, so renders are reproducible.

```bash
npm run render           # 16:9
npm run render:vertical  # 9:16
npm run render:all       # both
npm run check            # lint, layout, motion and contrast checks (16:9)
npm run dev              # open the Studio preview
```

`npm run audio` regenerates `assets/audio/bed.wav`. Run it only after changing `scripts/make-audio.mjs`.

## Structure

- `index.html`: the 16:9 host. It mounts the background and ten scenes on the timeline, plus the audio.
- `vertical/index.html`: the 9:16 host for the same scenes. A HyperFrames project allows one root composition, so the vertical cut is its own project. `scripts/sync-vertical.mjs` copies `compositions/` and `assets/` into it before a check or render; those copies are gitignored. Edit the originals.
- `compositions/`: one file per scene, `s1-intro` to `s10-outro`, plus `bg`. Each scene uses CSS container queries to switch between the landscape and portrait layouts.
- `assets/brand.css`: brand tokens (cream, coral, apricot, purple, sage, aubergine), the Fredoka and Nunito `@font-face` rules, and the shared scene layout.
- `assets/fonts/`: Fredoka and Nunito woff2 files from `@fontsource` (SIL OFL; licences included).
- `assets/demo/`: the recorded material, captured from the landing site's fictional demo dashboard (`landing/src/demo`, page `/demo/dashboard/`) by `scripts/capture-demo.mjs`: the default state, the 3-month chart, and the New invoice dialog with "Jane Cooper" typed one letter per frame, plus the click targets in `targets.json`. Re-run it after a landing build (`npm run build` in `landing/`): `node scripts/capture-demo.mjs` serves `landing/dist` itself and uses landing's Playwright.
- `assets/screens/editor.png`: the user's own editor screenshot from `landing/src/assets/screens/`.
- `scripts/make-audio.mjs`: synthesizes the music bed and UI sounds (clicks, pops, whooshes, chimes) from oscillators and seeded noise. There is no third-party audio.

## Timeline

| Time | Scene | Beat |
| --- | --- | --- |
| 0–6 s | `s1-intro` | The mascot outline draws in, the body fills with a squash, the eye opens, the sprouts grow, it blinks, then the "Lensprout" wordmark cascades in |
| 5.5–10 s | `s2-tagline` | "Screen recordings that zoom where you click." with a lens punch on "zoom" and a cursor click on "click" |
| 9.5–16 s | `s3-zoom` | Automatic zoom on the demo dashboard: a click on "3 months" triggers a spring zoom, the camera follows the cursor to "New invoice", then to the dialog as "Jane Cooper" is typed, then zooms out |
| 15.5–20.5 s | `s4-editor` | Editor screenshot plus an animated multi-track timeline (zoom, text, speed, cut, blur) with a playhead |
| 20–25 s | `s5-stage3d` | The dashboard recording as a floating 3D screen (no device frame) on an aurora background, running the tilt, orbit, dolly and swing camera moves |
| 24.5–29.5 s | `s6-webcam` | Webcam layouts morphing: picture in picture, side by side, stacked, camera full |
| 29–33.5 s | `s7-trim` | Smart trim scans the clip, flags idle, typing and silence, then collapses the cuts |
| 33–37 s | `s8-export` | MP4 and GIF export cards with progress bars, "Encoded on your device with WebCodecs" |
| 36.5–40.5 s | `s9-private` | "Nothing leaves your device": no account, no upload, no watermark |
| 40–45 s | `s10-outro` | Logo lockup, the mascot's success pose, "Free on the Chrome Web Store" |

Scenes overlap by 0.5 s: the outgoing scene pushes left while the next one pushes in from the right.

## Content rules

- Every claim matches a shipped feature in the root `README.md` ("Core features") and `docs/PRODUCT_SPEC.md`.
- No competitor names, no Apple wallpapers, and no stock faces. The webcam is played by the mascot, and the recorded page is the fictional Acme demo dashboard.
- The mascot geometry is copied from `extension/src/components/brand/mascot-shapes.ts`. Keep the two in sync if the mascot changes.
