import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const v2 = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(v2, f), 'utf8');
const html = read('index.html');
const app = read('app.js');

test('v2 page basics: title, viewport, noindex, every local asset exists', () => {
  assert.match(html, /<title>Scene Studio<\/title>/);
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/);
  assert.match(html, /name="robots" content="noindex, nofollow"/);
  const refs = [...html.matchAll(/(?:src|href)="([^"#:]+)"/g)].map(m => m[1]).filter(r => r !== '../');
  assert.ok(refs.length >= 4);
  for (const r of refs) assert.ok(existsSync(join(v2, r)), 'missing ' + r);
  for (const f of ['vendor/ffmpeg/ffmpeg.js', 'vendor/ffmpeg/814.ffmpeg.js', 'providers/fal.js', 'lib/core.js', 'lib/icons.js', 'stitch.js', 'db.js']) assert.ok(existsSync(join(v2, f)), f);
});

test('every premium feature has its UI', () => {
  for (const id of ['gateForm', 'projectGrid', 'newProject', 'importFile', 'board', 'timeline', 'tlTotal', 'aspectSeg', 'styleBtn', 'castGrid', 'addCast',
    'fTitleOn', 'fEndOn', 'fFade', 'musicBox', 'resSeg', 'stitchBtn', 'playAllBtn', 'spentVal', 'clipGrid', 'falKey', 'qualitySeg']) {
    assert.match(html, new RegExp('id="' + id + '"'), id);
  }
  for (const fn of ['setupDrag', 'duplicateShot', 'exportProjectFile', 'enhancePrompt', 'composePrompt', 'drawCard', 'addSpent', 'projectCost']) assert.ok(app.includes(fn), fn);
  assert.ok(!/TODO|FIXME|XXX|PLACEHOLDER/.test(html + app));
});

test('same password gate as v1 (hash only) and the same fal key storage', () => {
  const v1 = readFileSync(join(v2, '..', 'app.js'), 'utf8');
  const h1 = v1.match(/const PW_HASH = '([0-9a-f]{64})'/)[1];
  const h2 = app.match(/const PW_HASH = '([0-9a-f]{64})'/)[1];
  assert.equal(h2, h1);
  assert.ok(app.includes("unlock: 'ss.unlock.v1'") && app.includes("settings: 'ss.settings.v1'"));
  assert.ok(!/password\s*[:=]\s*['"][^'"]{4,}['"]/i.test(app));
});

test('reads the v1 database without changing its version (v1 keeps working)', () => {
  const v1db = readFileSync(join(v2, '..', 'db.js'), 'utf8');
  const db = read('db.js');
  assert.match(v1db, /DB_NAME = 'scene-studio'/); assert.match(v1db, /VERSION = 1/);
  assert.match(db, /name: 'scene-studio', version: 1, stores: \['stories', 'images', 'clips', 'finals'\]/);
  assert.match(db, /name: 'scene-studio-v2'/);
});

test('content rules: no bypass or uncensored features', () => {
  const all = [html, app, read('lib/core.js'), read('providers/fal.js')].join('\n').toLowerCase();
  for (const w of ['uncensored', 'nsfw', 'jailbreak', 'bypass filter', 'safety_tolerance']) assert.ok(!all.includes(w), w);
});

test('web build standard (Oct 25): AA muted text, add-shot is a real button, landmarks + h1 on the board', () => {
  const css = read('styles.css');
  assert.ok(!css.includes('--ink3:#7d7a74'), 'muted text below 4.5:1');
  assert.ok(!app.includes("add.setAttribute('role', 'button')") && app.includes("add.type = 'button'; add.className = 'add-shot'"));
  assert.match(html, /<h1 class="eyebrow">Storyboard<\/h1>/);
  assert.match(html, /id="keyBanner" class="banner" role="region"/);
  for (const m of (html + app).matchAll(/target="_blank"[^>]*/g)) assert.match(m[0], /noopener/);
});
