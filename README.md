# Scene Studio

Write a story shot by shot, turn each shot into a video clip with **open-source video models** (Wan 2.2, LTX-2.3, HunyuanVideo 1.5) hosted on [fal.ai](https://fal.ai), and stitch the clips into one movie, all inside your browser. No server, no build step: it is a static site that runs on GitHub Pages.

- **Shots**: a prompt, an optional start image (a character sheet, a reference frame), a length (5–10 s) and a model per shot.
- **Generate**: one shot or all pending shots at once, with live progress. Jobs survive a page reload.
- **Gallery**: every take is saved on your device (IndexedDB), so you can rewatch, download or share it even after fal's links expire.
- **Stitch**: joins the latest take of every shot, in order, with [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm), in the browser. If a phone can't run it, **Play all in order** plays the shots back to back.
- **Private**: a password gate (only a SHA-256 hash of the password is in the code) and `noindex`. Your fal.ai key is stored only in your browser's localStorage and sent only to fal.ai.

## Models

Open source (default):

| Model | fal endpoints (image→video / text→video) | Length | fal price |
|---|---|---|---|
| Wan 2.2 A14B | `fal-ai/wan/v2.2-a14b/image-to-video` / `.../text-to-video` | 5–10 s | $0.04/s 480p, $0.06/s 580p, $0.08/s 720p |
| Wan 2.2 Turbo | `fal-ai/wan/v2.2-a14b/image-to-video/turbo` / `.../text-to-video/turbo` | 5 s | $0.05–$0.10 per clip |
| LTX-2.3 Fast (sound) | `fal-ai/ltx-2.3/image-to-video/fast` / `fal-ai/ltx-2.3/text-to-video/fast` | 6, 8, 10 s | $0.06/s at 1080p |
| HunyuanVideo 1.5 | `fal-ai/hunyuan-video-v1.5/image-to-video` / `.../text-to-video` | 5 s | $0.075/s |

Closed (optional extras): Kling 2.5 Turbo Pro (`fal-ai/kling-video/v2.5-turbo/pro/...`, $0.35 per 5 s) and Kling 3.0 Pro (`fal-ai/kling-video/v3/pro/...`, $0.112/s).

Prices are fal's own published notes (October 2026); fal bills the real amount. The app shows an estimate per shot and for the whole story.

## Setup (5 minutes)

1. **Get a fal.ai key**: sign up at [fal.ai](https://fal.ai), add credit at [fal.ai/dashboard/billing](https://fal.ai/dashboard/billing), then create a key at [fal.ai/dashboard/keys](https://fal.ai/dashboard/keys).
2. **Open the app**, unlock it, go to **Settings**, paste the key and tap **Save key**.
3. **Write shots** on the Story tab and tap **Generate all**. When the shots are done, tap **Stitch movie**.

### Run your own copy

1. Fork this repo (or use it as a template).
2. Set your own password: put the SHA-256 hex of it in `PW_HASH` at the top of `app.js`
   (`printf '%s' 'your password' | sha256sum`). Never commit the password itself.
3. Repo **Settings → Pages → Deploy from a branch → main / (root)**. Your app is at `https://<you>.github.io/scene-studio/`.

Local preview: `python3 -m http.server 8080` in the repo folder, then open `http://localhost:8080`.

Tests: `node --test` (Node 20+, no dependencies).

## Adding another provider

Everything fal-specific lives in **`providers/fal.js`**: the model list, how a shot becomes a request body, submit / poll / result on fal's queue API, and the start-image upload. To add another host (Replicate, for example), copy that file to `providers/replicate.js`, keep the same exports (`models`, `buildInput`, `submit`, `poll`, `result`, `uploadImage`, `cancel`, `estimateCost`, `fitDuration`, `getModel`, `defaultModel`) and register it in `providers/index.js`.

## Notes

- **Keys**: the key lives only in your browser. Anyone using the app pastes their own. Never commit keys; `.gitignore` blocks `.env`, `*.key`, `*.pem` and `secrets*`.
- **Storage**: clips are kept in the browser's site storage. Clearing Safari/Chrome website data deletes them, so download the ones you want to keep.
- **iPhone**: generation and the gallery work on iPhone. Stitching runs ffmpeg in the page; long movies may be too much for a phone's memory. Use **Play all in order**, or stitch on a computer.
- **Content**: each model's own content rules apply. This app adds no filter bypasses and does not rewrite prompts.
- ffmpeg.wasm's small loader (`vendor/ffmpeg`, MIT) is bundled; its core (`@ffmpeg/core`, GPL because it includes x264) is downloaded from jsDelivr when you first stitch.

## License

[MIT](LICENSE)
