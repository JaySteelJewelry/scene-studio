// Finishing: joins shots with ffmpeg.wasm in this browser (single-thread build, no special headers).
// Hard cuts or crossfades, optional title/end cards (drawn on a canvas, passed in as PNGs),
// optional music mixed under, 720p or 1080p. If anything fancy fails it falls back to hard cuts,
// and if the browser can't run ffmpeg at all the app offers "Play all in order".
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
    onStatus('Loading the finisher…');
    await loadScript(new URL('./vendor/ffmpeg/ffmpeg.js', import.meta.url).href);
    const inst = new window.FFmpegWASM.FFmpeg();
    const coreURL = await toBlobURL(CORE + '/ffmpeg-core.js', 'text/javascript');
    const wasmURL = await toBlobURL(CORE + '/ffmpeg-core.wasm', 'application/wasm', p => onStatus('Loading the finisher… ' + Math.round(p * 100) + '%'));
    await inst.load({ coreURL, wasmURL });
    ff = inst;
    return ff;
  })();
  try { return await loading; } finally { loading = null; }
}

// ---------- pure argument builders (unit-tested against native ffmpeg) ----------
export function outputSize(aspect, res = '720') {
  const r = String(res).replace('p', '');
  const short = r === '1080' ? 1080 : r === '480' ? 480 : 720;
  const long = r === '1080' ? 1920 : r === '480' ? 854 : 1280;
  if (aspect === '9:16') return [short, long];
  if (aspect === '1:1') return [short, short];
  return [long, short];
}
const VF = (w, h) => `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=24,format=yuv420p`;
const ENC = ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '21', '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-b:a', '128k', '-movflags', '+faststart'];
const SILENCE = ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100'];

