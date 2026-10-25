// Pure logic for Scene Studio v2: style, camera, cast, prompt helper, runtime, cost, projects.
// No DOM in here, so every function is unit-tested in Node.

export const ASPECTS = ['16:9', '9:16', '1:1'];

export const CAMERA_MOVES = [
  { key: 'static', name: 'Static', phrase: 'locked-off static camera' },
  { key: 'dolly-in', name: 'Dolly in', phrase: 'slow dolly in toward the subject' },
  { key: 'dolly-out', name: 'Dolly out', phrase: 'slow dolly out revealing the surroundings' },
  { key: 'pan-left', name: 'Pan left', phrase: 'smooth pan from right to left' },
  { key: 'pan-right', name: 'Pan right', phrase: 'smooth pan from left to right' },
  { key: 'orbit', name: 'Orbit', phrase: 'camera orbits around the subject' },
  { key: 'handheld', name: 'Handheld', phrase: 'handheld camera with subtle natural shake' },
  { key: 'tracking', name: 'Tracking', phrase: 'tracking shot following the subject' },
  { key: 'crane-up', name: 'Crane up', phrase: 'crane shot rising upward' },
  { key: 'push-zoom', name: 'Slow zoom', phrase: 'slow push-in zoom' },
];
export const cameraMove = (k) => CAMERA_MOVES.find(c => c.key === k) || null;

export const LOOKS = ['Cinematic film', 'Anamorphic blockbuster', 'Luxury commercial', 'Music video', 'Documentary', 'Film noir', 'Vintage 16mm', 'Anime', 'Dreamy pastel'];
export const LIGHTING = ['Golden hour', 'Neon night', 'Soft studio light', 'Moody low-key', 'Overcast natural', 'Candlelight', 'High-key bright', 'Blue hour'];
export const LENSES = ['35mm lens', '50mm shallow depth of field', '24mm wide angle', '85mm portrait', 'Telephoto compression', 'Macro detail'];

export function defaultStyle() {
  return { look: 'Cinematic film', lighting: 'Golden hour', lens: '35mm lens', extra: '', applyToAll: true };
}

export const TEMPLATES = [
  { key: 'establishing', name: 'Establishing shot', camera: 'crane-up', prompt: 'Wide establishing shot of [place], early morning, the world waking up' },
  { key: 'hero-walk', name: 'Hero walk-in', camera: 'tracking', prompt: '[character] walks confidently toward camera through [place]' },
  { key: 'close-up', name: 'Close-up reaction', camera: 'dolly-in', prompt: 'Close-up of [character]\'s face as they react with quiet surprise' },
  { key: 'ots', name: 'Over the shoulder', camera: 'static', prompt: 'Over-the-shoulder shot of [character] talking to someone across a table' },
  { key: 'product', name: 'Product reveal', camera: 'orbit', prompt: 'Macro shot of [product] on black velvet, light glinting off the metal as it slowly turns' },
  { key: 'drone', name: 'Drone reveal', camera: 'dolly-out', prompt: 'Aerial drone shot rising over [place], revealing the skyline' },
  { key: 'chase', name: 'Chase', camera: 'handheld', prompt: '[character] runs through a crowded street, glancing back over their shoulder' },
  { key: 'slowmo', name: 'Slow-motion detail', camera: 'static', prompt: 'Slow motion detail of [subject], particles drifting in the light' },
  { key: 'night-city', name: 'Night city', camera: 'pan-right', prompt: 'Rain-soaked city street at night, reflections of signs on wet asphalt' },
  { key: 'ending', name: 'Final shot', camera: 'dolly-out', prompt: '[character] stands still as the camera pulls away, the scene fading into the distance' },
];

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const stripEnd = (s) => clean(s).replace(/[\s.,;:!]+$/, '');
const has = (hay, needle) => clean(hay).toLowerCase().includes(clean(needle).toLowerCase());

// Characters in a shot: cast records the shot names, in the shot's order.
export function shotCast(shot, cast) {
  const ids = Array.isArray(shot.castIds) ? shot.castIds : [];
  return ids.map(id => cast.find(c => c.id === id)).filter(Boolean);
}

// The exact prompt sent to the model: shot text + characters + camera move + project style.
// Applied the same way to every shot, so the film keeps one look.
export function composePrompt(shot, style, cast = []) {
  const parts = [];
  const base = stripEnd(shot.prompt);
  if (base) parts.push(base);
  for (const c of shotCast(shot, cast)) {
    const d = stripEnd(c.description);
    if (!c.name) continue;
    if (d && !has(base, d)) parts.push(`${c.name}: ${d}`);
  }
  const cam = cameraMove(shot.camera);
  if (cam && cam.key !== 'none' && !has(base, cam.phrase)) parts.push(cam.phrase.charAt(0).toUpperCase() + cam.phrase.slice(1));
  if (style && style.applyToAll !== false) {
    const st = [style.look, style.lighting, style.lens, stripEnd(style.extra)].map(clean).filter(Boolean).filter(x => !has(base, x));
    if (st.length) parts.push('Style: ' + st.join(', ').toLowerCase());
  }
  return parts.join('. ') + (parts.length ? '.' : '');
}

