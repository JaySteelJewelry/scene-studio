import { db, storageEstimate } from './db.js';
import { getProvider, defaultProvider } from './providers/index.js';
import { stitch } from './stitch.js';

// ---------- password gate (only the SHA-256 hash lives in this code) ----------
const PW_HASH = '162c8e48e83400fb9cac9947ab71ea63e5e27490040529ddae7283fda6991d64';
const LS = { unlock: 'ss.unlock.v1', settings: 'ss.settings.v1', current: 'ss.story.v1' };
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

async function sha256(t) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
$('#gateForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (await sha256($('#pw').value.trim()) === PW_HASH) { localStorage.setItem(LS.unlock, PW_HASH); start(); }
  else { $('#gateErr').textContent = 'Wrong password'; $('#pw').select(); }
});
$('#lockBtn').addEventListener('click', () => { localStorage.removeItem(LS.unlock); location.reload(); });

// ---------- settings ----------
const DEFAULTS = { provider: defaultProvider, keys: {}, quality: 'standard', audio: false, concurrency: 3 };
let S = { ...DEFAULTS };
try { const x = JSON.parse(localStorage.getItem(LS.settings) || '{}'); S = { ...DEFAULTS, ...x, keys: { ...(x.keys || {}) } }; } catch (e) {}
const saveSettings = () => localStorage.setItem(LS.settings, JSON.stringify(S));
const P = () => getProvider(S.provider);
const key = () => (S.keys[S.provider] || '').trim();

function resFor(model) {
  const r = model.resolutions;
  if (S.quality === 'draft') return r[0];
  if (S.quality === 'max') return r[r.length - 1];
  return r.includes('720p') ? '720p' : model.defaultRes;
}

// ---------- state ----------
let story = null;          // current story object
let stories = [];          // [{id,title,...}]
let images = new Map();    // id -> {id, blob, name, falUrl, falUrlAt}
const urls = new Map();    // blob object URLs, keyed by record id
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const objUrl = (id, blob) => { if (!urls.has(id)) urls.set(id, URL.createObjectURL(blob)); return urls.get(id); };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function newStory(n) {
  return { id: uid(), title: 'Story ' + n, aspect: '16:9', model: P().defaultModel, shots: [], createdAt: Date.now(), updatedAt: Date.now() };
}
let saveT = null;
function saveStory(now) {
  story.updatedAt = Date.now();
  clearTimeout(saveT);
  const go = () => db.put('stories', JSON.parse(JSON.stringify(story))).catch(err => console.warn(err));
  if (now) return go();
  saveT = setTimeout(go, 300);
}

// ---------- navigation ----------
function show(view) {
  $$('.tab').forEach(t => { const on = t.dataset.view === view; t.classList.toggle('active', on); on ? t.setAttribute('aria-current', 'page') : t.removeAttribute('aria-current'); });
  $$('.view').forEach(v => { v.hidden = v.id !== 'view-' + view; });
  if (view === 'gallery') renderGallery();
  if (view === 'settings') renderSettings();
  window.scrollTo(0, 0);
}
$$('.tab').forEach(t => t.addEventListener('click', () => show(t.dataset.view)));
document.addEventListener('click', e => { const g = e.target.closest('[data-goto]'); if (g) show(g.dataset.goto); });
function keyBanner() { $('#keyBanner').hidden = !!key(); }

// ---------- segmented controls ----------
function seg(el, value, onPick) {
  $$('button', el).forEach(b => {
    b.setAttribute('aria-checked', String(b.dataset.v === value));
    b.onclick = () => { $$('button', el).forEach(x => x.setAttribute('aria-checked', String(x === b))); onPick(b.dataset.v); };
  });
}

// ---------- model selects ----------
function fillModelSelect(sel, value) {
  const ms = P().models;
  const og = (label, list) => `<optgroup label="${label}">` + list.map(m => `<option value="${m.key}">${esc(m.name)}</option>`).join('') + '</optgroup>';
  sel.innerHTML = og('Open source', ms.filter(m => m.open)) + og('Closed (optional)', ms.filter(m => !m.open));
  sel.value = P().getModel(value).key;
}

