import { db, storageEstimate, persistStorage } from './db.js';
import { getProvider, defaultProvider } from './providers/index.js';
import { stitch, outputSize } from './stitch.js';
import { icon, hydrateIcons } from './lib/icons.js';
import * as C from './lib/core.js';

// ---------- password gate (only the SHA-256 hash lives in this code; same gate as v1) ----------
const PW_HASH = '162c8e48e83400fb9cac9947ab71ea63e5e27490040529ddae7283fda6991d64';
// localStorage keys shared with v1 (unlock + fal key carry over), plus v2's own.
const LS = { unlock: 'ss.unlock.v1', settings: 'ss.settings.v1', current: 'ss2.current', spent: 'ss2.spent' };
const SS = { spent: 'ss2.spent.session' };
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const haptic = () => { try { navigator.vibrate && navigator.vibrate(8); } catch (e) {} };
hydrateIcons();

async function sha256(t) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
$('#gateForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (await sha256($('#pw').value.trim()) === PW_HASH) { localStorage.setItem(LS.unlock, PW_HASH); haptic(); start(); }
  else { $('#gateErr').textContent = 'That password is not right.'; const c = $('.pw-wrap'); c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake'); $('#pw').select(); }
});
const lock = () => { localStorage.removeItem(LS.unlock); location.reload(); };
$('#lockBtn').addEventListener('click', lock);
$('#lockBtnTop').addEventListener('click', lock);

// ---------- settings (same object v1 uses) ----------
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

// ---------- spend counters ----------
function readSpent() {
  try { return { session: Number(sessionStorage.getItem(SS.spent)) || 0, total: Number(JSON.parse(localStorage.getItem(LS.spent) || '{}').total) || 0 }; }
  catch (e) { return { session: 0, total: 0 }; }
}
function addSpent(x) {
  const s = readSpent();
  sessionStorage.setItem(SS.spent, String(s.session + x));
  localStorage.setItem(LS.spent, JSON.stringify({ total: s.total + x, at: Date.now() }));
  paintSpent(true);
}
function paintSpent(bump) {
  const s = readSpent();
  $('#spentVal').textContent = C.money(s.session);
  $('#spSession').textContent = C.money(s.session);
  $('#spTotal').textContent = C.money(s.total);
  if (bump && $('#spentPill').animate) $('#spentPill').animate([{ transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 400, easing: 'cubic-bezier(.2,.8,.2,1)' });
}
$('#resetSpend').addEventListener('click', () => { if (!confirm('Reset both spend counters?')) return; sessionStorage.removeItem(SS.spent); localStorage.removeItem(LS.spent); paintSpent(); });

// ---------- toasts / menus / sheet ----------
function toast(msg, kind = 'ok') {
  const t = document.createElement('div'); t.className = 'toast ' + kind;
  t.innerHTML = icon(kind === 'bad' ? 'alert' : 'check') + `<span>${esc(msg)}</span>`;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 2800);
}
let menuEl = null;
function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
function openMenu(anchor, items) {
  closeMenu(); haptic();
  const m = document.createElement('div'); m.className = 'menu'; m.setAttribute('role', 'menu');
  items.forEach(it => {
    if (it === '-') { m.appendChild(document.createElement('hr')); return; }
    const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'menuitem');
    if (it.danger) b.className = 'danger';
    b.innerHTML = icon(it.icon) + `<span>${esc(it.label)}</span>`;
    b.onclick = (e) => { e.stopPropagation(); closeMenu(); it.run(); };
    m.appendChild(b);
  });
  document.body.appendChild(m); menuEl = m;
  const r = anchor.getBoundingClientRect(); const mw = m.offsetWidth, mh = m.offsetHeight;
  const x = Math.min(window.innerWidth - mw - 8, Math.max(8, r.right - mw));
  let y = r.bottom + 6; if (y + mh > window.innerHeight - 8) y = Math.max(8, r.top - mh - 6);
  m.style.left = x + 'px'; m.style.top = y + 'px';
  setTimeout(() => { const f = m.querySelector('button'); if (f) f.focus({ preventScroll: true }); }, 10);
}
document.addEventListener('click', (e) => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMenu(); if (!$('#sheet').hidden) closeSheet(); else if (!$('#player').hidden) closePlayer(); } });

let sheetOnClose = null;
function openSheet(title, build, onClose) {
  const sh = $('#sheet'); sh.classList.remove('closing');
  $('#sheetTitle').textContent = title;
  const body = $('#sheetBody'); body.innerHTML = ''; body.scrollTop = 0;
  build(body);
  hydrateIcons(body);
  sheetOnClose = onClose || null;
  sh.hidden = false; document.body.style.overflow = 'hidden';
}
function closeSheet() {
  const sh = $('#sheet'); if (sh.hidden) return;
  sh.classList.add('closing');
  setTimeout(() => { sh.hidden = true; sh.classList.remove('closing'); document.body.style.overflow = ''; $('#sheetBody').innerHTML = ''; }, 240);
  const f = sheetOnClose; sheetOnClose = null; if (f) f();
}
$$('#sheet [data-close]').forEach(b => b.addEventListener('click', closeSheet));

// ---------- state ----------
let project = null;        // current project (a v1 "story" record, upgraded in memory)
let projects = [];
let images = new Map();    // id -> {id, blob, name, falUrl, falUrlAt}
let cast = [];             // [{id, name, description, imageId}]
const urls = new Map();
const objUrl = (id, blob) => { if (!urls.has(id)) urls.set(id, URL.createObjectURL(blob)); return urls.get(id); };
const imgUrl = (id) => { const im = images.get(id); return im && im.blob ? objUrl('img:' + id, im.blob) : ''; };
const thumbs = new Map();  // clipId -> dataURL
const editor = { id: null, refresh: null };

let saveT = null;
function saveProject(now) {
  if (!project) return;
  project.updatedAt = Date.now();
  clearTimeout(saveT);
  const p = project;
  const go = () => db.put('stories', JSON.parse(JSON.stringify(p))).catch(err => { console.warn(err); toast('Could not save: ' + (err.message || err), 'bad'); });
  if (now) return go();
  saveT = setTimeout(go, 300);
}
function persist(p) { if (p === project) saveProject(true); else db.put('stories', JSON.parse(JSON.stringify(p))); }
const busy = sh => ['uploading', 'queued', 'running', 'saving', 'waiting'].includes(sh.status);

