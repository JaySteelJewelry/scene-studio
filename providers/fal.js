// Provider adapter: fal.ai (queue REST API, called straight from the browser).
// To add another host (e.g. Replicate), write a file with the same exports:
//   id, label, keyHelp, models, buildInput(model, shot, ctx), submit(), poll(), result(), uploadImage()
// and register it in providers/index.js. Nothing else in the app knows about fal.

export const id = 'fal';
export const label = 'fal.ai';
export const keyHelp = 'fal.ai → Dashboard → API Keys → Create key';

const QUEUE = 'https://queue.fal.run';
const REST = 'https://rest.fal.ai';

// Every model id below was checked against fal's own model pages / OpenAPI schemas (Oct 2026).
// price: fal's own per-clip pricing note, shown in the app next to the model.
export const models = [
  {
    key: 'wan22', name: 'Wan 2.2', open: true, license: 'Apache 2.0',
    i2v: 'fal-ai/wan/v2.2-a14b/image-to-video', t2v: 'fal-ai/wan/v2.2-a14b/text-to-video',
    durations: [5, 6, 7, 8, 9, 10], resolutions: ['480p', '580p', '720p'], defaultRes: '720p',
    aspects: ['16:9', '9:16', '1:1'], audio: false,
    price: '$0.04/s at 480p · $0.06/s at 580p · $0.08/s at 720p',
    perSecond: { '480p': 0.04, '580p': 0.06, '720p': 0.08 },
  },
  {
    key: 'wan22turbo', name: 'Wan 2.2 Turbo', open: true, license: 'Apache 2.0',
    i2v: 'fal-ai/wan/v2.2-a14b/image-to-video/turbo', t2v: 'fal-ai/wan/v2.2-a14b/text-to-video/turbo',
    durations: [5], resolutions: ['480p', '580p', '720p'], defaultRes: '720p',
    aspects: ['16:9', '9:16', '1:1'], audio: false,
    price: '$0.05 per clip at 480p · $0.075 at 580p · $0.10 at 720p',
    perClip: { '480p': 0.05, '580p': 0.075, '720p': 0.10 },
  },
  {
    key: 'ltx23', name: 'LTX-2.3 Fast (with sound)', open: true, license: 'Apache 2.0',
    i2v: 'fal-ai/ltx-2.3/image-to-video/fast', t2v: 'fal-ai/ltx-2.3/text-to-video/fast',
    durations: [6, 8, 10], resolutions: ['1080p'], defaultRes: '1080p',
    aspects: ['16:9', '9:16'], audio: true,
    price: '$0.06/s at 1080p',
    perSecond: { '1080p': 0.06 },
  },
  {
    key: 'hunyuan15', name: 'HunyuanVideo 1.5', open: true, license: 'Tencent Hunyuan Community',
    i2v: 'fal-ai/hunyuan-video-v1.5/image-to-video', t2v: 'fal-ai/hunyuan-video-v1.5/text-to-video',
    durations: [5], resolutions: ['480p'], defaultRes: '480p',
    aspects: ['16:9', '9:16'], audio: false,
    price: '$0.075/s',
    perSecond: { '480p': 0.075 },
  },
  {
    key: 'kling25', name: 'Kling 2.5 Turbo Pro', open: false,
    i2v: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video', t2v: 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video',
    durations: [5, 10], resolutions: ['1080p'], defaultRes: '1080p',
    aspects: ['16:9', '9:16', '1:1'], audio: false,
    price: '$0.35 for 5 s, +$0.07 each extra second',
    cost: (d) => 0.35 + Math.max(0, d - 5) * 0.07,
  },
  {
    key: 'kling3', name: 'Kling 3.0 Pro', open: false,
    i2v: 'fal-ai/kling-video/v3/pro/image-to-video', t2v: 'fal-ai/kling-video/v3/pro/text-to-video',
    durations: [5, 6, 7, 8, 9, 10], resolutions: ['1080p'], defaultRes: '1080p',
    aspects: ['16:9', '9:16', '1:1'], audio: true,
    price: '$0.112/s (sound off) · $0.168/s (sound on)',
    perSecond: { '1080p': 0.112 }, perSecondAudio: 0.168,
  },
];

export const defaultModel = 'wan22';

export function getModel(key) {
  return models.find(m => m.key === key) || models.find(m => m.key === defaultModel);
}

// Closest allowed duration for a model (5-10 s asked; some models only do fixed lengths).
export function fitDuration(model, want) {
  const d = Number(want) || model.durations[0];
  return model.durations.reduce((best, x) => Math.abs(x - d) < Math.abs(best - d) ? x : best, model.durations[0]);
}

export function fitAspect(model, aspect) {
  return model.aspects.includes(aspect) ? aspect : model.aspects[0];
}

// Estimated price of one clip, from fal's published rates above (an estimate, fal bills the truth).
export function estimateCost(model, duration, res, audio) {
  const d = fitDuration(model, duration);
  const r = model.resolutions.includes(res) ? res : model.defaultRes;
  if (model.cost) return model.cost(d);
  if (model.perClip) return model.perClip[r];
  if (audio && model.perSecondAudio) return model.perSecondAudio * d;
  return (model.perSecond[r] || 0) * d;
}