// ---------- story bar ----------
async function loadStories() {
  stories = (await db.all('stories')).sort((a, b) => a.createdAt - b.createdAt);
  if (!stories.length) { const s = newStory(1); s.shots.push({ ...newShotFor(s) }); await db.put('stories', s); stories = [s]; }
  const cur = localStorage.getItem(LS.current);
  story = stories.find(s => s.id === cur) || stories[stories.length - 1];
}
function newShotFor(s) { return { id: uid(), prompt: '', imageId: null, duration: 5, model: s.model, status: 'idle', job: null, clipId: null, error: '' }; }

function renderStoryBar() {
  const sel = $('#storySelect');
  sel.innerHTML = stories.map(s => `<option value="${s.id}">${esc(s.title || 'Untitled')}</option>`).join('');
  sel.value = story.id;
  $('#storyTitle').value = story.title;
  seg($('#aspectSeg'), story.aspect, v => { story.aspect = v; saveStory(); renderShots(); });
  fillModelSelect($('#storyModel'), story.model);
  renderSummary();
}
$('#storySelect').addEventListener('change', async e => {
  await saveStory(true);
  story = stories.find(s => s.id === e.target.value);
  localStorage.setItem(LS.current, story.id);
  renderStoryBar(); renderShots(); renderFinalOut();
});
$('#storyTitle').addEventListener('input', e => {
  story.title = e.target.value; saveStory();
  const o = $(`#storySelect option[value="${story.id}"]`); if (o) o.textContent = story.title || 'Untitled';
});
$('#storyModel').addEventListener('change', e => { story.model = e.target.value; saveStory(); });
$('#newStory').addEventListener('click', async () => {
  await saveStory(true);
  const s = newStory(stories.length + 1); s.shots.push(newShotFor(s));
  stories.push(s); story = s; localStorage.setItem(LS.current, s.id); await saveStory(true);
  renderStoryBar(); renderShots(); renderFinalOut();
  $('#storyTitle').focus(); $('#storyTitle').select();
});

function renderSummary() {
  const ms = story.shots.map(sh => P().getModel(sh.model));
  let secs = 0, cost = 0, done = 0;
  story.shots.forEach((sh, i) => {
    const m = ms[i]; const d = P().fitDuration(m, sh.duration);
    secs += d; if (sh.clipId) done++;
    cost += P().estimateCost(m, d, resFor(m), S.audio);
  });
  const mm = Math.floor(secs / 60), ss = secs % 60;
  $('#sumText').textContent = `${story.shots.length} shot${story.shots.length === 1 ? '' : 's'} · ${mm ? mm + 'm ' : ''}${ss}s · ${done} done · ≈$${cost.toFixed(2)} for all`;
  const pending = story.shots.filter(sh => !sh.clipId && !busy(sh) && sh.prompt.trim()).length;
  $('#genAll').textContent = pending ? `Generate ${pending} pending` : 'Generate all';
  $('#genAll').disabled = !pending;
}
const busy = sh => ['uploading', 'queued', 'running', 'saving', 'waiting'].includes(sh.status);

// ---------- shots ----------
function renderShots() {
  const ol = $('#shots');
  ol.innerHTML = '';
  story.shots.forEach((sh, i) => ol.appendChild(shotEl(sh, i)));
  renderSummary();
}

function libOptions(selected) {
  const list = [...images.values()].sort((a, b) => b.createdAt - a.createdAt);
  return `<option value="">${list.length ? 'or reuse an image…' : 'no saved images yet'}</option>` +
    list.map(im => `<option value="${im.id}" ${im.id === selected ? 'selected' : ''}>${esc(im.name)}</option>`).join('');
}

