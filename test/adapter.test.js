import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fal from '../providers/fal.js';
import { providers, getProvider } from '../providers/index.js';

const M = k => fal.getModel(k);

test('registry exposes the fal adapter with the full adapter surface', () => {
  assert.equal(getProvider('fal'), providers.fal);
  for (const fn of ['buildInput', 'submit', 'poll', 'result', 'uploadImage', 'cancel', 'estimateCost', 'fitDuration', 'getModel']) {
    assert.equal(typeof fal[fn], 'function', fn);
  }
});

test('open-source models are the default and listed first; closed ones are extras', () => {
  assert.equal(M(fal.defaultModel).open, true);
  const firstClosed = fal.models.findIndex(m => !m.open);
  assert.ok(fal.models.slice(0, firstClosed).length >= 3, 'at least 3 open models');
  assert.ok(fal.models.slice(firstClosed).every(m => !m.open), 'closed models come after open ones');
});

test('every model has fal endpoint ids, durations within 5-10 s and a price note', () => {
  for (const m of fal.models) {
    assert.match(m.i2v, /^fal-ai\/[\w.\-\/]+$/);
    assert.match(m.t2v, /^fal-ai\/[\w.\-\/]+$/);
    assert.ok(m.price && m.price.includes('$'), m.key + ' price');
    assert.ok(m.durations.every(d => d >= 5 && d <= 10), m.key + ' durations');
  }
});

test('Wan 2.2: duration maps to frames at 16 fps; image picks image-to-video', () => {
  const a = fal.buildInput(M('wan22'), { prompt: ' a boat ', duration: 5 }, { aspect: '9:16', resolution: '480p' });
  assert.equal(a.endpoint, 'fal-ai/wan/v2.2-a14b/text-to-video');
  assert.deepEqual(a.input, { prompt: 'a boat', num_frames: 81, resolution: '480p', aspect_ratio: '9:16' });
  const b = fal.buildInput(M('wan22'), { prompt: 'x', duration: 10 }, { imageUrl: 'https://v3.fal.media/a.png', aspect: '16:9', resolution: '720p' });
  assert.equal(b.endpoint, 'fal-ai/wan/v2.2-a14b/image-to-video');
  assert.equal(b.input.num_frames, 161);
  assert.equal(b.input.image_url, 'https://v3.fal.media/a.png');
  assert.equal(b.input.aspect_ratio, 'auto');
});

test('LTX-2.3 rounds 5 s up to its 6 s minimum and carries the sound switch', () => {
  const a = fal.buildInput(M('ltx23'), { prompt: 'x', duration: 5 }, { aspect: '1:1', audio: true });
  assert.equal(a.endpoint, 'fal-ai/ltx-2.3/text-to-video/fast');
  assert.equal(a.input.duration, 6);
  assert.equal(a.input.aspect_ratio, '16:9', 'unsupported 1:1 falls back');
  assert.equal(a.input.generate_audio, true);
  assert.equal(fal.buildInput(M('ltx23'), { prompt: 'x', duration: 9 }, {}).input.duration, 8);
});

test('Kling inputs use the field names fal documents', () => {
  const k3 = fal.buildInput(M('kling3'), { prompt: 'x', duration: 7 }, { imageUrl: 'u' });
  assert.equal(k3.endpoint, 'fal-ai/kling-video/v3/pro/image-to-video');
  assert.equal(k3.input.start_image_url, 'u');
  assert.equal(k3.input.duration, '7');
  const k25 = fal.buildInput(M('kling25'), { prompt: 'x', duration: 8 }, { aspect: '9:16' });
  assert.equal(k25.input.duration, '10');
  assert.equal(k25.input.aspect_ratio, '9:16');
});

test('price estimates follow fal\'s published rates', () => {
  assert.equal(fal.estimateCost(M('wan22'), 5, '720p').toFixed(2), '0.40');
  assert.equal(fal.estimateCost(M('wan22turbo'), 5, '480p'), 0.05);
  assert.equal(fal.estimateCost(M('kling25'), 10).toFixed(2), '0.70');
  assert.equal(fal.estimateCost(M('ltx23'), 5, '1080p').toFixed(2), '0.36');
});