// Build the exact JSON body fal's model expects for one shot.
// shot: { prompt, duration }, ctx: { imageUrl|null, aspect, resolution, audio }
export function buildInput(model, shot, ctx = {}) {
  const prompt = String(shot.prompt || '').trim();
  const d = fitDuration(model, shot.duration);
  const hasImg = !!ctx.imageUrl;
  const aspect = fitAspect(model, ctx.aspect || '16:9');
  const res = model.resolutions.includes(ctx.resolution) ? ctx.resolution : model.defaultRes;
  const endpoint = hasImg ? model.i2v : model.t2v;
  const input = { prompt };
  switch (model.key) {
    case 'wan22':
      input.num_frames = Math.min(161, Math.max(17, 16 * d + 1)); // fal: 16 fps, 17-161 frames
      input.resolution = res;
      input.aspect_ratio = hasImg ? 'auto' : aspect;
      if (hasImg) input.image_url = ctx.imageUrl;
      break;
    case 'wan22turbo':
      input.resolution = res;
      input.aspect_ratio = hasImg ? 'auto' : aspect;
      if (hasImg) input.image_url = ctx.imageUrl;
      break;
    case 'ltx23':
      input.duration = d;
      input.resolution = res;
      input.aspect_ratio = hasImg ? 'auto' : aspect;
      input.generate_audio = !!ctx.audio;
      if (hasImg) input.image_url = ctx.imageUrl;
      break;
    case 'hunyuan15':
      input.num_frames = 121; // model max, about 5 s
      input.aspect_ratio = aspect;
      input.resolution = res;
      if (hasImg) input.image_url = ctx.imageUrl;
      break;
    case 'kling25':
      input.duration = String(d);
      if (hasImg) input.image_url = ctx.imageUrl; else input.aspect_ratio = aspect;
      break;
    case 'kling3':
      input.duration = String(d);
      input.generate_audio = !!ctx.audio;
      if (hasImg) input.start_image_url = ctx.imageUrl; else input.aspect_ratio = aspect;
      break;
    default:
      throw new Error('Unknown model ' + model.key);
  }
  return { endpoint, input, duration: d };
}

function auth(key) {
  if (!key) throw new Error('Add your fal.ai key in Settings first.');
  return { Authorization: 'Key ' + key };
}

async function readError(r) {
  let t = '';
  try { t = await r.text(); } catch (e) {}
  let msg = t;
  try {
    const j = JSON.parse(t);
    const d = j.detail;
    msg = Array.isArray(d) ? d.map(x => x.msg || JSON.stringify(x)).join('; ') : (d || j.message || j.error || t);
  } catch (e) {}
  if (r.status === 401 || r.status === 403) msg = 'fal.ai refused the key (' + r.status + '). Check it in Settings. ' + (msg || '');
  if (r.status === 402) msg = 'fal.ai says the account is out of credit (402). Add credit at fal.ai/dashboard/billing. ' + (msg || '');
  return new Error(String(msg || ('HTTP ' + r.status)).slice(0, 400));
}

// Submit one job. Returns { requestId, statusUrl, responseUrl }.
export async function submit(endpoint, input, key, fetchImpl = fetch) {
  const r = await fetchImpl(QUEUE + '/' + endpoint, {
    method: 'POST',
    headers: { ...auth(key), 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!r.ok) throw await readError(r);
  const j = await r.json();
  return { requestId: j.request_id, statusUrl: j.status_url, responseUrl: j.response_url };
}

// Poll once. Returns { state: 'queued'|'running'|'done'|'failed', position, logs }.
export async function poll(job, key, fetchImpl = fetch) {
  const r = await fetchImpl(job.statusUrl + (job.statusUrl.includes('?') ? '&' : '?') + 'logs=1', { headers: auth(key) });
  if (!r.ok) throw await readError(r);
  const j = await r.json();
  const s = j.status;
  const logs = (j.logs || []).map(l => l.message).filter(Boolean);
  if (s === 'IN_QUEUE') return { state: 'queued', position: j.queue_position ?? null, logs };
  if (s === 'IN_PROGRESS') return { state: 'running', logs };
  if (s === 'COMPLETED') return j.error ? { state: 'failed', error: String(j.error), logs } : { state: 'done', logs };
  return { state: 'failed', error: 'Unexpected status ' + s, logs };
}

// Fetch the finished result. Returns { videoUrl, contentType }.
export async function result(job, key, fetchImpl = fetch) {
  const r = await fetchImpl(job.responseUrl, { headers: auth(key) });
  if (!r.ok) throw await readError(r);
  const j = await r.json();
  const v = j.video || (j.videos && j.videos[0]) || {};
  if (!v.url) throw new Error('fal.ai finished but returned no video.');
  return { videoUrl: v.url, contentType: v.content_type || 'video/mp4', seed: j.seed ?? null };
}

// Upload a start image to fal storage; returns a URL fal's models can read.
// Falls back to a data: URI (fal accepts base64 data URIs) if the upload path fails.
export async function uploadImage(blob, key, fetchImpl = fetch) {
  try {
    const type = blob.type || 'image/jpeg';
    const r = await fetchImpl(REST + '/storage/upload/initiate?storage_type=fal-cdn-v3', {
      method: 'POST',
      headers: { ...auth(key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ content_type: type, file_name: 'start-' + Date.now() + (type.includes('png') ? '.png' : '.jpg') }),
    });
    if (!r.ok) throw await readError(r);
    const { upload_url, file_url } = await r.json();
    const put = await fetchImpl(upload_url, { method: 'PUT', body: blob, headers: { 'Content-Type': type } });
    if (!put.ok) throw new Error('upload PUT ' + put.status);
    return file_url;
  } catch (e) {
    if (String(e.message).includes('refused the key') || String(e.message).includes('out of credit')) throw e;
    return await blobToDataUrl(blob);
  }
}

function blobToDataUrl(blob) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(blob);
  });
}

// Ask fal to cancel a queued job (best effort).
export async function cancel(job, key, fetchImpl = fetch) {
  if (!job.responseUrl) return;
  try { await fetchImpl(job.responseUrl + '/cancel', { method: 'PUT', headers: auth(key) }); } catch (e) {}
}