// ---------- navigation ----------
let view = 'board';
function show(v) {
  view = v;
  $$('.nav-btn[data-view]').forEach(t => { const on = t.dataset.view === v; t.classList.toggle('active', on); if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current'); });
  $$('.view').forEach(x => { x.hidden = x.id !== 'view-' + v; });
  if (v === 'projects') renderProjects();
  if (v === 'board') renderBoard();
  if (v === 'cast') renderCast();
  if (v === 'gallery') renderGallery();
  if (v === 'settings') renderSettings();
  window.scrollTo({ top: 0 });
}
$$('.nav-btn[data-view]').forEach(t => t.addEventListener('click', () => { haptic(); show(t.dataset.view); }));
document.addEventListener('click', e => { const g = e.target.closest('[data-goto]'); if (g) show(g.dataset.goto); });
$('#projBtn').addEventListener('click', () => show('projects'));
function keyBanner() { $('#keyBanner').hidden = !!key(); }

function seg(el, value, onPick) {
  $$('button', el).forEach(b => {
    b.setAttribute('aria-checked', String(b.dataset.v === String(value)));
    b.onclick = () => { haptic(); $$('button', el).forEach(x => x.setAttribute('aria-checked', String(x === b))); onPick(b.dataset.v); };
  });
}

// ---------- loading ----------
async function loadAll() {
  const [st, ims, cs] = await Promise.all([db.all('stories'), db.all('images'), db.all('cast').catch(() => [])]);
  images = new Map(ims.map(i => [i.id, i]));
  cast = cs.sort((a, b) => a.createdAt - b.createdAt);
  projects = st.map(C.upgradeProject).sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
  if (!projects.length) { const p = C.newProject(1, P().defaultModel); await db.put('stories', p); projects = [p]; }
  const cur = localStorage.getItem(LS.current) || localStorage.getItem('ss.story.v1');
  project = projects.find(p => p.id === cur) || projects[0];
}
function setProject(p) {
  saveProject(true);
  project = p; localStorage.setItem(LS.current, p.id);
  $('#topTitle').textContent = p.title || 'Untitled';
}

// ---------- projects view ----------
async function coverFor(p) {
  if (p.cover && p.cover.thumb) return p.cover.thumb;
  for (const sh of p.shots) if (sh.clipId) { const t = await clipThumb(sh.clipId); if (t) return t; }
  for (const sh of p.shots) if (sh.imageId && imgUrl(sh.imageId)) return imgUrl(sh.imageId);
  return '';
}
async function renderProjects() {
  const g = $('#projectGrid');
  g.innerHTML = '<div class="skel" style="aspect-ratio:4/5"></div>'.repeat(Math.max(2, Math.min(4, projects.length)));
  projects.sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
  const cards = await Promise.all(projects.map(async (p) => {
    const cov = await coverFor(p);
    const secs = C.runtime(p.shots.map(shotSecs), p.finish);
    const done = p.shots.filter(s => s.clipId).length;
    const b = document.createElement('div'); b.className = 'pcard' + (p === project ? ' current' : ''); b.tabIndex = 0; b.setAttribute('role', 'button');
    b.setAttribute('aria-label', 'Open ' + (p.title || 'Untitled'));
    b.innerHTML = `<div class="cov" ${cov ? `style="background-image:url('${cov}')"` : ''}>${cov ? '' : `<div class="ph">${icon('film')}</div>`}</div>
      ${p === project ? '<span class="badge">Open</span>' : ''}
      <button class="icon-btn more" type="button" aria-label="Project options">${icon('more')}</button>
      <div class="info"><b>${esc(p.title || 'Untitled')}</b><small>${p.shots.length} shot${p.shots.length === 1 ? '' : 's'} · ${C.fmtTime(secs)} · ${done} rendered · ${p.aspect}</small></div>`;
    const open = () => { setProject(p); show('board'); };
    b.addEventListener('click', (e) => { if (e.target.closest('.more')) return; open(); });
    b.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === b) open(); });
    $('.more', b).addEventListener('click', (e) => { e.stopPropagation(); openMenu(e.currentTarget, [
      { icon: 'board', label: 'Open', run: open },
      { icon: 'edit', label: 'Rename', run: () => renameProject(p) },
      { icon: 'copy', label: 'Duplicate', run: () => duplicateProject(p) },
      { icon: 'export', label: 'Export as file', run: () => exportProjectFile(p) },
      '-',
      { icon: 'trash', label: 'Delete', danger: true, run: () => deleteProject(p) },
    ]); });
    return b;
  }));
  g.innerHTML = '';
  cards.forEach(c => g.appendChild(c));
}
function renameProject(p) {
  const n = prompt('Project name', p.title || '');
  if (n == null) return;
  p.title = n.trim().slice(0, 80) || 'Untitled'; persist(p);
  if (p === project) $('#topTitle').textContent = p.title;
  renderProjects();
}
async function duplicateProject(p) {
  const c = C.upgradeProject(JSON.parse(JSON.stringify(p)));
  c.id = C.uid(); c.title = (p.title || 'Untitled') + ' copy'; c.createdAt = c.updatedAt = Date.now();
  c.shots = c.shots.map(sh => ({ ...sh, id: C.uid(), job: null, status: 'idle', note: '', error: '' }));
  await db.put('stories', c); projects.unshift(c); toast('Duplicated'); renderProjects();
}
async function deleteProject(p) {
  if (!confirm(`Delete "${p.title}"? Its clips and movies stay in the Gallery.`)) return;
  await db.del('stories', p.id); projects = projects.filter(x => x !== p);
  if (!projects.length) { const n = C.newProject(1, P().defaultModel); await db.put('stories', n); projects = [n]; }
  if (p === project) setProject(projects[0]);
  renderProjects(); toast('Project deleted');
}
$('#newProject').addEventListener('click', async () => {
  const p = C.newProject(projects.length + 1, P().defaultModel);
  await db.put('stories', p); projects.unshift(p); setProject(p); show('board');
  setTimeout(() => { $('#projTitle').focus(); $('#projTitle').select(); }, 50);
});
function blobToDataUrl(blob) { return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(fr.error); fr.readAsDataURL(blob); }); }
async function exportProjectFile(p) {
  const byId = {};
  const want = new Set(p.shots.map(s => s.imageId).filter(Boolean));
  cast.forEach(c => { if (c.imageId && p.shots.some(s => (s.castIds || []).includes(c.id))) want.add(c.imageId); });
  for (const id of want) { const im = images.get(id); if (im && im.blob) byId[id] = await blobToDataUrl(im.blob); }
  const data = C.exportProject(p, cast, byId);
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const name = `${(p.title || 'project').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'project'}.scene.json`;
  saveBlob(blob, name);
  toast('Exported: prompts, style, cast and pictures (clips stay on this device)');
}
$('#importFile').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const { project: p, cast: cs, images: ims } = C.importProject(data);
    for (const [id, url] of Object.entries(ims)) {
      const blob = await (await fetch(url)).blob();
      const im = { id, blob, name: 'imported', createdAt: Date.now(), falUrl: null, falUrlAt: 0 };
      await db.put('images', im); images.set(id, im);
    }
    for (const c of cs) { await db.put('cast', c); cast.push(c); }
    await db.put('stories', p); projects.unshift(p); setProject(p);
    toast(`Imported "${p.title}"`); show('board');
  } catch (err) { toast(err.message || 'Could not read that file', 'bad'); }
});