test('no request ever carries safety-filter overrides or prompt rewriting for evasion', () => {
  for (const m of fal.models) for (const img of [null, 'u']) {
    const { input } = fal.buildInput(m, { prompt: 'p', duration: 5 }, { imageUrl: img });
    assert.ok(!('enable_safety_checker' in input) && !('safety_tolerance' in input), m.key);
    assert.equal(input.prompt, 'p');
  }
});

function mockFetch(routes) {
  const calls = [];
  const f = async (url, opts = {}) => {
    calls.push({ url, opts });
    const r = routes.find(([re]) => re.test(url));
    if (!r) return new Response('nope', { status: 404 });
    const [, status, body] = r;
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  };
  f.calls = calls;
  return f;
}

test('queue flow: submit, poll, result against fal\'s REST shapes', async () => {
  const f = mockFetch([
    [/^https:\/\/queue\.fal\.run\/fal-ai\/wan\/v2\.2-a14b\/text-to-video$/, 200, { request_id: 'r1', status_url: 'https://queue.fal.run/fal-ai/wan/requests/r1/status', response_url: 'https://queue.fal.run/fal-ai/wan/requests/r1' }],
    [/requests\/r1\/status/, 200, { status: 'IN_PROGRESS', logs: [{ message: 'step 3/27' }] }],
    [/requests\/r1$/, 200, { video: { url: 'https://v3b.fal.media/files/x.mp4', content_type: 'video/mp4' }, seed: 7 }],
  ]);
  const job = await fal.submit('fal-ai/wan/v2.2-a14b/text-to-video', { prompt: 'p' }, 'k-123', f);
  assert.equal(f.calls[0].opts.method, 'POST');
  assert.equal(f.calls[0].opts.headers.Authorization, 'Key k-123');
  assert.equal(job.requestId, 'r1');
  const st = await fal.poll(job, 'k-123', f);
  assert.deepEqual(st, { state: 'running', logs: ['step 3/27'] });
  assert.match(f.calls[1].url, /status\?logs=1$/);
  const res = await fal.result(job, 'k-123', f);
  assert.equal(res.videoUrl, 'https://v3b.fal.media/files/x.mp4');
});

test('poll maps queue and completion states; errors are readable', async () => {
  const job = { statusUrl: 'https://queue.fal.run/a/requests/r/status', responseUrl: 'https://queue.fal.run/a/requests/r' };
  assert.deepEqual(await fal.poll(job, 'k', mockFetch([[/status/, 200, { status: 'IN_QUEUE', queue_position: 2 }]])), { state: 'queued', position: 2, logs: [] });
  assert.equal((await fal.poll(job, 'k', mockFetch([[/status/, 200, { status: 'COMPLETED' }]]))).state, 'done');
  await assert.rejects(fal.submit('fal-ai/x', {}, 'bad', mockFetch([[/queue/, 401, { detail: 'Invalid key' }]])), /refused the key/);
  await assert.rejects(fal.submit('fal-ai/x', {}, '', mockFetch([])), /Settings/);
});

test('image upload uses fal storage, falls back to a data URI', async () => {
  const ok = mockFetch([[/storage\/upload\/initiate/, 200, { upload_url: 'https://up.example/put', file_url: 'https://v3.fal.media/files/img.png' }], [/up\.example/, 200, '']]);
  assert.equal(await fal.uploadImage(new Blob(['x'], { type: 'image/png' }), 'k', ok), 'https://v3.fal.media/files/img.png');
  assert.match(ok.calls[0].url, /^https:\/\/rest\.fal\.ai\/storage\/upload\/initiate\?storage_type=fal-cdn-v3$/);
  globalThis.FileReader ??= class { readAsDataURL(b) { b.arrayBuffer().then(a => { this.result = 'data:' + b.type + ';base64,' + Buffer.from(a).toString('base64'); this.onload(); }); } };
  const bad = mockFetch([[/storage/, 500, 'down']]);
  assert.match(await fal.uploadImage(new Blob(['x'], { type: 'image/png' }), 'k', bad), /^data:image\/png;base64,/);
});
