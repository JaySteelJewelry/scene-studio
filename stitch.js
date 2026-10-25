// Stitching: joins clips in order with ffmpeg.wasm (runs in this browser, single-thread build,
// no special server headers needed). If the browser can't run it (some iPhones run out of memory),
// the app falls back to "Play all in order".
const CORE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd';
let ff = null;
let loading = null;

function loadScript(src) {
  return new Promise((res, rej) => {
    if (window.FFmpegWASM) return res();
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });
}

async function toBlobURL(url, type, onProgress) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('Download failed ' + r.status + ' ' + url);
  const total = Number(r.headers.get('content-length')) || 0;
  if (!r.body || !onProgress) return URL.createObjectURL(new Blob([await r.arrayBuffer()], { type }));
  const reader = r.body.getReader(); const chunks = []; let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; if (total) onProgress(got / total); }
  return URL.createObjectURL(new Blob(chunks, { type }));
}

export async function loadFFmpeg(onStatus = () => {}) {
  if (ff) return ff;
  if (loading) return loading;
  loading = (async () => {
    onStatus('Loading video joiner…');
    await loadScript(new URL('./vendor/ffmpeg/ffmpeg.js', import.meta.url).href);
    const inst = new window.FFmpegWASM.FFmpeg();
    const coreURL = await toBlobURL(CORE + '/ffmpeg-core.js', 'text/javascript');
    const wasmURL = await toBlobURL(CORE + '/ffmpeg-core.wasm', 'application/wasm', p => onStatus('Loading video joiner… ' + Math.round(p * 100) + '%'));
    await inst.load({ coreURL, wasmURL });
    ff = inst;
    return ff;
  })();
  try { return await loading; } finally { loading = null; }
}

// Pick output size for the story's aspect ratio.
export function outputSize(aspect, quality = 'hd') {
  const long = quality === 'hd' ? 1280 : 854;
  const short = quality === 'hd' ? 720 : 480;
  if (aspect === '9:16') return [short, long];
  if (aspect === '1:1') return [short, short];
  return [long, short];
}

// Build the ffmpeg args that normalise one clip (size, fps, pixel format, a stereo audio track
// even if the clip is silent) so clips from different models join cleanly.
export function normaliseArgs(input, output, w, h, hasAudio) {
  const vf = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=24,format=yuv420p`;
  const a = hasAudio
    ? ['-i', input, '-map', '0:v:0', '-map', '0:a:0']
    : ['-i', input, '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100', '-map', '0:v:0', '-map', '1:a:0', '-shortest'];
  return [...a, '-vf', vf, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-b:a', '128k', '-movflags', '+faststart', output];
}

export function concatList(names) {
  return names.map(n => `file '${n}'`).join('\n') + '\n';
}

// clips: [{ blob }] in order. Returns a Blob (video/mp4).
// mode 'fast' = stream copy (only when all clips came from the same model/size), else re-encode.
export async function stitch(clips, { aspect = '16:9', mode = 'auto', onStatus = () => {} } = {}) {
  const f = await loadFFmpeg(onStatus);
  const names = [];
  let pct = 0;
  const onProg = ({ progress }) => { if (progress >= 0 && progress <= 1) onStatus(`Joining… ${Math.round(((pct + progress) / clips.length) * 100)}%`); };
  f.on('progress', onProg);
  const logs = [];
  const onLog = ({ message }) => { logs.push(message); if (logs.length > 60) logs.shift(); };
  f.on('log', onLog);
  try {
    for (let i = 0; i < clips.length; i++) {
      const n = `in${i}.mp4`;
      await f.writeFile(n, new Uint8Array(await clips[i].blob.arrayBuffer()));
      names.push(n);
    }
    if (mode === 'fast') {
      onStatus('Joining (fast)…');
      await f.writeFile('list.txt', concatList(names));
      const rc = await f.exec(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', '-movflags', '+faststart', 'out.mp4']);
      if (rc === 0) return await readOut(f, 'out.mp4');
      onStatus('Fast join failed, re-encoding…');
    }
    const [w, h] = outputSize(aspect);
    const norm = [];
    for (let i = 0; i < names.length; i++) {
      pct = i;
      onStatus(`Preparing shot ${i + 1} of ${names.length}…`);
      const hasAudio = await probeAudio(f, names[i]);
      const out = `n${i}.mp4`;
      const rc = await f.exec(normaliseArgs(names[i], out, w, h, hasAudio));
      if (rc !== 0) throw new Error(`Shot ${i + 1} could not be processed. ` + logs.slice(-3).join(' '));
      await f.deleteFile(names[i]);
      norm.push(out);
    }
    onStatus('Joining…');
    await f.writeFile('list.txt', concatList(norm));
    const rc = await f.exec(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', '-movflags', '+faststart', 'out.mp4']);
    if (rc !== 0) throw new Error('Join failed. ' + logs.slice(-3).join(' '));
    const blob = await readOut(f, 'out.mp4');
    for (const n of norm) { try { await f.deleteFile(n); } catch (e) {} }
    return blob;
  } finally {
    f.off('progress', onProg);
    f.off('log', onLog);
    for (const n of names) { try { await f.deleteFile(n); } catch (e) {} }
    try { await f.deleteFile('list.txt'); } catch (e) {}
  }
}

async function probeAudio(f, name) {
  const lines = [];
  const h = ({ message }) => lines.push(message);
  f.on('log', h);
  try { await f.exec(['-hide_banner', '-i', name]); } finally { f.off('log', h); }
  return lines.some(l => /Stream #\d+:\d+.*Audio:/.test(l));
}

async function readOut(f, name) {
  const data = await f.readFile(name);
  try { await f.deleteFile(name); } catch (e) {}
  return new Blob([data.buffer], { type: 'video/mp4' });
}