// ---------- board ----------
function shotSecs(sh) { return P().fitDuration(P().getModel(sh.model), sh.duration); }
function renderBoard() {
  if (!project) return;
  $('#topTitle').textContent = project.title || 'Untitled';
  $('#projTitle').value = project.title || '';
  seg($('#aspectSeg'), project.aspect, v => { project.aspect = v; saveProject(); renderShots(); renderFinish(); });
  renderStyleSummary(); renderShots(); renderFinish(); renderFinalOut(); paintCover();
}
async function paintCover() {
  const c = await coverFor(project);
  $('#heroCover').style.backgroundImage = c ? `url('${c}')` : '';
}
$('#projTitle').addEventListener('input', e => { project.title = e.target.value; $('#topTitle').textContent = project.title || 'Untitled'; saveProject(); });
function renderStyleSummary() {
  const s = project.style;
  $('#styleSummary').textContent = s.applyToAll === false ? 'Style off' : ([s.look, s.lighting].filter(Boolean).join(' · ') || 'Style');
}
function renderStats() {
  const secs = C.runtime(project.shots.map(shotSecs), project.finish);
  const { all, remaining } = C.projectCost(P(), project, resFor, S.audio);
  const done = project.shots.filter(s => s.clipId).length;
  $('#stats').innerHTML = `
    <span class="stat">${icon('video')}<b>${project.shots.length}</b> shots</span>
    <span class="stat">${icon('clock')}<b>${C.fmtTime(secs)}</b> runtime</span>
    <span class="stat">${icon('check')}<b>${done}</b> rendered</span>
    <span class="stat" title="Estimate from fal's listed prices">${icon('coins')}<b>${C.money(remaining)}</b> to render${done ? ` · ${C.money(all)} all` : ''}</span>`;
  const pending = project.shots.filter(sh => !sh.clipId && !busy(sh) && sh.prompt.trim());
  const pc = pending.reduce((a, sh) => a + C.shotCost(P(), sh, resFor, S.audio), 0);
  $('#genAllLbl').textContent = pending.length ? `Generate ${pending.length} · ${C.money(pc)}` : (project.shots.some(busy) ? 'Generating…' : 'Generate all');
  $('#genAll').disabled = !pending.length;
  renderTimeline();
}
function renderTimeline() {
  const tl = $('#timeline'); const f = project.finish;
  const segs = [];
  if (f.titleOn) segs.push({ card: true, secs: C.CARD_SECONDS, label: 'Title' });
  project.shots.forEach((sh, i) => segs.push({ sh, i, secs: shotSecs(sh) }));
  if (f.endOn) segs.push({ card: true, secs: C.CARD_SECONDS, label: 'End' });
  const total = C.runtime(project.shots.map(shotSecs), f);
  $('#tlTotal').innerHTML = icon('clock') + C.fmtTime(total) + (f.crossfade ? ' · crossfades' : '');
  $('#finishRuntime').innerHTML = icon('clock') + C.fmtTime(total);
  if (!project.shots.length) { tl.innerHTML = '<div class="tl-empty">Add a shot to start the timeline</div>'; return; }
  tl.innerHTML = '';
  for (const s of segs) {
    const d = document.createElement('button'); d.type = 'button';
    d.className = 'tl-seg' + (s.card ? ' card' : '') + (s.sh && busy(s.sh) ? ' busy' : '') + (s.sh && s.sh.clipId ? ' done' : '');
    d.style.flex = String(s.secs);
    d.innerHTML = `<span>${s.card ? s.label : s.i + 1}</span>`;
    d.setAttribute('aria-label', s.card ? `${s.label} card, ${s.secs} seconds` : `Shot ${s.i + 1}, ${s.secs} seconds`);
    if (s.sh) {
      d.onclick = () => openShot(s.sh.id);
      const bg = s.sh.clipId ? thumbs.get(s.sh.clipId) : (s.sh.imageId ? imgUrl(s.sh.imageId) : '');
      if (bg) d.style.backgroundImage = `url('${bg}')`;
      else if (s.sh.clipId) clipThumb(s.sh.clipId).then(t => { if (t) d.style.backgroundImage = `url('${t}')`; });
    } else d.onclick = () => $('#finish').scrollIntoView({ behavior: 'smooth' });
    tl.appendChild(d);
  }
}
function renderShots() {
  const ol = $('#board'); ol.innerHTML = '';
  project.shots.forEach((sh, i) => ol.appendChild(shotCard(sh, i)));
  const add = document.createElement('li'); add.className = 'add-shot'; add.tabIndex = 0; add.setAttribute('role', 'button');
  add.innerHTML = `<span class="plus">${icon('plus')}</span><span>Add shot</span><small class="hint">write it or start from a template</small>`;
  add.onclick = () => addShot();
  add.onkeydown = (e) => { if (e.key === 'Enter') addShot(); };
  ol.appendChild(add);
  sampleIfEmpty();
  renderStats();
}
function aspectCss() { return project.aspect === '9:16' ? '9/16' : project.aspect === '1:1' ? '1/1' : '16/9'; }
function shotCard(sh, i) {
  const li = document.createElement('li'); li.className = 'shot'; li.dataset.id = sh.id;
  const m = P().getModel(sh.model); const d = shotSecs(sh);
  const cam = C.cameraMove(sh.camera);
  const people = C.shotCast(sh, cast);
  li.innerHTML = `
    <div class="thumb" style="aspect-ratio:${project.aspect === '9:16' ? '4/5' : aspectCss()}">
      <div class="ph">${icon('camera')}</div>
      <span class="num">${String(i + 1).padStart(2, '0')}</span><span class="dur">${d}s</span>
      ${cam && cam.key !== 'static' ? `<span class="cam">${icon('video')}${esc(cam.name)}</span>` : ''}
    </div>
    <div class="body">
      <div class="ptxt ${sh.prompt.trim() ? '' : 'empty'}">${esc(sh.prompt.trim() || 'Tap to describe this shot…')}</div>
      <p class="err" hidden></p>
      <div class="foot">
        <button class="icon-btn drag" type="button" aria-label="Drag to reorder shot ${i + 1}">${icon('grip')}</button>
        <span class="meta">${people.length ? `<span class="avatars">${people.slice(0, 3).map(c => c.imageId && imgUrl(c.imageId) ? `<img src="${imgUrl(c.imageId)}" alt="${esc(c.name)}">` : `<i>${esc((c.name || '?')[0])}</i>`).join('')}</span>` : ''}<span>${esc(m.name)}</span></span>
        <button class="icon-btn gen-btn" type="button" aria-label="Generate shot ${i + 1}"></button>
        <button class="icon-btn more" type="button" aria-label="Shot ${i + 1} options">${icon('more')}</button>
      </div>
    </div>`;
  $('.thumb', li).onclick = (e) => { if (sh.clipId && e.target.closest('.play')) return playClipOf(sh); openShot(sh.id); };
  $('.ptxt', li).onclick = () => openShot(sh.id);
  $('.more', li).onclick = (e) => { e.stopPropagation(); shotMenu(e.currentTarget, sh); };
  $('.gen-btn', li).onclick = () => { haptic(); if (busy(sh)) stopShot(sh.id); else enqueue(sh.id); };
  setupDrag($('.drag', li), li);
  paintShot(sh, li);
  return li;
}
function shotMenu(anchor, sh) {
  const i = project.shots.indexOf(sh);
  openMenu(anchor, [
    { icon: 'edit', label: 'Edit shot', run: () => openShot(sh.id) },
    { icon: 'copy', label: 'Duplicate', run: () => { project.shots = C.duplicateShot(project, i); saveProject(); renderShots(); toast('Shot duplicated'); } },
    ...(i > 0 ? [{ icon: 'left', label: 'Move earlier', run: () => moveShot(i, i - 1) }] : []),
    ...(i < project.shots.length - 1 ? [{ icon: 'right', label: 'Move later', run: () => moveShot(i, i + 1) }] : []),
    ...(sh.clipId ? [{ icon: 'star', label: 'Use as project cover', run: async () => { const t = await clipThumb(sh.clipId); if (t) { project.cover = { thumb: t }; saveProject(); paintCover(); toast('Cover updated'); } } }] : []),
    '-',
    { icon: 'trash', label: 'Delete shot', danger: true, run: () => deleteShot(sh) },
  ]);
}
function moveShot(from, to) { project.shots = C.reorder(project.shots, from, to); saveProject(); renderShots(); }
function deleteShot(sh) {
  const i = project.shots.indexOf(sh);
  if ((sh.prompt.trim() || sh.clipId) && !confirm(`Delete shot ${i + 1}? Its clips stay in the Gallery.`)) return;
  if (busy(sh)) stopShot(sh.id);
  project.shots.splice(i, 1); saveProject(); closeSheet(); renderShots();
}
async function paintShot(sh, li) {
  li = li || $(`#board .shot[data-id="${sh.id}"]`);
  if (!li) return;
  const th = $('.thumb', li); const gb = $('.gen-btn', li);
  gb.innerHTML = busy(sh) ? icon('stop') : icon(sh.clipId ? 'sparkles' : 'play');
  gb.setAttribute('aria-label', busy(sh) ? 'Stop' : sh.clipId ? 'Generate a new take' : 'Generate');
  gb.title = gb.getAttribute('aria-label');
  const err = $('.err', li); err.hidden = !(sh.status === 'failed' && sh.error); err.textContent = sh.error || '';
  let gen = $('.gen', th);
  if (busy(sh)) {
    if (!gen) { gen = document.createElement('div'); gen.className = 'gen'; th.appendChild(gen); }
    gen.innerHTML = `<div class="spinner"></div><span>${esc(sh.note || 'Working…')}</span>`;
  } else if (gen) gen.remove();
  const old = $('.play', th); if (old) old.remove();
  if (sh.clipId) {
    const t = await clipThumb(sh.clipId);
    if (t) { th.style.backgroundImage = `url('${t}')`; $('.ph', th).hidden = true; }
    if (!busy(sh) && !$('.play', th)) { const p = document.createElement('span'); p.className = 'play'; p.innerHTML = icon('play'); th.appendChild(p); }
  } else if (sh.imageId && imgUrl(sh.imageId)) {
    th.style.backgroundImage = `url('${imgUrl(sh.imageId)}')`; $('.ph', th).hidden = true;
  } else { th.style.backgroundImage = ''; $('.ph', th).hidden = false; }
}
// Pointer drag to reorder (touch and mouse). The grip is the handle.
function setupDrag(handle, li) {
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault(); haptic();
    const ol = $('#board'); const r = li.getBoundingClientRect();
    const ghost = li.cloneNode(true); ghost.classList.add('ghost');
    ghost.style.width = r.width + 'px'; ghost.style.left = r.left + 'px'; ghost.style.top = r.top + 'px';
    document.body.appendChild(ghost); li.classList.add('dragging');
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    let raf = 0, lastY = e.clientY;
    const move = (ev) => {
      ghost.style.left = (ev.clientX - dx) + 'px'; ghost.style.top = (ev.clientY - dy) + 'px'; lastY = ev.clientY;
      for (const c of $$('.shot:not(.dragging):not(.ghost)', ol)) {
        const b = c.getBoundingClientRect();
        if (ev.clientX >= b.left && ev.clientX <= b.right && ev.clientY >= b.top && ev.clientY <= b.bottom) {
          const multi = ol.offsetWidth > b.width * 1.5;
          const after = multi ? ev.clientX > b.left + b.width / 2 : ev.clientY > b.top + b.height / 2;
          if (after) c.after(li); else c.before(li);
          break;
        }
      }
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; const h = window.innerHeight; if (lastY < 90) window.scrollBy(0, -14); else if (lastY > h - 120) window.scrollBy(0, 14); });
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); window.removeEventListener('blur', up);
      ghost.remove(); li.classList.remove('dragging');
      const before = project.shots.map(s => s.id).join();
      const order = $$('.shot', ol).map(x => x.dataset.id);
      project.shots = order.map(id => project.shots.find(s => s.id === id)).filter(Boolean);
      if (project.shots.map(s => s.id).join() !== before) { saveProject(); haptic(); }
      renderShots();
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up); window.addEventListener('blur', up);
  });
}
function addShot(extra = {}) {
  const last = project.shots[project.shots.length - 1];
  const sh = C.newShot(project, last ? { model: last.model, duration: last.duration, castIds: [...(last.castIds || [])] } : {});
  Object.assign(sh, extra);
  project.shots.push(sh); saveProject(); renderShots();
  openShot(sh.id);
  return sh;
}
function sampleIfEmpty() {
  if (!project || project.shots.length > 1 || project.shots.some(s => s.prompt.trim() || s.clipId)) return;
  const li = document.createElement('li'); li.className = 'empty-state sample-cta';
  li.innerHTML = `<div class="ico">${icon('sparkles')}</div><b>Start your story</b><p>Describe your first shot, or load a sample storyboard to see how it all fits together.</p><div class="head-actions" style="justify-content:center"><button class="btn primary" type="button" data-a="sample">${icon('board')}Load sample storyboard</button><button class="btn ghost" type="button" data-a="first">${icon('edit')}Write shot 1</button></div>`;
  $('#board').prepend(li);
  $('[data-a=sample]', li).onclick = () => {
    const m = project.model || P().defaultModel;
    if (/^(Project|Story) \d+$/.test(project.title || '')) project.title = 'Golden Hour Drop';
    project.style = { ...C.defaultStyle(), look: 'Luxury commercial', lighting: 'Golden hour', lens: '50mm shallow depth of field' };
    project.finish = { ...project.finish, titleOn: true, title: 'Golden Hour', subtitle: 'The new collection', endOn: true, endText: 'Available now', crossfade: true };
    project.shots = [
      C.newShot(project, { model: m, camera: 'crane-up', prompt: 'Wide establishing shot of a quiet beach boardwalk at sunrise, waves rolling in, the town waking up' }),
      C.newShot(project, { model: m, camera: 'orbit', prompt: 'Macro shot of a gold cuban link chain on black velvet, light glinting off the metal as it slowly turns' }),
      C.newShot(project, { model: m, camera: 'tracking', prompt: 'A confident man in a black hoodie walks along the boardwalk, the gold chain catching the sun' }),
      C.newShot(project, { model: m, camera: 'dolly-in', prompt: 'Close-up of his hand adjusting the chain, he looks into the camera and smiles' }),
    ];
    saveProject(); renderBoard(); toast('Sample storyboard loaded');
  };
  $('[data-a=first]', li).onclick = () => openShot(project.shots[0] ? project.shots[0].id : addShot().id);
}