export function normaliseArgs(input, output, w, h, hasAudio) {
  const a = hasAudio
    ? ['-i', input, '-map', '0:v:0', '-map', '0:a:0']
    : ['-i', input, ...SILENCE, '-map', '0:v:0', '-map', '1:a:0', '-shortest'];
  return [...a, '-vf', VF(w, h), ...ENC, output];
}
// A still PNG (title or end card) becomes a clip with a soft fade in/out and silent audio.
export function cardArgs(png, output, w, h, seconds = 3) {
  const fo = Math.max(0, seconds - 0.6).toFixed(2);
  return ['-loop', '1', '-t', String(seconds), '-i', png, ...SILENCE, '-map', '0:v:0', '-map', '1:a:0', '-t', String(seconds),
    '-vf', `${VF(w, h)},fade=t=in:st=0:d=0.6,fade=t=out:st=${fo}:d=0.6`, ...ENC, output];
}
export function concatList(names) { return names.map(n => `file '${n}'`).join('\n') + '\n'; }
export function concatArgs(list, out) { return ['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out]; }

// One pass, all pieces: chained xfade (video) + acrossfade (audio).
export function xfadeOffsets(durations, fade) {
  const out = []; let acc = 0;
  for (let i = 0; i < durations.length - 1; i++) { acc += durations[i] - fade; out.push(Math.round(acc * 1000) / 1000); }
  return out;
}
export function xfadeArgs(names, durations, fade, out) {
  if (names.length < 2) throw new Error('Need two pieces to crossfade');
  const ins = names.flatMap(n => ['-i', n]);
  const f = [];
  names.forEach((_, i) => {
    f.push(`[${i}:v]fps=24,settb=AVTB,setpts=PTS-STARTPTS,format=yuv420p[v${i}]`);
    f.push(`[${i}:a]aresample=44100,asetpts=PTS-STARTPTS[a${i}]`);
  });
  const offs = xfadeOffsets(durations, fade);
  let pv = 'v0', pa = 'a0';
  for (let i = 1; i < names.length; i++) {
    const last = i === names.length - 1;
    const nv = last ? 'vout' : `x${i}`, na = last ? 'aout' : `y${i}`;
    f.push(`[${pv}][v${i}]xfade=transition=fade:duration=${fade}:offset=${offs[i - 1]}[${nv}]`);
    f.push(`[${pa}][a${i}]acrossfade=d=${fade}:c1=tri:c2=tri[${na}]`);
    pv = nv; pa = na;
  }
  return [...ins, '-filter_complex', f.join(';'), '-map', '[vout]', '-map', '[aout]', ...ENC, out];
}
// Music under the film: loops if short, fades out at the end, clip sound stays on top.
export function musicArgs(video, music, out, total, volume = 0.35) {
  const v = Math.max(0, Math.min(1, Number(volume) || 0.35)).toFixed(2);
  const st = Math.max(0, total - 2).toFixed(2);
  return ['-i', video, '-stream_loop', '-1', '-i', music,
    '-filter_complex', `[1:a]aresample=44100,volume=${v},afade=t=in:st=0:d=1,afade=t=out:st=${st}:d=2[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]`,
    '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-t', total.toFixed(2), '-movflags', '+faststart', out];
}
export function parseDuration(lines) {
  for (const l of lines) { const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(l); if (m) return (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]); }
  return null;
}

// ---------- the job ----------
// pieces: [{ blob, kind: 'clip'|'card', seconds? }] in order.
// opts: { aspect, res: '720'|'1080', crossfade, fadeSeconds, music: Blob|null, musicVolume, fast, onStatus }
// Returns { blob, crossfaded, notes[] }.
export async function stitch(pieces, opts = {}) {
  const { aspect = '16:9', res = '720', crossfade = false, fadeSeconds = 0.75, music = null, musicVolume = 0.35, fast = false, onStatus = () => {} } = opts;
  const f = await loadFFmpeg(onStatus);
  const notes = [];
  const logs = [];
  const onLog = ({ message }) => { logs.push(message); if (logs.length > 80) logs.shift(); };
  let stage = '', base = 0, span = 1;
  const onProg = ({ progress }) => { if (progress >= 0 && progress <= 1) onStatus(`${stage} ${Math.round((base + progress * span) * 100)}%`); };
  f.on('log', onLog); f.on('progress', onProg);
  const made = [];
  const write = async (n, blob) => { await f.writeFile(n, new Uint8Array(await blob.arrayBuffer())); made.push(n); };
  const run = async (args, what) => { const rc = await f.exec(args); if (rc !== 0) throw new Error(what + ' failed. ' + logs.slice(-3).join(' ')); };
  try {
    const n = pieces.length;
    // Fast path: same-format clips, no finishing → stream copy, seconds even on a phone.
    if (fast && !crossfade && !music && pieces.every(p => p.kind === 'clip')) {
      const names = [];
      for (let i = 0; i < n; i++) { const nm = `in${i}.mp4`; await write(nm, pieces[i].blob); names.push(nm); }
      stage = 'Joining';
      await f.writeFile('list.txt', concatList(names)); made.push('list.txt');
      const rc = await f.exec(concatArgs('list.txt', 'out.mp4'));
      if (rc === 0) { made.push('out.mp4'); return { blob: await read(f, 'out.mp4'), crossfaded: false, notes }; }
      notes.push('Quick join did not work, re-encoding.');
    }
    const [w, h] = outputSize(aspect, res);
    const norm = [], durs = [];
    span = 0.6 / n;
    for (let i = 0; i < n; i++) {
      const p = pieces[i]; base = 0.6 * i / n;
      const out = `n${i}.mp4`;
      if (p.kind === 'card') {
        stage = i === 0 ? 'Title card' : 'End card';
        const png = `card${i}.png`; await write(png, p.blob);
        await run(cardArgs(png, out, w, h, p.seconds || 3), stage);
      } else {
        stage = `Shot ${i + 1 - (pieces[0].kind === 'card' ? 1 : 0)} of ${pieces.filter(x => x.kind === 'clip').length}`;
        const nm = `in${i}.mp4`; await write(nm, p.blob);
        const info = await probe(f, nm);
        await run(normaliseArgs(nm, out, w, h, info.audio), stage);
        try { await f.deleteFile(nm); made.splice(made.indexOf(nm), 1); } catch (e) {}
      }
      made.push(out); norm.push(out);
      const d = (await probe(f, out)).duration;
      durs.push(d || p.seconds || 5);
    }
    let joined = null, crossfaded = false;
    const total = durs.reduce((a, b) => a + b, 0);
    let finalLen = total;
    if (crossfade && norm.length > 1) {
      const fade = Math.max(0.2, Math.min(fadeSeconds, Math.floor(Math.min(...durs) / 3 * 100) / 100));
      stage = 'Crossfading'; base = 0.6; span = 0.3;
      const rc = await f.exec(xfadeArgs(norm, durs, fade, 'xf.mp4'));
      if (rc === 0) { joined = 'xf.mp4'; made.push('xf.mp4'); crossfaded = true; }
      else { notes.push('Crossfade ran out of room in this browser, so the shots join with hard cuts.'); try { await f.deleteFile('xf.mp4'); } catch (e) {} }
      if (crossfaded) finalLen = total - fade * (norm.length - 1);
    }
    if (!joined) {
      stage = 'Joining'; base = 0.6; span = 0.3;
      await f.writeFile('list.txt', concatList(norm)); made.push('list.txt');
      await run(concatArgs('list.txt', 'cut.mp4'), 'Join');
      joined = 'cut.mp4'; made.push('cut.mp4');
    }
    const len = finalLen;
    if (music) {
      stage = 'Mixing music'; base = 0.9; span = 0.1;
      await write('music.bin', music);
      const rc = await f.exec(musicArgs(joined, 'music.bin', 'mix.mp4', len, musicVolume));
      if (rc === 0) { made.push('mix.mp4'); joined = 'mix.mp4'; }
      else notes.push('The music file could not be read here, so the movie has no music track.');
    }
    const blob = await read(f, joined);
    return { blob, crossfaded, notes, seconds: Math.round(len * 10) / 10 };
  } finally {
    f.off('log', onLog); f.off('progress', onProg);
    for (const m of made) { try { await f.deleteFile(m); } catch (e) {} }
  }
}
async function probe(f, name) {
  const lines = [];
  const h = ({ message }) => lines.push(message);
  f.on('log', h);
  try { await f.exec(['-hide_banner', '-i', name]); } finally { f.off('log', h); }
  return { audio: lines.some(l => /Stream #\d+:\d+.*Audio:/.test(l)), duration: parseDuration(lines) };
}
async function read(f, name) {
  const data = await f.readFile(name);
  return new Blob([data.buffer], { type: 'video/mp4' });
}
