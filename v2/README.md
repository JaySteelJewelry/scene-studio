# Scene Studio v2 (premium preview)

The premium version of Scene Studio, served at `/v2/`. Same password gate, same fal.ai key, same storage as the classic app at the repo root, so everything made there opens here.

## What is new
- Cinematic dark UI built for iPhone first (bottom tab bar, bottom sheets) and desktop (side rail, side panel). Lock screen with logo and wordmark.
- **Storyboard**: shots as cards with thumbnails, drag the grip to reorder, duplicate / delete / move from each card's menu, and a timeline strip with the total runtime (title card, end card and crossfades included).
- **Cast**: save characters once (name, reference picture, look). Add them to a shot: their look goes into the prompt and their picture can be the first frame.
- **Project style**: one look, lighting and lens for the whole film plus aspect ratio (16:9, 9:16, 1:1), added to every shot's prompt the same way. Per-shot camera moves: static, dolly in/out, pan left/right, orbit, handheld, tracking, crane up, slow zoom.
- **Projects**: many projects with covers, rename, duplicate, delete, export / import as a `.scene.json` file (prompts, style, cast and pictures; video clips stay on the device).
- **Prompt helper**: shot templates and an Enhance button that rewrites a plain idea into a cinematic shot description. Pure client-side templates; it only adds film language.
- **Finishing**: optional title card and end card, crossfades between shots (ffmpeg.wasm `xfade`; falls back to hard cuts if the browser runs out of memory), optional music mixed under the clips, export at 720p or 1080p. "Play all" stays as the fallback when a browser cannot render at all.
- **Cost**: live estimate per shot and per project from fal's listed prices, plus a "spent this session" counter (estimates; fal bills the exact amount).

## Storage
Projects, start images, clips and movies are read from and written to the same IndexedDB database the classic app uses (`scene-studio`, version 1, unchanged), so the classic app keeps working on the same data. Cast and music live in a second database, `scene-studio-v2`. Nothing leaves the browser except calls to fal.ai with your own key.

## Files
- `index.html`, `styles.css`, `app.js`: the app
- `lib/core.js`: style, camera, cast, prompt helper, runtime, cost, project export/import (pure functions, unit-tested)
- `stitch.js`: finishing with ffmpeg.wasm (argument builders are tested against native ffmpeg)
- `providers/fal.js`: the fal.ai adapter (same one as the classic app)
- `test/`: run `node --test` from the repo root

## Promote to the main URL
Copy the contents of `v2/` over the repo root (keep `LICENSE`, `.gitignore`, the root `README.md`), then fix the two links that point to the classic app (`../` in Settings) and the test that compares against the root files.