// ---------- shot editor sheet ----------
function openShot(id) {
  const sh = project.shots.find(s => s.id === id); if (!sh) return;
  const i = project.shots.indexOf(sh);
  openSheet(`Shot ${i + 1}`, (body) => {
    body.innerHTML = `
      <div id="shVideo"></div>
      <div id="shTakes"></div>
      <span class="lbl">What happens</span>
      <textarea id="shPrompt" rows="4" maxlength="1500" placeholder="e.g. Jay walks out of the shop into the street, holding up a gold chain that catches the sun"></textarea>
      <div class="prompt-tools">
        <button class="btn sm" type="button" id="shEnhance">${icon('wand')}Enhance</button>
        <button class="btn sm ghost" type="button" id="shTplBtn">${icon('board')}Templates</button>
      </div>
      <div class="chips wrap" id="shTpls" hidden style="margin-top:10px"></div>
      <span class="lbl">${icon('video')} Camera move</span>
      <div class="chips" id="shCam"></div>
      <span class="lbl">${icon('users')} Characters</span>
      <div class="chips" id="shCast"></div>
      <span class="lbl">${icon('image')} First frame</span>
      <div class="frames" id="shFrames"></div>
      <span class="lbl">Length</span><div class="seg" id="shDur" role="radiogroup" aria-label="Length"></div>
      <span class="lbl">Model</span><select id="shModel" aria-label="Model"></select>
      <p class="price-note" id="shPrice"></p>
      <details style="margin-top:10px"><summary class="hint" style="cursor:pointer">What the model receives (style applied)</summary><div class="composed" id="shComposed"></div></details>
      <div class="cost-line"><span>Estimated cost of this take</span><b id="shCost"></b></div>
      <p class="status bad" id="shErr" hidden></p>
      <div class="sheet-actions">
        <button class="btn primary lg" type="button" id="shGen"></button>
        <button class="btn ghost lg" type="button" id="shMore" aria-label="More options" style="flex:0 0 56px">${icon('more')}</button>
      </div>`;
    const pr = $('#shPrompt', body); pr.value = sh.prompt;
    const refresh = () => {
      const m = P().getModel(sh.model);
      $('#shComposed', body).textContent = C.composePrompt(sh, project.style, cast) || '—';
      $('#shCost', body).textContent = C.money(C.shotCost(P(), sh, resFor, S.audio));
      $('#shPrice', body).textContent = `${m.name}: ${m.price}${m.open ? ' · open source' : ''}`;
      $('#shGen', body).innerHTML = busy(sh) ? icon('stop') + 'Stop' : icon('sparkles') + (sh.clipId ? 'New take' : 'Generate');
      const e = $('#shErr', body); e.hidden = !(sh.status === 'failed' && sh.error); e.textContent = sh.error || '';
    };
    pr.addEventListener('input', () => {
      sh.prompt = pr.value; saveProject(); refresh(); renderStats();
      const t = $(`#board .shot[data-id="${sh.id}"] .ptxt`); if (t) { t.textContent = sh.prompt.trim() || 'Tap to describe this shot…'; t.classList.toggle('empty', !sh.prompt.trim()); }
    });
    $('#shEnhance', body).onclick = () => {
      if (!pr.value.trim()) { pr.focus(); toast('Write a quick idea first, then Enhance', 'bad'); return; }
      const prev = pr.value; pr.value = C.enhancePrompt(pr.value); sh.prompt = pr.value; saveProject(); refresh(); haptic();
      pr.animate && pr.animate([{ boxShadow: '0 0 0 4px rgba(242,196,109,.45)' }, { boxShadow: '0 0 0 0 rgba(242,196,109,0)' }], { duration: 900 });
      const tools = $('.prompt-tools', body); const old = $('[data-undo]', tools); if (old) old.remove();
      const u = document.createElement('button'); u.className = 'btn sm ghost'; u.type = 'button'; u.dataset.undo = '1'; u.textContent = 'Undo';
      u.onclick = () => { pr.value = prev; sh.prompt = prev; saveProject(); refresh(); u.remove(); };
      tools.appendChild(u);
    };
    const tpls = $('#shTpls', body);
    tpls.innerHTML = C.TEMPLATES.map(t => `<button type="button" class="chip" data-k="${t.key}">${esc(t.name)}</button>`).join('');
    $('#shTplBtn', body).onclick = () => { tpls.hidden = !tpls.hidden; };
    $$('.chip', tpls).forEach(b => b.onclick = () => {
      const t = C.TEMPLATES.find(x => x.key === b.dataset.k);
      const who = C.shotCast(sh, cast)[0];
      if (pr.value.trim() && !confirm('Replace the current text with this template?')) return;
      pr.value = C.fillTemplate(t, { character: who ? who.name : undefined }); sh.prompt = pr.value; sh.camera = t.camera;
      saveProject(); paintCam(); refresh(); repaintCard(sh); tpls.hidden = true; pr.focus();
    });
    const camEl = $('#shCam', body);
    const paintCam = () => {
      camEl.innerHTML = C.CAMERA_MOVES.map(c => `<button type="button" class="chip" data-k="${c.key}" aria-pressed="${sh.camera === c.key}">${esc(c.name)}</button>`).join('');
      $$('.chip', camEl).forEach(b => b.onclick = () => { haptic(); sh.camera = b.dataset.k; saveProject(); paintCam(); refresh(); repaintCard(sh); });
    };
    paintCam();
    const castEl = $('#shCast', body);
    const paintCast = () => {
      if (!cast.length) { castEl.innerHTML = `<button type="button" class="chip" data-a="go">${icon('plus')}Add characters in Cast</button>`; $('[data-a=go]', castEl).onclick = () => { closeSheet(); show('cast'); }; return; }
      castEl.innerHTML = cast.map(c => `<button type="button" class="chip" data-id="${c.id}" aria-pressed="${(sh.castIds || []).includes(c.id)}">${c.imageId && imgUrl(c.imageId) ? `<img src="${imgUrl(c.imageId)}" alt="">` : ''}${esc(c.name)}</button>`).join('');
      $$('.chip', castEl).forEach(b => b.onclick = () => {
        haptic(); const set = new Set(sh.castIds || []); const cid = b.dataset.id;
        if (set.has(cid)) set.delete(cid);
        else { set.add(cid); const c = cast.find(x => x.id === cid); if (!sh.imageId && c && c.imageId && images.has(c.imageId)) { sh.imageId = c.imageId; paintFrames(); } }
        sh.castIds = [...set]; saveProject(); paintCast(); refresh(); repaintCard(sh);
      });
    };
    const fr = $('#shFrames', body);
    const paintFrames = () => {
      const opts = [{ id: null, label: 'None' }];
      cast.filter(c => c.imageId && images.has(c.imageId)).forEach(c => opts.push({ id: c.imageId, label: c.name }));
      [...images.values()].sort((a, b) => b.createdAt - a.createdAt).forEach(im => { if (!opts.some(o => o.id === im.id)) opts.push({ id: im.id, label: im.name || 'Image' }); });
      fr.innerHTML = opts.map(o => `<button type="button" class="frame" data-id="${o.id || ''}" aria-pressed="${(sh.imageId || null) === o.id}" ${o.id ? `style="background-image:url('${imgUrl(o.id)}')"` : ''} aria-label="${esc(o.label)}">${o.id ? `<small>${esc(o.label)}</small>` : 'None'}</button>`).join('')
        + `<label class="frame up" aria-label="Upload a first frame">${icon('upload')}<input type="file" accept="image/*" hidden></label>`;
      $$('.frame[data-id]', fr).forEach(b => b.onclick = () => { haptic(); sh.imageId = b.dataset.id || null; saveProject(); paintFrames(); repaintCard(sh); });
      $('input', fr).onchange = async (e) => { const f = e.target.files[0]; if (!f) return; const im = await addImage(f); sh.imageId = im.id; saveProject(); paintFrames(); repaintCard(sh); };
    };
    paintCast(); paintFrames();
    const durEl = $('#shDur', body);
    const paintDur = () => {
      const m = P().getModel(sh.model);
      durEl.innerHTML = m.durations.map(d => `<button type="button" data-v="${d}" role="radio">${d}s</button>`).join('');
      seg(durEl, P().fitDuration(m, sh.duration), v => { sh.duration = Number(v); saveProject(); refresh(); repaintCard(sh); });
    };
    paintDur();
    fillModelSelect($('#shModel', body), sh.model);
    $('#shModel', body).onchange = (e) => { sh.model = e.target.value; project.model = sh.model; saveProject(); paintDur(); refresh(); repaintCard(sh); };
    $('#shGen', body).onclick = () => { haptic(); if (busy(sh)) stopShot(sh.id); else enqueue(sh.id); refresh(); };
    $('#shMore', body).onclick = (e) => shotMenu(e.currentTarget, sh);
    editor.id = sh.id; editor.refresh = () => { refresh(); paintShotMedia(sh, body); };
    paintShotMedia(sh, body);
    refresh();
  }, () => { editor.id = null; editor.refresh = null; });
}
function repaintCard(sh) {
  const li = $(`#board .shot[data-id="${sh.id}"]`);
  if (li) li.replaceWith(shotCard(sh, project.shots.indexOf(sh)));
  renderStats();
}
async function paintShotMedia(sh, body) {
  const v = $('#shVideo', body), tk = $('#shTakes', body); if (!v) return;
  if (busy(sh)) {
    delete v.dataset.clip;
    v.innerHTML = `<div class="sheet-video shot" style="aspect-ratio:${aspectCss()};max-height:46vh;border:0"><div class="thumb" style="position:absolute;inset:0;aspect-ratio:auto"><div class="gen"><div class="spinner"></div><span>${esc(sh.note || 'Working…')}</span></div></div></div>`;
  } else if (sh.clipId) {
    const c = await db.get('clips', sh.clipId);
    if (c && v.dataset.clip !== c.id) { v.dataset.clip = c.id; v.innerHTML = '<div class="sheet-video"><video controls playsinline preload="metadata"></video></div>'; $('video', v).src = clipSrc(c); const t = await clipThumb(c.id); if (t) $('video', v).poster = t; }
  } else { v.innerHTML = ''; delete v.dataset.clip; }
  const takes = (await db.all('clips')).filter(c => c.shotId === sh.id).sort((a, b) => a.createdAt - b.createdAt);
  if (takes.length > 1) {
    tk.innerHTML = `<span class="lbl">Takes · tap one to use it</span><div class="takes">${takes.map((c, n) => `<button type="button" class="take" data-id="${c.id}" aria-pressed="${c.id === sh.clipId}" aria-label="Take ${n + 1}"><small>Take ${n + 1}</small></button>`).join('')}</div>`;
    $$('.take', tk).forEach(async b => { b.onclick = () => { sh.clipId = b.dataset.id; saveProject(); repaintCard(sh); paintShotMedia(sh, body); }; const t = await clipThumb(b.dataset.id); if (t) b.style.backgroundImage = `url('${t}')`; });
  } else tk.innerHTML = '';
}
function fillModelSelect(sel, value) {
  const ms = P().models;
  const og = (label, list) => `<optgroup label="${label}">` + list.map(m => `<option value="${m.key}">${esc(m.name)}</option>`).join('') + '</optgroup>';
  sel.innerHTML = og('Open source', ms.filter(m => m.open)) + og('Closed (optional)', ms.filter(m => !m.open));
  sel.value = P().getModel(value).key;
}