function shotEl(sh, i) {
  const li = $('#shotTpl').content.firstElementChild.cloneNode(true);
  li.dataset.id = sh.id;
  $('.num', li).textContent = 'Shot ' + (i + 1);
  const ta = $('.prompt', li);
  ta.id = 'p-' + sh.id; $('label.sr', li).htmlFor = ta.id;
  ta.value = sh.prompt;
  ta.addEventListener('input', () => { sh.prompt = ta.value; saveStory(); renderSummary(); });
  $('.up', li).disabled = i === 0;
  $('.down', li).disabled = i === story.shots.length - 1;
  $('.up', li).onclick = () => move(i, -1);
  $('.down', li).onclick = () => move(i, 1);
  $('.del', li).onclick = () => {
    if ((sh.prompt.trim() || sh.clipId) && !confirm(`Delete shot ${i + 1}? (Its clips stay in the Gallery.)`)) return;
    story.shots.splice(i, 1); saveStory(); renderShots();
  };
  // model + duration
  const msel = $('.model', li); fillModelSelect(msel, sh.model);
  const dsel = $('.dur', li);
  const fillDur = () => {
    const m = P().getModel(sh.model);
    sh.duration = P().fitDuration(m, sh.duration);
    dsel.innerHTML = m.durations.map(d => `<option value="${d}">${d} s</option>`).join('');
    dsel.value = String(sh.duration); dsel.disabled = m.durations.length === 1;
    const est = P().estimateCost(m, sh.duration, resFor(m), S.audio);
    $('.price', li).innerHTML = `${m.open ? '<span class="tag open">open source</span>' : '<span class="tag closed">closed</span>'} fal price: ${esc(m.price)} · this shot ≈ $${est.toFixed(2)}${sh.imageId ? '' : ' · text only'}`;
  };
  fillDur();
  msel.onchange = () => { sh.model = msel.value; fillDur(); saveStory(); renderSummary(); };
  dsel.onchange = () => { sh.duration = Number(dsel.value); fillDur(); saveStory(); renderSummary(); };
  // start image
  const thumb = $('.thumb', li), lib = $('.libpick', li);
  const showImg = () => {
    const im = sh.imageId && images.get(sh.imageId);
    thumb.hidden = !im;
    if (im) $('img', thumb).src = objUrl(im.id, im.blob);
    lib.innerHTML = libOptions(sh.imageId);
    fillDur();
  };
  showImg();
  $('.addimg input', li).onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const im = await addImage(f); sh.imageId = im.id; saveStory(); showImg(); refreshLibPickers();
    e.target.value = '';
  };
  lib.onchange = () => { sh.imageId = lib.value || null; saveStory(); showImg(); };
  $('.rmimg', li).onclick = () => { sh.imageId = null; saveStory(); showImg(); };
  // generate
  $('.gen', li).onclick = () => enqueue(sh.id, true);
  $('.cancel', li).onclick = () => stopShot(sh.id);
  paintShot(sh, li);
  return li;
}

function refreshLibPickers() {
  $$('#shots .shot').forEach(li => {
    const sh = story.shots.find(s => s.id === li.dataset.id); if (!sh) return;
    $('.libpick', li).innerHTML = libOptions(sh.imageId);
  });
}

function move(i, d) {
  const j = i + d; if (j < 0 || j >= story.shots.length) return;
  [story.shots[i], story.shots[j]] = [story.shots[j], story.shots[i]];
  saveStory(); renderShots();
}

const LABEL = { idle: '', waiting: 'waiting', uploading: 'uploading', queued: 'queued', running: 'generating', saving: 'saving', done: 'done', failed: 'failed' };
async function paintShot(sh, li) {
  li = li || $(`#shots .shot[data-id="${sh.id}"]`);
  if (!li) return;
  const b = $('.badge', li);
  b.className = 'badge ' + sh.status; b.textContent = LABEL[sh.status] || ''; b.hidden = !LABEL[sh.status];
  $('.progress', li).hidden = !busy(sh);
  const st = $('.status', li);
  st.className = 'status small' + (sh.status === 'failed' ? ' bad' : '');
  st.textContent = sh.status === 'failed' ? sh.error : (sh.note || '');
  $('.gen', li).hidden = busy(sh);
  $('.gen', li).textContent = sh.clipId ? 'New take' : 'Generate';
  $('.cancel', li).hidden = !busy(sh);
  ['.prompt', '.model', '.dur'].forEach(s => { $(s, li).disabled = busy(sh) || (s === '.dur' && P().getModel(sh.model).durations.length === 1); });
  const box = $('.clip', li);
  if (sh.clipId) {
    if (box.dataset.clip !== sh.clipId) {
      box.dataset.clip = sh.clipId;
      const c = await db.get('clips', sh.clipId);
      box.innerHTML = '';
      if (c) box.appendChild(clipView(c, true));
    }
  } else { box.innerHTML = ''; delete box.dataset.clip; }
}

