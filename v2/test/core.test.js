import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../lib/core.js';
import * as fal from '../providers/fal.js';

const style = { look: 'Cinematic film', lighting: 'Golden hour', lens: '35mm lens', extra: 'teal and orange grade', applyToAll: true };
const cast = [{ id: 'c1', name: 'Jay', description: 'man with a short fade and a gold chain' }, { id: 'c2', name: 'Mia', description: 'woman in a red coat' }];

test('style + camera + cast go into every shot prompt the same way', () => {
  const a = C.composePrompt({ prompt: 'Jay walks down the street.', camera: 'dolly-in', castIds: ['c1'] }, style, cast);
  const b = C.composePrompt({ prompt: 'Jay sits at a cafe', camera: 'orbit', castIds: ['c1'] }, style, cast);
  assert.equal(a, 'Jay walks down the street. Jay: man with a short fade and a gold chain. Slow dolly in toward the subject. Style: cinematic film, golden hour, 35mm lens, teal and orange grade.');
  const tail = s => s.slice(s.indexOf('Style:'));
  assert.equal(tail(a), tail(b), 'same style suffix on every shot');
  assert.ok(b.includes('Camera orbits around the subject'));
});

test('style can be switched off; unknown cast ids and empty prompts are safe', () => {
  assert.equal(C.composePrompt({ prompt: 'A cat', camera: 'static', castIds: ['nope'] }, { ...style, applyToAll: false }, cast), 'A cat. Locked-off static camera.');
  assert.equal(C.composePrompt({ prompt: '', castIds: [] }, { applyToAll: false }, cast), '');
  // v1 shots have no camera/castIds fields at all
  assert.equal(C.composePrompt({ prompt: 'Old v1 shot' }, style, cast), 'Old v1 shot. Style: cinematic film, golden hour, 35mm lens, teal and orange grade.');
});

test('every camera preset the brief asked for exists', () => {
  for (const k of ['static', 'dolly-in', 'pan-left', 'pan-right', 'orbit', 'handheld']) assert.ok(C.cameraMove(k), k);
});

test('enhance rewrites a plain idea into a cinematic prompt without dropping it', () => {
  const e = C.enhancePrompt('make a video of a gold chain on a table at sunset');
  assert.match(e, /^Cinematic medium shot: a gold chain on a table at sunset\./);
  assert.ok(e.includes('golden light') && e.includes('specular') && e.includes('shallow depth of field'));
  const e2 = C.enhancePrompt('Close-up of a ring', { camera: 'orbit' });
  assert.ok(e2.startsWith('Close-up of a ring.') && /camera orbits/i.test(e2));
  assert.equal(C.enhancePrompt('   '), '');
  assert.ok(!/uncensored|nsfw|bypass/i.test(e + e2));
});

test('templates fill in the character', () => {
  const t = C.TEMPLATES.find(x => x.key === 'hero-walk');
  assert.equal(C.fillTemplate(t, { character: 'Jay' }), 'Jay walks confidently toward camera through the city');
  assert.ok(C.TEMPLATES.length >= 8 && C.TEMPLATES.every(t => C.cameraMove(t.camera)));
});

test('runtime adds cards and subtracts crossfade overlaps', () => {
  assert.equal(C.runtime([5, 5, 5], {}), 15);
  assert.equal(C.runtime([5, 5, 5], { titleOn: true, endOn: true }), 21);
  assert.equal(C.runtime([5, 5, 5], { crossfade: true, fadeSeconds: 1 }), 13);
  assert.equal(C.runtime([5, 5], { titleOn: true, crossfade: true, fadeSeconds: 0.75 }), 13 - 1.5);
  assert.equal(C.xfadeDuration([5, 2], 1), 0.66);
  assert.equal(C.fmtTime(75), '1:15');
  assert.equal(C.fmtTime(9), '9s');
});

test('cost estimate per shot and per project uses fal listed prices', () => {
  const resFor = m => (m.resolutions.includes('720p') ? '720p' : m.defaultRes);
  const p = { shots: [
    { model: 'wan22', duration: 5, clipId: 'x' },      // 5 s * $0.08 = 0.40 (done)
    { model: 'wan22turbo', duration: 5 },              // $0.10 per clip at 720p
    { model: 'kling25', duration: 10 },                // 0.35 + 5 * 0.07 = 0.70
  ] };
  assert.equal(C.shotCost(fal, p.shots[0], resFor, false).toFixed(2), '0.40');
  const { all, remaining } = C.projectCost(fal, p, resFor, false);
  assert.equal(all.toFixed(2), '1.20');
  assert.equal(remaining.toFixed(2), '0.80');
  assert.equal(C.money(1.2), '$1.20');
});

test('reorder and duplicate shots', () => {
  const p = { shots: [{ id: 'a', prompt: 'A', clipId: 'k' }, { id: 'b', prompt: 'B' }, { id: 'c', prompt: 'C' }] };
  assert.deepEqual(C.reorder(p.shots, 0, 2).map(s => s.id), ['b', 'c', 'a']);
  assert.deepEqual(C.reorder(p.shots, 2, 0).map(s => s.id), ['c', 'a', 'b']);
  const d = C.duplicateShot(p, 0);
  assert.equal(d.length, 4); assert.equal(d[1].prompt, 'A'); assert.notEqual(d[1].id, 'a'); assert.equal(d[1].clipId, null);
  assert.equal(p.shots.length, 3, 'original untouched');
});

test('v1 stories upgrade in place without losing anything', () => {
  const v1 = { id: 's1', title: 'Story 1', aspect: '9:16', model: 'wan22', shots: [{ id: 'x', prompt: 'hi', imageId: 'i1', duration: 5, model: 'wan22', status: 'done', clipId: 'c9' }], createdAt: 1, updatedAt: 2 };
  const u = C.upgradeProject(JSON.parse(JSON.stringify(v1)));
  assert.equal(u.shots[0].clipId, 'c9'); assert.equal(u.shots[0].imageId, 'i1'); assert.equal(u.aspect, '9:16');
  assert.equal(u.shots[0].camera, 'static'); assert.deepEqual(u.shots[0].castIds, []);
  assert.equal(u.style.look, 'Cinematic film'); assert.equal(u.finish.exportRes, '720');
});

test('export / import round trip with fresh ids and remapped cast + images', () => {
  const p = C.newProject(1, 'wan22');
  p.title = 'Drop'; p.shots[0].prompt = 'Jay smiles'; p.shots[0].castIds = ['c1']; p.shots[0].imageId = 'img1'; p.shots[0].clipId = 'clipX';
  const data = C.exportProject(p, [{ ...cast[0], imageId: 'img1' }, cast[1]], { img1: 'data:image/png;base64,AAAA' });
  assert.equal(data.format, 'scene-studio-project');
  assert.equal(data.cast.length, 1, 'only cast used in the project');
  assert.equal(data.project.shots[0].clipId, null, 'clips are not exported');
  const json = JSON.parse(JSON.stringify(data));
  const r = C.importProject(json);
  assert.notEqual(r.project.id, p.id);
  assert.equal(r.project.title, 'Drop');
  const newImg = Object.keys(r.images)[0];
  assert.equal(r.project.shots[0].imageId, newImg);
  assert.equal(r.cast[0].imageId, newImg);
  assert.deepEqual(r.project.shots[0].castIds, [r.cast[0].id]);
  assert.throws(() => C.importProject({ hello: 1 }), /not a Scene Studio project/);
});
