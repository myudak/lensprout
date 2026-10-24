import {
  ZoomInAreaIcon,
  HardDriveIcon,
  ThreeDViewIcon,
  WebcamIcon,
  CursorMagicSelection01Icon,
  FastWindIcon,
  FileExportIcon,
  PaintBoardIcon,
  SmartPhone01Icon,
} from '@hugeicons/core-free-icons';

/*
 * Landing copy. Every claim maps to a shipped feature in docs/PRODUCT_SPEC.md (F05 auto zoom,
 * F11 local operation, F20 3D stage, F16/F17 mic and webcam, F18/F22/F25 cursor and sounds,
 * F24 smart trim, F09/F23 MP4 and GIF, F27 presets, F26 vertical fill). Do not add features here
 * that the extension does not have.
 */

export type Tile = 'apricot' | 'sage' | 'lilac' | 'coral';
export type Demo =
  | 'zoom'
  | 'local'
  | 'stage'
  | 'webcam'
  | 'cursor'
  | 'trim'
  | 'export'
  | 'presets'
  | 'vertical';

export const FEATURES: {
  icon: typeof ZoomInAreaIcon;
  title: string;
  body: string;
  tile: Tile;
  demo: Demo;
}[] = [
  {
    icon: ZoomInAreaIcon,
    title: 'Automatic zoom',
    body: 'Lensprout notes where you click and type, then plans smooth zooms that follow along. Every zoom stays editable on the timeline.',
    tile: 'coral',
    demo: 'zoom',
  },
  {
    icon: HardDriveIcon,
    title: 'A local editor',
    body: 'Trim, restyle and re-time your video in an editor that runs inside the extension. Recordings and edits stay on your device.',
    tile: 'sage',
    demo: 'local',
  },
  {
    icon: ThreeDViewIcon,
    title: '3D stage and device frames',
    body: 'Tilt, orbit, dolly or swing the shot, and drop it into a browser, laptop, tablet, phone or monitor frame.',
    tile: 'lilac',
    demo: 'stage',
  },
  {
    icon: WebcamIcon,
    title: 'Webcam and microphone',
    body: 'Add your voice and face. The webcam is recorded separately, so you can switch between picture in picture, side by side, stacked or full later.',
    tile: 'apricot',
    demo: 'webcam',
  },
  {
    icon: CursorMagicSelection01Icon,
    title: 'Cursor effects and sounds',
    body: 'Highlight the pointer, animate clicks and pick a cursor style. Optional click and keyboard sounds are generated for you, even on silent recordings.',
    tile: 'coral',
    demo: 'cursor',
  },
  {
    icon: FastWindIcon,
    title: 'Smart trim',
    body: 'Lensprout suggests speeding up idle stretches and typing, and cutting silent pauses. You choose which suggestions to keep.',
    tile: 'sage',
    demo: 'trim',
  },
  {
    icon: FileExportIcon,
    title: 'MP4 and GIF export',
    body: 'Export an MP4 with sound, or an animated GIF at 480, 720 or 960 px wide. Both use the same renderer as the preview.',
    tile: 'lilac',
    demo: 'export',
  },
  {
    icon: PaintBoardIcon,
    title: 'Presets',
    body: 'Save a look (background, frame, cursor, sounds) and apply it to any project, or make it the default for new recordings.',
    tile: 'apricot',
    demo: 'presets',
  },
  {
    icon: SmartPhone01Icon,
    title: 'Vertical 9:16 fill',
    body: 'Turn a wide recording into a vertical video. The frame fills the screen and pans to keep the cursor in view.',
    tile: 'coral',
    demo: 'vertical',
  },
];

export const STEPS: { title: string; body: string }[] = [
  {
    title: 'Record',
    body: 'Click the Lensprout button (or press Ctrl+Shift+Y) and pick a screen or window in Chrome’s picker. Add your microphone, webcam and a countdown if you like.',
  },
  {
    title: 'Auto zoom',
    body: 'When you stop, Lensprout turns your clicks and typing into zooms that follow the action.',
  },
  {
    title: 'Edit',
    body: 'Fine-tune zooms, trim, add speed-ups and cuts, change the background, frame and cursor, and preview the result instantly.',
  },
  {
    title: 'Export',
    body: 'Save an MP4 or GIF straight to your computer, ready to share wherever you like.',
  },
];

export const FAQ: { q: string; a: string }[] = [
  {
    q: 'Is it really free?',
    a: 'Yes. Every feature is free for everyone, for personal and commercial work. There is no account, no watermark, no trial and no upsell, and the code is open source under the MIT license.',
  },
  {
    q: 'Is my recording uploaded anywhere?',
    a: 'No. Recording, editing and export all happen inside the extension on your computer. Lensprout has no server to send your video to, and it does not need an account.',
  },
  {
    q: 'Where are my recordings stored?',
    a: 'In your browser’s local storage for the extension. Your original recording is kept as it was, and your edits are saved separately, so you can always go back. Removing the extension removes its stored recordings, so export the videos you want to keep.',
  },
  {
    q: 'Which browsers does it work in?',
    a: 'Lensprout is built for Google Chrome on desktop.',
  },
  {
    q: 'Can it zoom on apps outside the browser?',
    a: 'You can record a whole screen or a window through Chrome’s picker, but automatic zoom follows clicks and typing on web pages in Chrome. Lensprout cannot see the pointer inside other desktop apps, so add those zooms by hand in the editor.',
  },
  {
    q: 'What can I export?',
    a: 'An MP4 video with sound, or an animated GIF (480, 720 or 960 px wide, 10 to 20 frames per second, looping or not).',
  },
  {
    q: 'How do I install it?',
    a: 'Add Lensprout from the Chrome Web Store, then pin it to the toolbar. It works in Chrome 116 or newer.',
  },
];

/** The joke: three tiers, one price. Every tier gets every feature. */
export const PRICING_TIERS: {
  name: string;
  tagline: string;
  fakePrice: string;
  note: string;
  cta: string;
  featured?: boolean;
}[] = [
  {
    name: 'Free',
    tagline: 'Everything. For everyone.',
    fakePrice: '$0',
    note: 'Forever. We checked.',
    cta: 'Add to Chrome',
  },
  {
    name: 'Pro',
    tagline: 'Also free. Same everything. We just liked the word.',
    fakePrice: '$99',
    note: 'Billed never.',
    cta: 'Add to Chrome, but pro',
    featured: true,
  },
  {
    name: 'Enterprise',
    tagline: 'Still $0, and we skip the sales call.',
    fakePrice: '$9,999',
    note: 'Contact sales: there is no sales.',
    cta: 'Add to Chrome, enterprisingly',
  },
];

export const INCLUDED = [
  'Automatic zoom',
  'Local editor',
  '3D stage and device frames',
  'Webcam and microphone',
  'Cursor effects and sounds',
  'Smart trim',
  'MP4 and GIF export',
  'Presets',
  'Vertical 9:16 fill',
  'Commercial use',
  'No watermark, no account',
];
