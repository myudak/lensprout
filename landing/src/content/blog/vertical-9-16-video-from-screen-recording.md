---
title: 'How to turn a screen recording into a vertical 9:16 video'
description: 'Make a vertical 9:16 video for Shorts, Reels or TikTok from a wide screen recording, with a frame that follows the cursor instead of tiny letterboxing.'
pubDate: 2026-10-18
kind: guide
tags: [how to, vertical video, 9:16]
related: [record-screen-chrome-automatic-zoom, make-gif-of-screen-in-chrome]
---

Screens are wide and phones are tall. If you drop a 16:9 screen recording into a 9:16 video, you get a thin strip in the middle and a lot of empty space, and nobody can read the text. The better approach is to **fill** the vertical frame and **move it** to wherever the action is. This guide explains how, and how Lensprout does it for you.

## Why letterboxing fails

A 1920×1080 recording squeezed into a 1080×1920 frame shrinks to 56% of its size and fills less than a third of the frame. Small UI text becomes unreadable on a phone. Viewers scroll past.

Filling the frame means cropping: you show a tall slice of the screen at full size. The problem is choosing *which* slice, moment by moment. Doing that by hand means keyframing a crop for every click.

## The idea: let the cursor steer

During a demo, the interesting part is almost always near the pointer. So a vertical crop that follows the pointer shows what matters most of the time. Add automatic zooms on clicks and typing, and the result reads well on a phone.

## Doing it in Lensprout

1. **Record as usual.** Use the normal screen or window recording; you don't need to record vertically. See [how to record with automatic zoom](/blog/record-screen-chrome-automatic-zoom/).
2. **Choose a vertical aspect.** In the editor's Style panel, set the aspect to **9:16**.
3. **Choose "Fill and follow".** Instead of fitting the whole recording inside the frame, Lensprout fills it and pans the view to keep the cursor in sight, even between zooms.
4. **Check the zooms.** Automatic zooms still apply. Their depth and the cursor offset control how tight each moment feels.
5. **Export.** Export an MP4 (or a GIF) as usual. The output is a true vertical video.

In fill mode there is no padding or device frame, since the recording covers the whole frame.

## Tips for vertical screen videos

- **Record a narrower window.** A browser window about 1200 px wide gives the vertical crop less to chase.
- **Increase the page zoom.** Bigger text survives the crop.
- **Keep actions in one area.** Jumping from the far left to the far right makes the frame pan a lot.
- **Use the webcam sparingly.** In a tall frame, a stacked layout (camera above or below the screen) can work better than a bubble covering the UI.
- **Watch it on a phone** before you post.

## Where vertical videos work well

- product updates on Shorts, Reels and TikTok;
- quick how-to clips in a help center;
- social posts that show one feature in under 30 seconds.

For a looping preview instead of a video, see [how to make a GIF of your screen](/blog/make-gif-of-screen-in-chrome/).