// ---------- style sheet ----------
$('#styleBtn').addEventListener('click', () => {
  const s = project.style;
  openSheet('Project style', (body) => {
    const group = (gid, label, list, val) => `<span class="lbl">${label}</span><div class="chips wrap" id="${gid}">${list.map(x => `<button type="button" class="chip" data-v="${esc(x)}" aria-pressed="${x === val}">${esc(x)}</button>`).join('')}</div>`;
    body.innerHTML = `
      <p class="hint">One look for the whole film. It is added to every shot's prompt the same way, so the shots match.</p>
      <label class="switch"><input type="checkbox" id="stOn"><i></i><span>Apply style to every shot</span></label>
      ${group('stLook', 'Look', C.LOOKS, s.look)}
      ${group('stLight', 'Lighting', C.LIGHTING, s.lighting)}
      ${group('stLens', 'Camera & lens', C.LENSES, s.lens)}
      <span class="lbl">Extra style words</span>
      <input type="text" id="stExtra" maxlength="160" placeholder="e.g. teal and orange grade, warm skin tones">
      <span class="lbl">Aspect ratio</span>
      <div class="seg" id="stAspect" role="radiogroup" aria-label="Aspect ratio"><button type="button" data-v="16:9" role="radio">16:9 wide</button><button type="button" data-v="9:16" role="radio">9:16 vertical</button><button type="button" data-v="1:1" role="radio">1:1 square</button></div>
      <span class="lbl">Preview on shot 1</span><div class="composed" id="stPrev"></div>`;
    const prev = () => { const sh = project.shots[0]; $('#stPrev', body).textContent = sh ? (C.composePrompt(sh, s, cast) || '(shot 1 has no text yet)') : '(no shots yet)'; renderStyleSummary(); };
    const on = $('#stOn', body); on.checked = s.applyToAll !== false; on.onchange = () => { s.applyToAll = on.checked; saveProject(); prev(); };
    const bind = (gid, field) => $$(`#${gid} .chip`, body).forEach(b => b.onclick = () => { haptic(); s[field] = s[field] === b.dataset.v ? '' : b.dataset.v; saveProject(); $$(`#${gid} .chip`, body).forEach(x => x.setAttribute('aria-pressed', String(x.dataset.v === s[field]))); prev(); });
    bind('stLook', 'look'); bind('stLight', 'lighting'); bind('stLens', 'lens');
    const ex = $('#stExtra', body); ex.value = s.extra || ''; ex.oninput = () => { s.extra = ex.value; saveProject(); prev(); };
    seg($('#stAspect', body), project.aspect, v => { project.aspect = v; saveProject(); });
    prev();
  }, () => renderBoard());
});