function clipSrc(c) { return c.blob ? objUrl(c.id, c.blob) : c.sourceUrl; }
const posterSrc = c => clipSrc(c) + '#t=0.1'; // shows the first frame instead of black on iPhone
function clipName(c) {
  const t = (stories.find(s => s.id === c.storyId) || {}).title || 'clip';
  return `${t.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'clip'}-shot${(c.order ?? 0) + 1}-${c.id}.mp4`;
}

function clipView(c, compact) {
  const wrap = document.createElement('div');
  const v = document.createElement('video');
  v.src = posterSrc(c); v.controls = true; v.playsInline = true; v.preload = 'metadata';
  wrap.appendChild(v);
  const a = document.createElement('div'); a.className = 'clip-actions';
  a.innerHTML = `<button class="btn ghost dl" type="button">Download</button>` +
    (canShare() ? `<button class="btn ghost sh" type="button">Save / Share</button>` : '') +
    (c.blob ? '' : `<span class="muted small">Not saved on this device yet (fal links can expire), tap Download.</span>`);
  wrap.appendChild(a);
  $('.dl', a).onclick = () => downloadClip(c);
  const shb = $('.sh', a); if (shb) shb.onclick = () => shareClip(c);
  return wrap;
}

function canShare() {
  try { return !!(navigator.canShare && navigator.canShare({ files: [new File([new Blob()], 'x.mp4', { type: 'video/mp4' })] })); } catch (e) { return false; }
}
async function ensureBlob(c) {
  if (c.blob) return c.blob;
  const r = await fetch(c.sourceUrl); if (!r.ok) throw new Error('The clip link has expired (' + r.status + ').');
  c.blob = await r.blob(); await db.put('clips', c); return c.blob;
}
async function downloadClip(c) {
  try {
    const blob = await ensureBlob(c);
    const a = document.createElement('a'); a.href = objUrl(c.id, blob); a.download = clipName(c);
    document.body.appendChild(a); a.click(); a.remove();
  } catch (e) { alert(e.message); }
}
async function shareClip(c) {
  try { const blob = await ensureBlob(c); await navigator.share({ files: [new File([blob], clipName(c), { type: 'video/mp4' })] }); }
  catch (e) { if (e.name !== 'AbortError') alert(e.message); }
}

// ---------- images ----------
async function addImage(file) {
  const blob = await shrinkImage(file, 1600);
  const im = { id: uid(), blob, name: (file.name || 'image').replace(/\.[^.]+$/, '').slice(0, 40), createdAt: Date.now(), falUrl: null, falUrlAt: 0 };
  await db.put('images', im); images.set(im.id, im);
  return im;
}
async function shrinkImage(file, max) {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (k === 1 && /jpe?g|png/.test(file.type) && file.size < 4e6) return file;
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
  } catch (e) { return file; }
}
async function imageUrlFor(imageId) {
  const im = images.get(imageId); if (!im) return null;
  if (im.falUrl && Date.now() - im.falUrlAt < 6 * 3600e3 && !im.falUrl.startsWith('data:')) return im.falUrl;
  const u = await P().uploadImage(im.blob, key());
  if (!u.startsWith('data:')) { im.falUrl = u; im.falUrlAt = Date.now(); await db.put('images', im); }
  return u;
}

// ---------- generation queue ----------
const queue = [];        // shot ids waiting for a slot
const active = new Set(); // shot ids in flight
const stopped = new Set();

function findShot(id) {
  for (const s of stories) { const sh = s.shots.find(x => x.id === id); if (sh) return [s, sh]; }
  return [null, null];
}
function persist(s) { if (s === story) saveStory(true); else db.put('stories', JSON.parse(JSON.stringify(s))); }
function update(s, sh, patch) { Object.assign(sh, patch); persist(s); if (s === story) { paintShot(sh); renderSummary(); } }

