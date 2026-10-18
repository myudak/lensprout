---
title: 'How to make a GIF of your screen in Chrome'
description: 'Record your screen in Chrome and export a crisp, small animated GIF for docs, READMEs, pull requests and chat, with zooms that show what changed.'
pubDate: 2026-10-18
kind: guide
tags: [how to, gif, chrome]
related: [record-screen-chrome-automatic-zoom, vertical-9-16-video-from-screen-recording]
---

GIFs are still the easiest way to show a UI change where video doesn't play well: a README, a pull request, a help article or a chat thread. They autoplay, loop and need no player. They are also easy to get wrong: too big, too blurry, too long. Here is how to make a good one from a screen recording in Chrome.

## What makes a good screen GIF

- **Short:** 3 to 10 seconds. A GIF has no seek bar.
- **Focused:** show one change. Zoom in so the important part fills the frame.
- **Small:** the GIF format stores every frame with a limited palette, so size grows quickly with width, length and frame rate.

## Step by step with Lensprout

1. **Record the moment.** Start a recording, do the one thing you want to show, and stop. Automatic zoom moves in on your clicks and typing. See [the recording guide](/blog/record-screen-chrome-automatic-zoom/) for details.
2. **Trim tightly.** In the editor, trim the start and end. Use **Smart trim** to cut pauses and speed up idle stretches.
3. **Pick a simple style.** Solid or gentle gradient backgrounds compress better than photos.
4. **Export as GIF.** In the export dialog, choose **GIF**, then:
   - **Width:** 480, 720 or 960 px. 720 px is a good default for docs; 480 px for chat.
   - **Frame rate:** 10, 15 or 20 frames per second. 15 is smooth enough for UI.
   - **Loop:** on for most uses.
5. **Download.** The GIF renders on your computer with the same renderer as the preview, so zooms, the 3D stage and the webcam look the same as in the editor.

## Keeping the file small

| Change | Effect on size |
| --- | --- |
| 960 px to 720 px wide | Roughly halves the pixels per frame |
| 20 fps to 15 fps | A quarter fewer frames |
| 12 s to 6 s | Half the frames |
| Photo background to flat color | Fewer colors to dither |

If the GIF is still large, consider an MP4 instead. Most docs tools and chat apps play short MP4s inline, and they are far smaller for the same length.

## GIF or MP4?

- **GIF:** README files, places that strip video, quick loops without sound.
- **MP4:** anything longer than about 15 seconds, anything with narration, and social posts.

Lensprout exports both from the same project, so you can make one of each. For phone-friendly videos, see [how to make a vertical 9:16 video](/blog/vertical-9-16-video-from-screen-recording/).