// ---------- images ----------
async function addImage(file, name) {
  const blob = await shrinkImage(file, 1600);
  const im = { id: C.uid(), blob, name: (name || file.name || 'image').replace(/\.[^.]+$/, '').slice(0, 40), createdAt: Date.now(), falUrl: null, falUrlAt: 0 };
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

// ---------- clips ----------
function clipSrc(c) { return c.blob ? objUrl(c.id, c.blob) : c.sourceUrl; }
async function clipThumb(clipId) {
  if (thumbs.has(clipId)) return thumbs.get(clipId);
  const c = await db.get('clips', clipId); if (!c) return '';
  if (c.thumb) { thumbs.set(clipId, c.thumb); return c.thumb; }
  const t = await grabFrame(clipSrc(c)).catch(() => '');
  if (t) { thumbs.set(clipId, t); c.thumb = t; db.put('clips', c).catch(() => {}); }
  return t;
}
function grabFrame(src) {
  return new Promise((resolve) => {
    if (!src) return resolve('');
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto';
    if (!src.startsWith('blob:')) v.crossOrigin = 'anonymous';
    let to = 0;
    const done = (x) => { clearTimeout(to); v.onseeked = v.onerror = v.onloadeddata = null; v.removeAttribute('src'); try { v.load(); } catch (e) {} resolve(x); };
    to = setTimeout(() => done(''), 8000);
    v.onloadeddata = () => { try { v.currentTime = Math.min(0.6, (v.duration || 1) / 3); } catch (e) { done(''); } };
    v.onseeked = () => {
      try {
        const w = 480, h = Math.round(w * (v.videoHeight / v.videoWidth || 9 / 16));
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.getContext('2d').drawImage(v, 0, 0, w, h);
        done(cv.toDataURL('image/jpeg', 0.72));
      } catch (e) { done(''); }
    };
    v.onerror = () => done('');
    v.src = src;
  });
}
function clipName(c) {
  const t = (projects.find(s => s.id === c.storyId) || {}).title || 'clip';
  return `${t.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'clip'}-shot${(c.order ?? 0) + 1}-${c.id}.mp4`;
}
async function ensureBlob(c) {
  if (c.blob) return c.blob;
  const r = await fetch(c.sourceUrl); if (!r.ok) throw new Error('The clip link has expired (' + r.status + ').');
  c.blob = await r.blob(); await db.put('clips', c); return c.blob;
}
function saveBlob(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
const canShare = () => !!(navigator.canShare && navigator.share);
async function shareBlob(blob, name) {
  const f = new File([blob], name, { type: 'video/mp4' });
  if (navigator.canShare && navigator.canShare({ files: [f] })) { try { await navigator.share({ files: [f], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  saveBlob(blob, name);
}
async function downloadClip(c) { try { saveBlob(await ensureBlob(c), clipName(c)); } catch (e) { toast(e.message, 'bad'); } }
async function playClipOf(sh) { const c = await db.get('clips', sh.clipId); if (c) playList([{ src: clipSrc(c), label: 'Shot ' + (project.shots.indexOf(sh) + 1) }], project.title); }

// ---------- generation queue (same flow as v1; the prompt is composed with style + cast) ----------
const queue = []; const active = new Set(); const stopped = new Set();
function findShot(id) { for (const s of projects) { const sh = s.shots.find(x => x.id === id); if (sh) return [s, sh]; } return [null, null]; }
function update(s, sh, patch) {
  Object.assign(sh, patch); persist(s);
  if (s === project) {
    if (view === 'board') { paintShot(sh); renderStats(); }
    if (editor.id === sh.id && editor.refresh) editor.refresh();
  }
}
function enqueue(id) {
  const [s, sh] = findShot(id); if (!sh) return;
  if (!key()) { closeSheet(); show('settings'); const k = $('#keyStatus'); k.textContent = 'Paste your fal.ai key first.'; k.className = 'status bad'; return; }
  if (!sh.prompt.trim()) { update(s, sh, { status: 'failed', error: 'Write what happens in this shot first.' }); return; }
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
  const [s, sh] = findShot(id); if (!sh) return;
  const prov = P();
  try {
    if (!sh.job) {
      const m = prov.getModel(sh.model);
      let imageUrl = null;
      if (sh.imageId && images.has(sh.imageId)) { update(s, sh, { status: 'uploading', note: 'Uploading first frame…' }); imageUrl = await imageUrlFor(sh.imageId); }
      if (stopped.has(id)) return;
      const prompt = C.composePrompt(sh, s.style, cast);
      const { endpoint, input, duration } = prov.buildInput(m, { ...sh, prompt }, { imageUrl, aspect: s.aspect, resolution: resFor(m), audio: S.audio && m.audio });
      update(s, sh, { status: 'queued', note: 'Sending to ' + m.name + '…' });
      const job = await prov.submit(endpoint, input, key());
      const res = input.resolution || m.defaultRes;
      const est = prov.estimateCost(m, duration, res, !!input.generate_audio);
      update(s, sh, { job: { ...job, endpoint, model: m.key, duration, res, at: Date.now(), prompt, est }, note: 'In line at fal…' });
    }
    await followJob(s, sh);
  } catch (e) {
    if (!stopped.has(id)) { update(s, sh, { status: 'failed', error: friendly(e), note: '', job: null }); toast('A shot failed: ' + friendly(e).slice(0, 80), 'bad'); }
  }
}
function friendly(e) {
  const m = String(e && e.message || e);
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Network problem reaching fal.ai. Check your connection and try again.';
  return m;
}
async function followJob(s, sh) {
  const prov = P(); const id = sh.id; const t0 = sh.job.at || Date.now();
  let delay = 2500, errs = 0;
  for (;;) {
    if (stopped.has(id)) return;
    await sleep(delay);
    if (stopped.has(id) || !sh.job) return;
    let st;
    try { st = await prov.poll(sh.job, key()); errs = 0; }
    catch (e) { if (++errs > 6) throw e; delay = Math.min(15000, delay * 1.5); continue; }
    const secs = Math.round((Date.now() - t0) / 1000);
    if (st.state === 'queued') update(s, sh, { status: 'queued', note: `In line at fal${st.position != null ? ' · #' + (st.position + 1) : ''} · ${secs}s` });
    else if (st.state === 'running') update(s, sh, { status: 'running', note: `Rendering · ${secs}s` });
    else if (st.state === 'failed') throw new Error(st.error || 'fal.ai reported a failure.');
    else if (st.state === 'done') break;
    delay = Math.min(6000, delay + 500);
  }
  update(s, sh, { status: 'saving', note: 'Saving clip to this device…' });
  const res = await prov.result(sh.job, key());
  let blob = null;
  try { const r = await fetch(res.videoUrl); if (r.ok) blob = await r.blob(); } catch (e) {}
  const m = prov.getModel(sh.job.model);
  const cost = Number(sh.job.est) || 0;
  const clip = {
    id: C.uid(), storyId: s.id, shotId: sh.id, order: s.shots.indexOf(sh), prompt: sh.prompt, sentPrompt: sh.job.prompt || sh.prompt, model: m.key, modelName: m.name,
    endpoint: sh.job.endpoint, duration: sh.job.duration, res: sh.job.res, aspect: s.aspect, imageId: sh.imageId, camera: sh.camera,
    sourceUrl: res.videoUrl, blob, contentType: res.contentType, seed: res.seed, createdAt: Date.now(), provider: prov.id, cost,
  };
  await db.put('clips', clip);
  if (cost) addSpent(cost);
  update(s, sh, { status: 'done', clipId: clip.id, job: null, note: blob ? 'Saved on this device.' : 'Done. Download it to keep it.' });
  if (s === project && view === 'board') { renderTimeline(); paintCover(); }
  toast(`Shot ${s.shots.indexOf(sh) + 1} is ready`);
}
$('#genAll').addEventListener('click', () => { haptic(); project.shots.filter(sh => !sh.clipId && !busy(sh) && sh.prompt.trim()).forEach(sh => enqueue(sh.id)); });
function resumeJobs() {
  for (const s of projects) for (const sh of s.shots) {
    if (sh.job && sh.job.statusUrl) { sh.status = 'queued'; sh.note = 'Checking on this shot…'; active.add(sh.id); runShot(sh.id).finally(() => { active.delete(sh.id); pump(); }); }
    else if (busy(sh)) { sh.status = sh.clipId ? 'done' : 'idle'; sh.note = ''; }
  }
}

// ---------- finishing ----------
function renderFinish() {
  const f = project.finish;
  const bindSw = (sel, field, after) => { const el = $(sel); el.checked = !!f[field]; el.onchange = () => { haptic(); f[field] = el.checked; saveProject(); renderStats(); if (after) after(); }; };
  bindSw('#fTitleOn', 'titleOn', paintCardPreviews); bindSw('#fEndOn', 'endOn', paintCardPreviews); bindSw('#fFade', 'crossfade');
  let tmr = 0;
  const bindTx = (sel, field) => { const el = $(sel); el.value = f[field] || ''; el.oninput = () => { f[field] = el.value; saveProject(); clearTimeout(tmr); tmr = setTimeout(paintCardPreviews, 250); }; };
  bindTx('#fTitle', 'title'); bindTx('#fSubtitle', 'subtitle'); bindTx('#fEnd', 'endText');
  $('#fTitle').placeholder = project.title || 'Film title';
  seg($('#fadeSeg'), String(f.fadeSeconds), v => { f.fadeSeconds = Number(v); saveProject(); renderTimeline(); });
  seg($('#resSeg'), f.exportRes, v => { f.exportRes = v; saveProject(); });
  const vol = $('#fVol'); vol.value = f.musicVolume; vol.oninput = () => { f.musicVolume = Number(vol.value); saveProject(); };
  paintMusic(); paintCardPreviews();
}
let musicAudio = null;
async function paintMusic() {
  const f = project.finish; const box = $('#musicBox');
  const m = f.musicId ? await db.get('media', f.musicId).catch(() => null) : null;
  if (musicAudio) { musicAudio.pause(); musicAudio = null; }
  if (m) {
    box.innerHTML = `<span class="name">${esc(m.name)}</span><button class="btn sm ghost" type="button" data-a="play" aria-label="Preview music">${icon('play')}</button><button class="btn sm ghost" type="button" data-a="rm" aria-label="Remove music">${icon('x')}</button>`;
    $('[data-a=play]', box).onclick = () => { if (musicAudio && !musicAudio.paused) { musicAudio.pause(); return; } musicAudio = musicAudio || new Audio(objUrl('media:' + m.id, m.blob)); musicAudio.volume = f.musicVolume; musicAudio.play().catch(() => {}); };
    $('[data-a=rm]', box).onclick = async () => { f.musicId = null; saveProject(); await db.del('media', m.id).catch(() => {}); paintMusic(); };
  } else {
    box.innerHTML = `<label class="btn sm file">${icon('upload')}<span>Add a song</span><input type="file" accept="audio/*,.mp3,.m4a,.wav,.aac" hidden></label><span class="hint">mp3, m4a or wav · plays under the clips</span>`;
    $('input', box).onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return;
      if (file.size > 40e6) { toast('That song is over 40 MB. Pick a smaller file.', 'bad'); return; }
      const rec = { id: C.uid(), name: file.name.slice(0, 60), blob: file, type: file.type, createdAt: Date.now() };
      await db.put('media', rec); f.musicId = rec.id; saveProject(); paintMusic(); toast('Music added');
    };
  }
}
function titleText() { return (project.finish.title || project.title || 'Untitled').trim(); }
// Title / end cards are drawn on a canvas (crisp type, no font files needed inside ffmpeg).
function drawCard(kind, w, h) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  const bg = g.createRadialGradient(w * 0.5, h * 0.42, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.75);
  bg.addColorStop(0, '#1d1a24'); bg.addColorStop(1, '#050507');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  const s = Math.min(w, h);
  const font = '-apple-system, "SF Pro Display", "Helvetica Neue", Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const spacing = (px) => { if ('letterSpacing' in g) g.letterSpacing = px + 'px'; };
  const fit = (text, weight, size, maxW, sp) => { let sz = size; for (;;) { g.font = `${weight} ${sz}px ${font}`; spacing(Math.round(sz * sp)); if (g.measureText(text).width <= maxW || sz <= 10) return sz; sz -= 2; } };
  const sub = (project.finish.subtitle || '').trim();
  if (kind === 'title') {
    const t = titleText().toUpperCase();
    const sz = fit(t, 800, Math.round(s * 0.12), w * 0.84, 0.08);
    g.fillStyle = '#f4f1ea'; g.fillText(t, w / 2, h / 2 - (sub ? sz * 0.35 : 0));
    const lg = g.createLinearGradient(w / 2 - s * 0.05, 0, w / 2 + s * 0.05, 0); lg.addColorStop(0, '#ffd58a'); lg.addColorStop(1, '#ff6a6a');
    g.fillStyle = lg; g.fillRect(w / 2 - s * 0.05, h / 2 + sz * (sub ? 0.3 : 0.75), s * 0.1, Math.max(2, s * 0.005));
    if (sub) {
      const s2 = fit(sub.toUpperCase(), 500, Math.round(s * 0.04), w * 0.8, 0.2);
      g.fillStyle = '#b9b6ae'; g.fillText(sub.toUpperCase(), w / 2, h / 2 + sz * 0.95);
      void s2;
    }
  } else {
    const t = (project.finish.endText || 'The End').trim();
    fit(t, 300, Math.round(s * 0.09), w * 0.84, 0.06);
    g.fillStyle = '#f4f1ea'; g.fillText(t, w / 2, h / 2);
  }
  return cv;
}
function paintCardPreviews() {
  const box = $('#cardPreviews'); box.innerHTML = '';
  const [w, h] = project.aspect === '9:16' ? [270, 480] : project.aspect === '1:1' ? [400, 400] : [480, 270];
  if (project.finish.titleOn) { const i = new Image(); i.alt = 'Title card preview'; i.src = drawCard('title', w, h).toDataURL('image/jpeg', 0.85); box.appendChild(i); }
  if (project.finish.endOn) { const i = new Image(); i.alt = 'End card preview'; i.src = drawCard('end', w, h).toDataURL('image/jpeg', 0.85); box.appendChild(i); }
}
const canvasBlob = (cv) => new Promise(r => cv.toBlob(r, 'image/png'));
async function projectClips() {
  const out = [];
  for (const sh of project.shots) { if (!sh.clipId) continue; const c = await db.get('clips', sh.clipId); if (c) out.push(c); }
  return out;
}
$('#stitchBtn').addEventListener('click', async () => {
  haptic();
  const st = $('#stitchStatus'); const bar = $('#stitchProg'); const f = project.finish;
  const missing = project.shots.filter(sh => !sh.clipId).length;
  const clips = await projectClips();
  if (!clips.length) { st.className = 'status bad'; st.textContent = 'Generate at least one shot first.'; return; }
  if (missing && !confirm(`${missing} shot(s) have no clip yet. Render the ${clips.length} that do?`)) return;
  $('#stitchBtn').disabled = true; st.className = 'status'; bar.hidden = false; $('i', bar).style.width = '2%';
  const onStatus = (t) => { st.textContent = t; const m = /(\d+)%/.exec(t); if (m) $('i', bar).style.width = Math.max(2, Math.min(100, +m[1])) + '%'; };
  try {
    onStatus('Getting clips ready…');
    for (const c of clips) await ensureBlob(c);
    const [w, h] = outputSize(project.aspect, f.exportRes);
    const pieces = [];
    if (f.titleOn) pieces.push({ kind: 'card', blob: await canvasBlob(drawCard('title', w, h)), seconds: C.CARD_SECONDS });
    clips.forEach(c => pieces.push({ kind: 'clip', blob: c.blob }));
    if (f.endOn) pieces.push({ kind: 'card', blob: await canvasBlob(drawCard('end', w, h)), seconds: C.CARD_SECONDS });
    const mrec = f.musicId ? await db.get('media', f.musicId).catch(() => null) : null;
    const music = mrec ? mrec.blob : null;
    const same = clips.every(c => c.model === clips[0].model && c.res === clips[0].res && c.aspect === clips[0].aspect) && String(clips[0].res || '').startsWith(f.exportRes);
    const out = await stitch(pieces, { aspect: project.aspect, res: f.exportRes, crossfade: f.crossfade && pieces.length > 1, fadeSeconds: f.fadeSeconds, music, musicVolume: f.musicVolume, fast: same, onStatus });
    const secs = out.seconds || clips.reduce((a, c) => a + (c.duration || 0), 0);
    const fin = { id: C.uid(), storyId: project.id, title: project.title, blob: out.blob, shots: clips.length, seconds: Math.round(secs), createdAt: Date.now(), res: f.exportRes, crossfade: out.crossfaded, music: !!music };
    await db.put('finals', fin);
    $('i', bar).style.width = '100%';
    st.className = 'status ok';
    st.textContent = `Done: ${clips.length} shot${clips.length === 1 ? '' : 's'}, ${C.fmtTime(secs)}, ${f.exportRes}p${out.crossfaded ? ', crossfades' : ''}${music ? ', music' : ''}.` + (out.notes.length ? ' ' + out.notes.join(' ') : '');
    renderFinalOut(fin); toast('Your movie is ready');
  } catch (e) {
    console.warn(e);
    st.className = 'status bad';
    st.textContent = 'This browser could not finish the movie (' + String(e.message || e).slice(0, 140) + '). Try Play all, turn off crossfade or 1080p, or use a computer.';
  } finally { $('#stitchBtn').disabled = false; setTimeout(() => { bar.hidden = true; }, 1200); }
});
async function renderFinalOut(fin) {
  const box = $('#finalOut');
  if (!fin) { const all = (await db.all('finals')).filter(f => f.storyId === project.id).sort((a, b) => b.createdAt - a.createdAt); fin = all[0]; }
  box.innerHTML = '';
  if (fin) box.appendChild(finalView(fin));
}
function finalName(f) { return `${(f.title || 'movie').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'movie'}-${new Date(f.createdAt).toISOString().slice(0, 10)}.mp4`; }
function finalView(f) {
  const w = document.createElement('div'); w.className = 'final';
  w.innerHTML = `<video controls playsinline preload="metadata"></video><div class="acts"><button class="btn primary sm dl" type="button">${icon('download')}Download</button>${canShare() ? `<button class="btn ghost sm sh" type="button">${icon('share')}Save / Share</button>` : ''}<small>${f.shots} shots · ${C.fmtTime(f.seconds)}${f.res ? ' · ' + f.res + 'p' : ''} · ${new Date(f.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</small></div>`;
  $('video', w).src = objUrl(f.id, f.blob);
  $('.dl', w).onclick = () => saveBlob(f.blob, finalName(f));
  const sb = $('.sh', w); if (sb) sb.onclick = () => shareBlob(f.blob, finalName(f));
  return w;
}
$('#playAllBtn').addEventListener('click', async () => {
  const clips = await projectClips();
  if (!clips.length) { const st = $('#stitchStatus'); st.className = 'status bad'; st.textContent = 'No clips yet.'; return; }
  playList(clips.map(c => ({ src: clipSrc(c), label: `Shot ${project.shots.findIndex(s => s.id === c.shotId) + 1}` })), project.title);
});
function playList(items, title) {
  const pl = $('#player'), v = $('#playerVideo'), strip = $('#playerStrip');
  $('#playerTitle').textContent = title || 'Play all';
  let i = 0;
  const go = (n) => { i = n; v.src = items[i].src; v.play().catch(() => {}); $$('button', strip).forEach((b, k) => b.classList.toggle('on', k === i)); };
  strip.innerHTML = items.map(it => `<button type="button">${esc(it.label)}</button>`).join('');
  $$('button', strip).forEach((b, k) => b.onclick = () => go(k));
  v.onended = () => { if (i < items.length - 1) go(i + 1); };
  pl.hidden = false; document.body.style.overflow = 'hidden'; go(0);
}
function closePlayer() { const v = $('#playerVideo'); v.pause(); v.removeAttribute('src'); try { v.load(); } catch (e) {} $('#player').hidden = true; document.body.style.overflow = ''; }
$('#playerClose').addEventListener('click', closePlayer);

// ---------- cast ----------
function renderCast() {
  const g = $('#castGrid');
  if (!cast.length) {
    g.innerHTML = `<div class="empty-state"><div class="ico">${icon('users')}</div><b>No characters yet</b><p>Add your main character with a clear reference picture (a character sheet works great).</p><button class="btn primary" type="button" data-a="add">${icon('plus')}Add character</button></div>`;
    $('[data-a=add]', g).onclick = () => editCast(null); return;
  }
  g.innerHTML = '';
  cast.forEach(c => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'ccard';
    const u = c.imageId ? imgUrl(c.imageId) : '';
    const uses = projects.reduce((a, p) => a + p.shots.filter(s => (s.castIds || []).includes(c.id)).length, 0);
    b.innerHTML = `<div class="face" ${u ? `style="background-image:url('${u}')"` : ''}>${u ? '' : esc((c.name || '?')[0].toUpperCase())}</div><div class="info"><b>${esc(c.name)}</b><small>${esc(c.description || 'No description yet')}${uses ? ` · in ${uses} shot${uses === 1 ? '' : 's'}` : ''}</small></div>`;
    b.onclick = () => editCast(c);
    g.appendChild(b);
  });
}
$('#addCast').addEventListener('click', () => editCast(null));
function editCast(c) {
  const isNew = !c;
  const draft = c ? { ...c } : { id: C.uid(), name: '', description: '', imageId: null, createdAt: Date.now() };
  openSheet(isNew ? 'New character' : draft.name, (body) => {
    body.innerHTML = `
      <div class="face-pick"><label class="frame up" id="cfFace" aria-label="Reference picture">${icon('upload')}<input type="file" accept="image/*" hidden></label><p class="hint">Reference picture: clear and well lit. It can be the first frame of any shot with this character.</p></div>
      <span class="lbl">Name</span><input type="text" id="cfName" maxlength="40" placeholder="e.g. Jay">
      <span class="lbl">Look (added to every prompt with this character)</span>
      <textarea id="cfDesc" rows="3" maxlength="300" placeholder="e.g. a man in his 30s with a short fade, black hoodie, layered gold chains"></textarea>
      <div class="sheet-actions">
        <button class="btn primary lg" type="button" id="cfSave">${icon('check')}${isNew ? 'Add to cast' : 'Save'}</button>
        ${isNew ? '' : `<button class="btn ghost lg danger" type="button" id="cfDel">${icon('trash')}Remove</button>`}
      </div>`;
    const face = $('#cfFace', body);
    const paintFace = () => { const u = draft.imageId ? imgUrl(draft.imageId) : ''; face.style.backgroundImage = u ? `url('${u}')` : ''; face.firstElementChild.style.opacity = u ? 0 : 1; };
    paintFace();
    $('input', face).onchange = async (e) => { const f = e.target.files[0]; if (!f) return; const im = await addImage(f, $('#cfName', body).value || 'cast'); draft.imageId = im.id; paintFace(); };
    $('#cfName', body).value = draft.name; $('#cfDesc', body).value = draft.description;
    $('#cfSave', body).onclick = async () => {
      draft.name = $('#cfName', body).value.trim().slice(0, 40); draft.description = $('#cfDesc', body).value.trim();
      if (!draft.name) { $('#cfName', body).focus(); toast('Give the character a name', 'bad'); return; }
      await db.put('cast', draft);
      const i = cast.findIndex(x => x.id === draft.id); if (i >= 0) cast[i] = draft; else cast.push(draft);
      haptic(); closeSheet(); renderCast(); toast(isNew ? `${draft.name} joined the cast` : 'Saved');
    };
    const del = $('#cfDel', body);
    if (del) del.onclick = async () => {
      if (!confirm(`Remove ${draft.name} from the cast? Shots keep their text.`)) return;
      await db.del('cast', draft.id); cast = cast.filter(x => x.id !== draft.id);
      projects.forEach(p => { let ch = false; p.shots.forEach(s => { if ((s.castIds || []).includes(draft.id)) { s.castIds = s.castIds.filter(x => x !== draft.id); ch = true; } }); if (ch) persist(p); });
      closeSheet(); renderCast();
    };
  });
}

// ---------- gallery ----------
async function renderGallery() {
  const fl = $('#finalsList'), grid = $('#clipGrid');
  fl.innerHTML = '<div class="skel" style="height:200px"></div>';
  grid.innerHTML = '<div class="skel" style="height:180px"></div><div class="skel" style="height:180px"></div>';
  const clips = (await db.all('clips')).sort((a, b) => b.createdAt - a.createdAt);
  const finals = (await db.all('finals')).sort((a, b) => b.createdAt - a.createdAt);
  const f = $('#galleryFilter'); const prev = f.value || 'all';
  f.innerHTML = '<option value="all">All projects</option>' + projects.map(s => `<option value="${s.id}">${esc(s.title || 'Untitled')}</option>`).join('');
  f.value = [...f.options].some(o => o.value === prev) ? prev : 'all';
  f.onchange = renderGallery;
  const list = clips.filter(c => f.value === 'all' || c.storyId === f.value);
  fl.innerHTML = finals.length ? '' : `<div class="empty-state"><div class="ico">${icon('film')}</div><b>No movies yet</b><p>Render a project in Final cut and it lands here.</p></div>`;
  for (const m of finals) {
    const t = finalView(m);
    const rm = document.createElement('button'); rm.className = 'btn ghost sm danger'; rm.type = 'button'; rm.innerHTML = icon('trash') + 'Delete';
    rm.onclick = async () => { if (confirm('Delete this movie from this device?')) { await db.del('finals', m.id); renderGallery(); } };
    $('.acts', t).insertBefore(rm, $('.acts small', t));
    const head = document.createElement('div'); head.className = 'meta'; head.style.cssText = 'padding:10px 12px;background:var(--bg2)'; head.innerHTML = `<b>${esc(m.title || 'Untitled')}</b>`;
    t.prepend(head); fl.appendChild(t);
  }
  grid.innerHTML = list.length ? '' : `<div class="empty-state"><div class="ico">${icon('video')}</div><b>No clips yet</b><p>Generate a shot and every take shows up here.</p></div>`;
  for (const c of list) {
    const st = projects.find(s => s.id === c.storyId);
    const t = document.createElement('div'); t.className = 'tile';
    t.innerHTML = `<video playsinline controls preload="none"></video><div class="meta"><b>${esc(st ? st.title : 'Deleted project')}</b> · shot ${(c.order ?? 0) + 1} · ${esc(c.modelName)} · ${c.duration}s${c.cost ? ' · ≈' + C.money(c.cost) : ''}</div><div class="acts"><button class="btn ghost sm dl" type="button">${icon('download')}Download</button><button class="btn ghost sm rm danger" type="button" aria-label="Delete clip">${icon('trash')}</button></div>`;
    const v = $('video', t); v.src = clipSrc(c);
    clipThumb(c.id).then(th => { if (th) v.poster = th; });
    $('.dl', t).onclick = () => downloadClip(c);
    $('.rm', t).onclick = async () => {
      if (!confirm('Delete this clip from this device?')) return;
      await db.del('clips', c.id); thumbs.delete(c.id);
      projects.forEach(s => s.shots.forEach(sh => { if (sh.clipId === c.id) { sh.clipId = null; sh.status = 'idle'; persist(s); } }));
      renderGallery();
    };
    grid.appendChild(t);
  }
  renderImages(); storageNote();
}
function renderImages() {
  const g = $('#imgGrid');
  const all = [...images.values()].sort((a, b) => b.createdAt - a.createdAt);
  g.innerHTML = all.length ? '' : '<p class="hint" style="grid-column:1/-1">Character sheets and reference frames you upload show up here.</p>';
  for (const im of all) {
    const d = document.createElement('div'); d.className = 'imgt';
    d.innerHTML = `<img alt="${esc(im.name)}" loading="lazy"><button type="button" aria-label="Delete image">${icon('x')}</button>`;
    $('img', d).src = imgUrl(im.id);
    $('button', d).onclick = async () => {
      if (!confirm('Delete this image? Shots using it as a first frame will have none.')) return;
      await db.del('images', im.id); images.delete(im.id);
      projects.forEach(s => s.shots.forEach(sh => { if (sh.imageId === im.id) { sh.imageId = null; persist(s); } }));
      renderImages();
    };
    g.appendChild(d);
  }
}
$('#libUpload').addEventListener('change', async e => { for (const f of e.target.files) await addImage(f); e.target.value = ''; renderImages(); toast('Added'); });
async function storageNote() {
  const e = await storageEstimate();
  const t = e ? `Using ${(e.usage / 1e6).toFixed(0)} MB of about ${(e.quota / 1e6).toFixed(0)} MB available in this browser.` : '';
  $('#storageNote').textContent = t; $('#storageInfo').textContent = t;
}

// ---------- settings ----------
function renderSettings() {
  $('#falKey').value = key();
  seg($('#qualitySeg'), S.quality, v => { S.quality = v; saveSettings(); });
  $('#audioToggle').checked = !!S.audio;
  $('#concurrency').value = String(S.concurrency || 3);
  paintSpent(); storageNote();
}
$('#toggleKey').addEventListener('click', () => { const k = $('#falKey'); const showIt = k.type === 'password'; k.type = showIt ? 'text' : 'password'; $('#toggleKey').textContent = showIt ? 'Hide' : 'Show'; });
$('#saveKey').addEventListener('click', () => {
  const v = $('#falKey').value.trim(); const st = $('#keyStatus');
  if (!v) { st.className = 'status bad'; st.textContent = 'Paste a key first.'; return; }
  S.keys[S.provider] = v; saveSettings(); keyBanner();
  st.className = 'status ok'; st.textContent = 'Saved in this browser.'; toast('Key saved');
});
$('#clearKey').addEventListener('click', () => { delete S.keys[S.provider]; saveSettings(); $('#falKey').value = ''; keyBanner(); $('#keyStatus').className = 'status'; $('#keyStatus').textContent = 'Removed.'; });
$('#audioToggle').addEventListener('change', e => { S.audio = e.target.checked; saveSettings(); });
$('#concurrency').addEventListener('change', e => { S.concurrency = Number(e.target.value); saveSettings(); });

// ---------- start ----------
let started = false;
async function start() {
  if (started) return; started = true;
  $('#gate').hidden = true; $('#app').hidden = false;
  try { await loadAll(); }
  catch (e) { console.warn(e); toast('This browser blocked storage (private mode?). Projects will not be saved.', 'bad'); projects = [C.newProject(1, P().defaultModel)]; project = projects[0]; }
  persistStorage();
  keyBanner(); paintSpent();
  resumeJobs();
  const hash = (location.hash || '').slice(1);
  show(['projects', 'board', 'cast', 'gallery', 'settings'].includes(hash) ? hash : 'board');
}
window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (started && ['projects', 'board', 'cast', 'gallery', 'settings'].includes(h)) show(h); });
window.addEventListener('pagehide', () => saveProject(true));
if (localStorage.getItem(LS.unlock) === PW_HASH) start();
else setTimeout(() => $('#pw').focus(), 300);
