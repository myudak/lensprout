# Working in this repository

Lensprout is a Chrome (Manifest V3) screen recorder with automatic zoom and a local editor. Everything runs on the user's device; there is no backend.

## Layout

- `extension/`: the extension (WXT, React 19, TypeScript, Tailwind v4, shadcn/ui on Base UI, Mediabunny). See [extension/README.md](extension/README.md).
- `landing/`: the marketing site and blog (Astro, static output). See [landing/README.md](landing/README.md).
- `docs/`: [PRODUCT_SPEC](docs/PRODUCT_SPEC.md) (scope and acceptance), [ARCHITECTURE](docs/ARCHITECTURE.md) (modules and contracts) and [DECISIONS](docs/DECISIONS.md) (why).
- `scripts/check-docs.py`: checks that local Markdown links resolve.

## Commands

From `extension/`: `npm ci`, `npm run build`, `npm run typecheck`, `npm test`, `npm run test:browser` (needs a build), `npm run format:check`, `npm run zip` (Chrome Web Store package).
From `landing/`: `npm ci`, `npm run dev`, `npm run build`.

## Contracts to preserve

- **Time:** raw and logical time stay distinct. Pauses are removed only through `src/domain/time-map.ts`, and cuts and speed through `src/domain/edit-map.ts`.
- **Deterministic rendering:**
  - The camera evaluator (`src/engine/camera.ts`) is shared by preview and export, and seeking never depends on the playback path.
  - `renderFrame` and `paintBackground` are shared by preview, MP4 and GIF export.
- **Edits are separate:** raw recordings and events are inputs; edits live in the project.
- **Real boundaries:** MV3 worker restarts, codec support, storage exhaustion, cancellation and media cleanup. Handle each one explicitly.
- **Pointer scope:** content scripts only see browser pages. Never claim desktop-wide pointer tracking.

## Conventions

- **Code:** strict TypeScript with no unused locals or parameters, and Prettier formatting. Match the style of the surrounding code.
- **UI components:** vendored into `src/components/ui/` (shadcn base-maia via `scripts/shadcn-add.mjs`, plus Magic UI). Record any local change in `registry.json`. Icons go through `src/components/app/icons.tsx` (Hugeicons).
- **Stable identifiers:**
  - The IndexedDB name stays `zoom-recorder`, so existing recordings survive.
  - The manifest `key` is only in unpacked builds; release zips omit it.
- **Assets:** release builds ship only original or properly licensed assets.
  - The optional wallpaper pack (`scripts/build-wallpapers.py` → `local-assets/`) holds Apple and Microsoft images. It stays local and never ships.
  - Never copy another product's code, branding, IDs or endpoints.
- **Scope:** cloud sharing, native apps and collaboration are out of scope unless a task asks for them.