// "Enhance": rewrites a plain idea into a structured cinematic shot description.
// Pure template logic; it only adds film language and never removes or disguises content.
const FILLER = /^(please\s+)?(make|create|generate|give me|show)\s+(me\s+)?(a\s+|an\s+)?(video|clip|shot|scene)?\s*(of|where|with|showing)?\s*/i;
const SIZES = [/\bextreme close[- ]?up\b/i, /\bclose[- ]?up\b/i, /\bmedium\b/i, /\bwide\b/i, /\baerial\b/i, /\bmacro\b/i, /\bestablishing\b/i, /\bover[- ]the[- ]shoulder\b/i, /\bdrone\b/i];
const MOODS = [
  [/\bnight|neon|city lights\b/i, 'glowing practical lights and deep shadows'],
  [/\brain|storm|wet\b/i, 'rain streaks catching the light, wet reflective surfaces'],
  [/\bsunset|sunrise|golden\b/i, 'warm golden light flaring softly into the lens'],
  [/\bbeach|ocean|sea|wave\b/i, 'sea breeze, sparkling water in the background'],
  [/\bforest|woods|jungle|tree\b/i, 'shafts of light cutting through the canopy'],
  [/\bjewel|ring|chain|necklace|gold|silver|diamond|bracelet|pendant\b/i, 'polished metal catching crisp specular highlights'],
  [/\bcar|street|road|drive\b/i, 'motion in the background, urban texture'],
  [/\bsnow|winter|cold\b/i, 'soft falling snow, breath visible in the cold air'],
];
export function enhancePrompt(text, opts = {}) {
  let t = clean(text).replace(FILLER, '');
  if (!t) return '';
  t = stripEnd(t);
  t = t.charAt(0).toUpperCase() + t.slice(1);
  const out = [];
  const sized = SIZES.some(r => r.test(t));
  out.push(sized ? t : 'Cinematic medium shot: ' + t.charAt(0).toLowerCase() + t.slice(1));
  const mood = MOODS.filter(([r]) => r.test(t)).map(([, m]) => m).slice(0, 2);
  if (mood.length) out.push(mood.join(', '));
  const detail = ['natural motion', 'shallow depth of field', 'subtle film grain', 'realistic textures'].filter(x => !has(t, x));
  out.push(detail.join(', '));
  if (opts.camera) { const c = cameraMove(opts.camera); if (c && !has(t, c.phrase)) out.push(c.phrase); }
  return out.map(stripEnd).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('. ') + '.';
}

export function fillTemplate(tpl, words = {}) {
  return tpl.prompt
    .replace(/\[character\]/g, words.character || 'the hero')
    .replace(/\[place\]/g, words.place || 'the city')
    .replace(/\[product\]/g, words.product || 'a gold chain')
    .replace(/\[subject\]/g, words.subject || words.character || 'the subject');
}

// ---------- runtime ----------
export const CARD_SECONDS = 3;
export function runtime(shotSeconds, finish = {}) {
  const segs = shotSeconds.filter(s => s > 0);
  let n = segs.length + (finish.titleOn ? 1 : 0) + (finish.endOn ? 1 : 0);
  let total = segs.reduce((a, b) => a + b, 0) + (finish.titleOn ? CARD_SECONDS : 0) + (finish.endOn ? CARD_SECONDS : 0);
  const fade = finish.crossfade ? xfadeDuration([...segs, ...(finish.titleOn ? [CARD_SECONDS] : []), ...(finish.endOn ? [CARD_SECONDS] : [])], finish.fadeSeconds) : 0;
  if (fade && n > 1) total -= fade * (n - 1);
  return Math.max(0, Math.round(total * 10) / 10);
}
// Crossfade length: what was asked, but never more than a third of the shortest piece.
export function xfadeDuration(durations, want = 0.75) {
  if (!durations.length) return 0;
  const min = Math.min(...durations);
  return Math.max(0, Math.min(Number(want) || 0.75, Math.floor((min / 3) * 100) / 100));
}
export function fmtTime(sec) {
  const s = Math.round(sec);
  const m = Math.floor(s / 60);
  return m ? `${m}:${String(s % 60).padStart(2, '0')}` : `${s}s`;
}

// ---------- cost ----------
export function money(x) {
  if (!isFinite(x)) return '$0.00';
  return '$' + (x < 10 ? x.toFixed(2) : x.toFixed(1));
}
// provider: the adapter (getModel, fitDuration, estimateCost); resFor(model) picks a resolution.
export function shotCost(provider, shot, resFor, audio) {
  const m = provider.getModel(shot.model);
  return provider.estimateCost(m, provider.fitDuration(m, shot.duration), resFor(m), audio && m.audio);
}
export function projectCost(provider, project, resFor, audio) {
  let all = 0, remaining = 0;
  for (const sh of project.shots) {
    const c = shotCost(provider, sh, resFor, audio);
    all += c;
    if (!sh.clipId) remaining += c;
  }
  return { all, remaining };
}