function enqueue(id, user) {
  const [s, sh] = findShot(id); if (!sh) return;
  if (!key()) { show('settings'); $('#keyStatus').textContent = 'Paste your fal.ai key first.'; $('#keyStatus').className = 'status bad'; return; }
  if (!sh.prompt.trim()) { update(s, sh, { status: 'failed', error: 'Write a prompt for this shot first.' }); return; }
  if (busy(sh)) return;
  stopped.delete(id);
  update(s, sh, { status: 'waiting', note: 'Waiting for a free slot…', error: '', job: null });
  queue.push(id); pump();
}
function pump() {
  while (active.size < Number(S.concurrency || 3) && queue.length) {
    const id = queue.shift(); active.add(id);
    runShot(id).finally(() => { active.delete(id); pump(); });
  }
}
async function stopShot(id) {
  stopped.add(id);
  const qi = queue.indexOf(id); if (qi >= 0) queue.splice(qi, 1);
  const [s, sh] = findShot(id); if (!sh) return;
  if (sh.job) P().cancel(sh.job, key());
  update(s, sh, { status: sh.clipId ? 'done' : 'idle', note: 'Stopped.', job: null });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function runShot(id) {
  let [s, sh] = findShot(id); if (!sh) return;
  const prov = P();
  try {
    if (!sh.job) {
      const m = prov.getModel(sh.model);
      let imageUrl = null;
      if (sh.imageId) { update(s, sh, { status: 'uploading', note: 'Uploading start image…' }); imageUrl = await imageUrlFor(sh.imageId); }
      if (stopped.has(id)) return;
      const { endpoint, input, duration } = prov.buildInput(m, sh, { imageUrl, aspect: s.aspect, resolution: resFor(m), audio: S.audio && m.audio });
      update(s, sh, { status: 'queued', note: 'Sending to ' + m.name + '…' });
      const job = await prov.submit(endpoint, input, key());
      update(s, sh, { job: { ...job, endpoint, model: m.key, duration, res: input.resolution || m.defaultRes, at: Date.now() }, note: 'In line at fal…' });
    }
    await followJob(s, sh);
  } catch (e) {
    if (!stopped.has(id)) update(s, sh, { status: 'failed', error: friendly(e), note: '', job: null });
  }
}

function friendly(e) {
  const m = String(e && e.message || e);
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Network problem reaching fal.ai. Check your connection and try again.';
  return m;
}

async function followJob(s, sh) {
  const prov = P();
  const id = sh.id;
  const t0 = sh.job.at || Date.now();
  let delay = 2500, errs = 0;
  for (;;) {
    if (stopped.has(id)) return;
    await sleep(delay);
    if (stopped.has(id) || !sh.job) return;
    let st;
    try { st = await prov.poll(sh.job, key()); errs = 0; }
    catch (e) { if (++errs > 6) throw e; delay = Math.min(15000, delay * 1.5); continue; }
    const secs = Math.round((Date.now() - t0) / 1000);
    if (st.state === 'queued') update(s, sh, { status: 'queued', note: `In line at fal${st.position != null ? ' (#' + (st.position + 1) + ')' : ''} · ${secs}s` });
    else if (st.state === 'running') update(s, sh, { status: 'running', note: `Generating · ${secs}s${st.logs.length ? ' · ' + st.logs[st.logs.length - 1].slice(0, 80) : ''}` });
    else if (st.state === 'failed') throw new Error(st.error || 'fal.ai reported a failure.');
    else if (st.state === 'done') break;
    delay = Math.min(6000, delay + 500);
  }
  update(s, sh, { status: 'saving', note: 'Saving clip to this device…' });
  const res = await prov.result(sh.job, key());
  let blob = null;
  try { const r = await fetch(res.videoUrl); if (r.ok) blob = await r.blob(); } catch (e) {}
  const m = prov.getModel(sh.job.model);
  const clip = {
    id: uid(), storyId: s.id, shotId: sh.id, order: s.shots.indexOf(sh), prompt: sh.prompt, model: m.key, modelName: m.name,
    endpoint: sh.job.endpoint, duration: sh.job.duration, res: sh.job.res, aspect: s.aspect, imageId: sh.imageId,
    sourceUrl: res.videoUrl, blob, contentType: res.contentType, seed: res.seed, createdAt: Date.now(), provider: prov.id,
  };
  await db.put('clips', clip);
  update(s, sh, { status: 'done', clipId: clip.id, job: null, note: blob ? 'Saved on this device.' : 'Done. Tap Download to keep it.' });
}

$('#genAll').addEventListener('click', () => {
  story.shots.filter(sh => !sh.clipId && !busy(sh) && sh.prompt.trim()).forEach(sh => enqueue(sh.id));
});
$('#addShot').addEventListener('click', () => {
  const last = story.shots[story.shots.length - 1];
  const sh = newShotFor(story);
  if (last) { sh.model = last.model; sh.duration = last.duration; sh.imageId = null; }
  story.shots.push(sh); saveStory(); renderShots();
  const li = $(`#shots .shot[data-id="${sh.id}"]`); li.scrollIntoView({ behavior: 'smooth', block: 'center' }); $('.prompt', li).focus({ preventScroll: true });
});

// resume jobs that were in flight when the page closed
function resumeJobs() {
  for (const s of stories) for (const sh of s.shots) {
    if (sh.job && sh.job.statusUrl) { sh.status = 'queued'; sh.note = 'Checking on this shot…'; active.add(sh.id); runShot(sh.id).finally(() => { active.delete(sh.id); pump(); }); }
    else if (busy(sh)) { sh.status = sh.clipId ? 'done' : 'idle'; sh.note = ''; }
  }
}

// ---------- final movie ----------
async function storyClips() {
  const out = [];
  for (const sh of story.shots) { if (!sh.clipId) continue; const c = await db.get('clips', sh.clipId); if (c) out.push(c); }
  return out;
}
$('#stitchBtn').addEventListener('click', async () => {
  const st = $('#stitchStatus');
  const missing = story.shots.filter(sh => !sh.clipId).length;
  const clips = await storyClips();
  if (!clips.length) { st.className = 'status bad'; st.textContent = 'Generate at least one shot first.'; return; }
  if (missing && !confirm(`${missing} shot(s) have no clip yet. Stitch the ${clips.length} that do?`)) return;
  $('#stitchBtn').disabled = true; st.className = 'status';
  try {
    for (const c of clips) await ensureBlob(c);
    const same = clips.every(c => c.model === clips[0].model && c.res === clips[0].res && c.aspect === clips[0].aspect);
    const blob = await stitch(clips, { aspect: story.aspect, mode: same ? 'fast' : 'encode', onStatus: t => { st.textContent = t; } });
    const secs = clips.reduce((a, c) => a + (c.duration || 0), 0);
    const fin = { id: uid(), storyId: story.id, title: story.title, blob, shots: clips.length, seconds: secs, createdAt: Date.now() };
    await db.put('finals', fin);
    st.className = 'status ok'; st.textContent = `Done: ${clips.length} shots, about ${secs}s.`;
    renderFinalOut(fin);
  } catch (e) {
    console.warn(e);
    st.className = 'status bad';
    st.textContent = 'This browser could not join the clips (' + String(e.message || e).slice(0, 120) + '). Use "Play all in order", or try on a computer.';
  } finally { $('#stitchBtn').disabled = false; }
});

async function renderFinalOut(fin) {
  const box = $('#finalOut');
  if (!fin) { const all = (await db.all('finals')).filter(f => f.storyId === story.id).sort((a, b) => b.createdAt - a.createdAt); fin = all[0]; }
  box.innerHTML = '';
  if (!fin) return;
  box.appendChild(finalView(fin));
}
function finalName(f) { return `${(f.title || 'movie').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'movie'}-${new Date(f.createdAt).toISOString().slice(0, 10)}.mp4`; }
function finalView(f) {
  const w = document.createElement('div');
  w.innerHTML = `<video controls playsinline preload="metadata"></video><div class="clip-actions"><button class="btn primary dl" type="button">Download movie</button>${canShare() ? '<button class="btn ghost sh" type="button">Save / Share</button>' : ''}<span class="muted small">${f.shots} shots · ${f.seconds}s · ${new Date(f.createdAt).toLocaleString()}</span></div>`;
  $('video', w).src = objUrl(f.id, f.blob) + '#t=0.1';
  $('.dl', w).onclick = () => { const a = document.createElement('a'); a.href = objUrl(f.id, f.blob); a.download = finalName(f); document.body.appendChild(a); a.click(); a.remove(); };
  const sb = $('.sh', w); if (sb) sb.onclick = async () => { try { await navigator.share({ files: [new File([f.blob], finalName(f), { type: 'video/mp4' })] }); } catch (e) {} };
  return w;
}

// play-all fallback (works everywhere, no joining needed)
$('#playAllBtn').addEventListener('click', async () => {
  const clips = await storyClips();
  if (!clips.length) { $('#stitchStatus').className = 'status bad'; $('#stitchStatus').textContent = 'No clips yet.'; return; }
  playList(clips.map(c => ({ src: clipSrc(c), label: `Shot ${story.shots.findIndex(s => s.id === c.shotId) + 1}` })), story.title);
});
function playList(items, title) {
  const dlg = $('#player'), v = $('#playerVideo'); let i = 0;
  const go = () => { $('#playerTitle').textContent = `${title || 'Playing'} · ${items[i].label} (${i + 1}/${items.length})`; v.src = items[i].src; v.play().catch(() => {}); };
  v.onended = () => { if (++i < items.length) go(); };
  dlg.showModal ? dlg.showModal() : dlg.setAttribute('open', '');
  go();
}
$('#playerClose').addEventListener('click', () => { const v = $('#playerVideo'); v.pause(); v.removeAttribute('src'); v.load(); $('#player').close(); });

// ---------- gallery ----------
async function renderGallery() {
  const clips = (await db.all('clips')).sort((a, b) => b.createdAt - a.createdAt);
  const finals = (await db.all('finals')).sort((a, b) => b.createdAt - a.createdAt);
  const f = $('#galleryFilter'); const cur = f.value || 'all';
  f.innerHTML = `<option value="all">All stories</option>` + stories.map(s => `<option value="${s.id}">${esc(s.title)}</option>`).join('');
  f.value = [...f.options].some(o => o.value === cur) ? cur : 'all';
  const list = clips.filter(c => f.value === 'all' || c.storyId === f.value);
  const grid = $('#clipGrid'); grid.innerHTML = list.length ? '' : '<p class="empty">No clips yet. Generate a shot and it lands here.</p>';
  for (const c of list) {
    const t = document.createElement('div'); t.className = 'tile';
    const st = stories.find(s => s.id === c.storyId);
    t.innerHTML = `<video playsinline controls preload="metadata"></video><div class="meta"><b>${esc(st ? st.title : 'Deleted story')}</b> · shot ${(c.order ?? 0) + 1} · ${esc(c.modelName)} · ${c.duration}s<br>${esc(c.prompt)}</div><div class="acts"><button class="btn ghost dl" type="button">Download</button><button class="btn ghost rm" type="button" aria-label="Delete clip">Delete</button></div>`;
    $('video', t).src = posterSrc(c);
    $('.dl', t).onclick = () => downloadClip(c);
    $('.rm', t).onclick = async () => {
      if (!confirm('Delete this clip from this device?')) return;
      await db.del('clips', c.id);
      for (const s of stories) for (const sh of s.shots) if (sh.clipId === c.id) { sh.clipId = null; sh.status = 'idle'; persist(s); }
      renderGallery(); if (story) renderShots();
    };
    grid.appendChild(t);
  }
  const fl = $('#finalsList'); fl.innerHTML = finals.length ? '' : '<p class="empty">Stitched movies show up here.</p>';
  for (const m of finals) {
    const row = document.createElement('div'); row.className = 'tile';
    row.appendChild(finalView(m));
    const rm = document.createElement('button'); rm.className = 'btn ghost'; rm.type = 'button'; rm.textContent = 'Delete movie';
    rm.onclick = async () => { if (confirm('Delete this movie from this device?')) { await db.del('finals', m.id); renderGallery(); renderFinalOut(); } };
    row.appendChild(rm); fl.appendChild(row);
  }
  renderImages();
  storageNote();
}
$('#galleryFilter').addEventListener('change', renderGallery);

function renderImages() {
  const g = $('#imgGrid'); const list = [...images.values()].sort((a, b) => b.createdAt - a.createdAt);
  g.innerHTML = list.length ? '' : '<p class="empty">No images yet.</p>';
  for (const im of list) {
    const t = document.createElement('div'); t.className = 'tile';
    t.innerHTML = `<img alt=""><div class="meta">${esc(im.name)}</div><div class="acts"><button class="btn ghost rm" type="button">Delete</button></div>`;
    $('img', t).src = objUrl(im.id, im.blob); $('img', t).alt = im.name;
    $('.rm', t).onclick = async () => {
      if (!confirm('Delete this image?')) return;
      await db.del('images', im.id); images.delete(im.id);
      for (const s of stories) for (const sh of s.shots) if (sh.imageId === im.id) { sh.imageId = null; persist(s); }
      renderImages(); renderShots();
    };
    g.appendChild(t);
  }
}
$('#libUpload').addEventListener('change', async e => { for (const f of e.target.files) await addImage(f); e.target.value = ''; renderImages(); refreshLibPickers(); });

async function storageNote() {
  const est = await storageEstimate();
  const t = est ? `Saved on this device: ${(est.usage / 1e6).toFixed(0)} MB of about ${(est.quota / 1e9).toFixed(1)} GB available to this site. Clips stay until you delete them or clear Safari's website data.` : '';
  $('#storageNote').textContent = t; $('#storageNote2').textContent = t;
}

// ---------- settings ----------
function renderSettings() {
  $('#falKey').value = key();
  seg($('#qualitySeg'), S.quality, v => { S.quality = v; saveSettings(); renderShots(); });
  $('#audioOn').checked = !!S.audio;
  $('#concurrency').value = String(S.concurrency);
  $('#modelList').innerHTML = P().models.map(m => `<div class="mrow"><b>${esc(m.name)}<span class="tag ${m.open ? 'open' : 'closed'}">${m.open ? 'open source' : 'closed'}</span></b><span>${esc(m.price)} · ${m.durations.length > 1 ? m.durations[0] + '–' + m.durations[m.durations.length - 1] + ' s' : m.durations[0] + ' s'}${m.audio ? ' · can make sound' : ''}</span><span class="mono small">${esc(m.i2v)}<br>${esc(m.t2v)}</span></div>`).join('');
  storageNote();
}
$('#toggleKey').addEventListener('click', () => { const i = $('#falKey'); const show = i.type === 'password'; i.type = show ? 'text' : 'password'; $('#toggleKey').textContent = show ? 'Hide' : 'Show'; });
$('#saveKey').addEventListener('click', () => {
  const v = $('#falKey').value.trim(); const st = $('#keyStatus');
  if (!v) { st.className = 'status bad'; st.textContent = 'Paste a key first.'; return; }
  if (/\s/.test(v) || v.length < 20) { st.className = 'status bad'; st.textContent = 'That does not look like a fal.ai key (it is a long code, usually with a colon in it).'; return; }
  S.keys[S.provider] = v; saveSettings(); keyBanner();
  st.className = 'status ok'; st.textContent = 'Saved on this device.';
});
$('#clearKey').addEventListener('click', () => { delete S.keys[S.provider]; saveSettings(); $('#falKey').value = ''; keyBanner(); $('#keyStatus').className = 'status'; $('#keyStatus').textContent = 'Key removed from this device.'; });
$('#audioOn').addEventListener('change', e => { S.audio = e.target.checked; saveSettings(); renderShots(); });
$('#concurrency').addEventListener('change', e => { S.concurrency = Number(e.target.value); saveSettings(); pump(); });

// ---------- boot ----------
let started = false;
async function start() {
  if (started) return; started = true;
  $('#gate').hidden = true; $('#app').hidden = false;
  try {
    for (const im of await db.all('images')) images.set(im.id, im);
    await loadStories();
    localStorage.setItem(LS.current, story.id);
    keyBanner(); renderStoryBar(); resumeJobs(); renderShots(); renderFinalOut();
  } catch (e) {
    console.error(e);
    $('#keyBanner').hidden = false; $('#keyBanner').textContent = 'This browser blocked local storage (private mode?). Clips cannot be saved here.';
  }
}
if (localStorage.getItem(LS.unlock) === PW_HASH) start();
else $('#pw').focus();
