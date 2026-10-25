import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(root, f), 'utf8');
const html = read('index.html');

test('page basics: title, viewport, noindex, local assets exist', () => {
  assert.match(html, /<title>Scene Studio<\/title>/);
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1/);
  assert.match(html, /name="robots" content="noindex, nofollow"/);
  assert.match(read('robots.txt'), /Disallow: \//);
  const refs = [...html.matchAll(/(?:src|href)="([^"#:]+)"/g)].map(m => m[1]);
  assert.ok(refs.length >= 4);
  for (const r of refs) assert.ok(existsSync(join(root, r)), 'missing ' + r);
  assert.ok(existsSync(join(root, 'vendor/ffmpeg/ffmpeg.js')) && existsSync(join(root, 'vendor/ffmpeg/814.ffmpeg.js')));
});

test('core UI is present: story, shots, stitch, gallery, settings, play-all fallback', () => {
  for (const id of ['storySelect', 'shots', 'addShot', 'genAll', 'stitchBtn', 'playAllBtn', 'clipGrid', 'imgGrid', 'falKey', 'qualitySeg', 'gateForm']) {
    assert.match(html, new RegExp('id="' + id + '"'), id);
  }
  assert.ok(!/TODO|FIXME|XXX|PLACEHOLDER|__PW_HASH__/.test(html + read('app.js')) && !/lorem ipsum/i.test(html), 'no placeholders');
});

test('password gate stores only a SHA-256 hash', () => {
  const app = read('app.js');
  const m = app.match(/const PW_HASH = '([0-9a-f]{64})'/);
  assert.ok(m, 'hash present');
  assert.ok(!/password\s*[:=]\s*['"][^'"]{4,}['"]/i.test(app));
});

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    if (['.git', 'node_modules'].includes(f)) continue;
    const p = join(dir, f);
    statSync(p).isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}

test('no API keys or tokens anywhere in the repo', () => {
  const pats = [/ghp_[A-Za-z0-9]{20,}/, /github_pat_[A-Za-z0-9_]{20,}/, /sk-[A-Za-z0-9]{20,}/, /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{32}\b/, /AKIA[0-9A-Z]{16}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/];
  for (const f of walk(root)) {
    if (/\.(png|jpg|ico)$/.test(f)) continue;
    const t = readFileSync(f, 'utf8');
    for (const p of pats) assert.ok(!p.test(t), `${f} matches ${p}`);
  }
});

test('open-source housekeeping: MIT license, README setup, .gitignore for secrets', () => {
  assert.match(read('LICENSE'), /MIT License/);
  const rd = read('README.md');
  for (const w of ['fal.ai', 'GitHub Pages', 'providers/fal.js', 'LICENSE']) assert.ok(rd.includes(w), w);
  const gi = read('.gitignore');
  for (const w of ['.env', '*.key', '*.pem', 'secrets*', 'node_modules']) assert.ok(gi.includes(w), w);
});

test('content rules: no bypass or uncensored features', () => {
  const all = ['index.html', 'app.js', 'providers/fal.js'].map(read).join('\n').toLowerCase();
  for (const w of ['uncensored', 'nsfw', 'jailbreak', 'bypass filter', 'safety_tolerance']) assert.ok(!all.includes(w), w);
});