// ---------- shots & projects ----------
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function newShot(project, extra = {}) {
  return { id: uid(), prompt: '', imageId: null, duration: 5, model: project.model, camera: 'static', castIds: [], status: 'idle', job: null, clipId: null, error: '', ...extra };
}
export function newProject(n, model) {
  const p = {
    id: uid(), title: 'Project ' + n, aspect: '16:9', model, shots: [], createdAt: Date.now(), updatedAt: Date.now(),
    v2: true, style: defaultStyle(), cover: null, finish: defaultFinish(),
  };
  p.shots.push(newShot(p));
  return p;
}
export function defaultFinish() {
  return { titleOn: false, title: '', subtitle: '', endOn: false, endText: 'The End', crossfade: true, fadeSeconds: 0.75, musicId: null, musicVolume: 0.35, exportRes: '720' };
}
// v1 stories open in v2 untouched; missing v2 fields get defaults (v1 keeps working on the same record).
export function upgradeProject(p) {
  p.style = { ...defaultStyle(), ...(p.style || {}) };
  p.finish = { ...defaultFinish(), ...(p.finish || {}) };
  if (!ASPECTS.includes(p.aspect)) p.aspect = '16:9';
  p.shots = (p.shots || []).map(sh => ({ camera: 'static', castIds: [], ...sh }));
  return p;
}

export function reorder(list, from, to) {
  const a = list.slice();
  if (from < 0 || from >= a.length) return a;
  const [x] = a.splice(from, 1);
  a.splice(Math.max(0, Math.min(to, a.length)), 0, x);
  return a;
}
export function duplicateShot(project, index) {
  const src = project.shots[index];
  if (!src) return project.shots;
  const copy = { ...JSON.parse(JSON.stringify(src)), id: uid(), status: 'idle', job: null, clipId: null, error: '', note: '' };
  const a = project.shots.slice();
  a.splice(index + 1, 0, copy);
  return a;
}

// ---------- export / import ----------
export const EXPORT_FORMAT = 'scene-studio-project';
export function exportProject(project, cast, imagesById) {
  const usedCast = cast.filter(c => project.shots.some(sh => (sh.castIds || []).includes(c.id)));
  const imgIds = new Set(project.shots.map(sh => sh.imageId).filter(Boolean));
  usedCast.forEach(c => c.imageId && imgIds.add(c.imageId));
  if (project.cover && project.cover.imageId) imgIds.add(project.cover.imageId);
  const images = {};
  for (const id of imgIds) if (imagesById[id]) images[id] = imagesById[id];
  const p = JSON.parse(JSON.stringify(project));
  p.shots.forEach(sh => { sh.job = null; sh.status = sh.clipId ? 'idle' : sh.status === 'failed' ? 'idle' : 'idle'; sh.clipId = null; sh.note = ''; sh.error = ''; });
  if (p.cover && p.cover.clipId) p.cover = null;
  if (p.finish) p.finish.musicId = null;
  return { format: EXPORT_FORMAT, version: 2, exportedAt: new Date().toISOString(), project: p, cast: usedCast.map(c => ({ ...c })), images };
}
// Returns { project, cast, images } with fresh ids so an import never overwrites anything.
export function importProject(data) {
  if (!data || data.format !== EXPORT_FORMAT || !data.project || !Array.isArray(data.project.shots)) throw new Error('This file is not a Scene Studio project.');
  const imgMap = {}, castMap = {};
  const images = {};
  for (const [id, url] of Object.entries(data.images || {})) {
    if (typeof url !== 'string' || !url.startsWith('data:image/')) continue;
    const n = uid(); imgMap[id] = n; images[n] = url;
  }
  const cast = (data.cast || []).map(c => { const n = uid(); castMap[c.id] = n; return { id: n, name: clean(c.name).slice(0, 40), description: clean(c.description).slice(0, 300), imageId: imgMap[c.imageId] || null, createdAt: Date.now() }; });
  const p = upgradeProject(JSON.parse(JSON.stringify(data.project)));
  p.id = uid(); p.createdAt = Date.now(); p.updatedAt = Date.now(); p.v2 = true;
  p.title = clean(p.title || 'Imported').slice(0, 80);
  p.shots = p.shots.map(sh => ({ ...sh, id: uid(), imageId: imgMap[sh.imageId] || null, castIds: (sh.castIds || []).map(id => castMap[id]).filter(Boolean), clipId: null, job: null, status: 'idle', error: '', note: '' }));
  if (p.cover) p.cover = p.cover.imageId && imgMap[p.cover.imageId] ? { imageId: imgMap[p.cover.imageId] } : null;
  return { project: p, cast, images };
}
