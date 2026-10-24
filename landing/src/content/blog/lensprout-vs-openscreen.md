---
title: 'Lensprout vs OpenScreen: two free, open source recorders'
description: 'Lensprout and OpenScreen are both MIT-licensed auto-zoom recorders. One is a Chrome extension, the other an archived desktop app. Here is how they compare.'
pubDate: 2026-10-18
kind: comparison
tags: [openscreen, open source, auto zoom]
checkedOn: 2026-10-18
related: [best-auto-zoom-screen-recorders-2026, private-local-screen-recording]
sources:
  - label: 'OpenScreen README on GitHub (siddharthvaddem/openscreen)'
    url: 'https://github.com/siddharthvaddem/openscreen'
---

If you want an auto-zoom screen recorder without paying or uploading anything, two open source projects come up: OpenScreen, a desktop app, and Lensprout, a Chrome extension. Both use the MIT license, both keep your recordings local, and both export MP4 and GIF. They differ in where they run and, importantly, in whether they are still maintained.

The OpenScreen details below come from its GitHub README as it was on 18 October 2026.

## The important news first

OpenScreen's README says the project is **archived and no longer maintained**, and the repository is read-only. It also warns that it is not production grade and that you will hit bugs. You can still download it and, thanks to the MIT license, fork it, but don't expect fixes or updates from the original authors.

## Side by side

| Feature | Lensprout | OpenScreen |
| --- | --- | --- |
| Type | Chrome extension | Desktop app (Electron) |
| Platforms | Desktop Chrome | macOS, Windows and Linux |
| License | MIT | MIT |
| Status | Available on the Chrome Web Store | Archived, no longer maintained |
| Automatic zoom | From clicks and typing on web pages | Auto or manual zooms that follow the cursor |
| Audio | Microphone mixed with system audio | Microphone and system audio (varies by OS) |
| Webcam | Five layouts, per segment | Picture in picture with shapes and mirroring |
| Export | MP4 and GIF | MP4 and GIF |

## Desktop app versus browser extension

OpenScreen records your desktop through a native pipeline on macOS and Windows, so its zooms can follow the pointer in any app. On Linux it records through a browser pipeline and captures only the cursor position, so cursor themes and click effects are not available there.

Lensprout lives inside Chrome. It records your screen or a window through Chrome's picker, and its automatic zoom follows clicks and typing on Chrome web pages. There is nothing to install beyond the extension, and it works the same on any desktop OS that runs Chrome. The trade-off: activity outside Chrome isn't tracked, so zooms there are placed by hand.

## Editing

Both editors let you adjust zoom depth and timing. Lensprout's timeline also holds speed-ups, cuts, text, blur and camera segments, and it adds:

- smart trim suggestions for idle stretches, typing and silences;
- a 3D stage with tilt, orbit, dolly and swing moves and device frames;
- generated click and keyboard sounds;
- style presets;
- vertical 9:16 fill that follows the cursor.

OpenScreen's README lists annotations, background customization, adjustable zoom easing and pixel-precise zoom positions.

## Which one should you use?

- **You need to record native apps on Windows, macOS or Linux, and you are comfortable with unmaintained software:** OpenScreen is worth a try, or a fork of it.
- **You record web apps and want a project that is still moving:** Lensprout fits better.

Either way, your recordings stay on your computer. Read more about why that matters in our [guide to private screen recording](/blog/private-local-screen-recording/).
