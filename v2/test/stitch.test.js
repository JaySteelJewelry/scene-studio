import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { outputSize, normaliseArgs, cardArgs, xfadeArgs, xfadeOffsets, musicArgs, concatList, concatArgs, parseDuration } from '../stitch.js';

test('export sizes: 720p and 1080p for every aspect', () => {
  assert.deepEqual(outputSize('16:9', '720'), [1280, 720]);
  assert.deepEqual(outputSize('16:9', '1080'), [1920, 1080]);
  assert.deepEqual(outputSize('9:16', '1080'), [1080, 1920]);
  assert.deepEqual(outputSize('1:1', '1080'), [1080, 1080]);
});

test('crossfade offsets overlap each piece by the fade', () => {
  assert.deepEqual(xfadeOffsets([5, 5, 5], 1), [4, 8]);
  assert.deepEqual(xfadeOffsets([3, 5.04, 5], 0.75), [2.25, 6.54]);
  const a = xfadeArgs(['a.mp4', 'b.mp4', 'c.mp4'], [5, 5, 5], 1, 'o.mp4').join(' ');
  assert.ok(a.includes('xfade=transition=fade:duration=1:offset=4') && a.includes('offset=8') && a.includes('acrossfade=d=1'));
  assert.throws(() => xfadeArgs(['a.mp4'], [5], 1, 'o.mp4'));
});

test('duration parsing from ffmpeg logs', () => {
  assert.equal(parseDuration(['  Duration: 00:00:05.04, start: 0.000000, bitrate: 1 kb/s']), 5.04);
  assert.equal(parseDuration(['nothing']), null);
});

// Runs the exact argument lists through native ffmpeg (same filters ffmpeg.wasm 0.12 ships).
const hasFF = spawnSync('ffmpeg', ['-version']).status === 0;
test('real ffmpeg: cards + clips + crossfade + music produce one playable film', { skip: !hasFF && 'ffmpeg not installed' }, () => {
  const d = mkdtempSync(join(tmpdir(), 'ss2-'));
  const ff = (args) => execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { cwd: d });
  const probe = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { cwd: d }).toString().trim());
  // two "model clips": one silent 16 fps 832x480, one with audio 24 fps 1280x720
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=832x480:rate=16:duration=5', '-pix_fmt', 'yuv420p', 'in0.mp4']);
  ff(['-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=24:duration=5', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5', '-shortest', '-pix_fmt', 'yuv420p', 'in1.mp4']);
  ff(['-f', 'lavfi', '-i', 'color=c=0x111111:size=1280x720:duration=1', '-frames:v', '1', 'card.png']);
  ff(['-f', 'lavfi', '-i', 'sine=frequency=220:duration=3', 'music.m4a']);
  const [w, h] = outputSize('16:9', '720');
  ff(cardArgs('card.png', 'n0.mp4', w, h, 3));
  ff(normaliseArgs('in0.mp4', 'n1.mp4', w, h, false));
  ff(normaliseArgs('in1.mp4', 'n2.mp4', w, h, true));
  const durs = ['n0.mp4', 'n1.mp4', 'n2.mp4'].map(probe);
  assert.ok(Math.abs(durs[0] - 3) < 0.15, 'card is 3 s, got ' + durs[0]);
  ff(xfadeArgs(['n0.mp4', 'n1.mp4', 'n2.mp4'], durs, 0.75, 'xf.mp4'));
  const total = durs.reduce((a, b) => a + b, 0) - 2 * 0.75;
  assert.ok(Math.abs(probe('xf.mp4') - total) < 0.25, `crossfaded length ${probe('xf.mp4')} vs ${total}`);
  ff(musicArgs('xf.mp4', 'music.m4a', 'mix.mp4', total, 0.35));
  assert.ok(Math.abs(probe('mix.mp4') - total) < 0.25, 'music loops to the film length and stops with it');
  const streams = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height', '-of', 'csv=p=0', 'mix.mp4'], { cwd: d }).toString();
  assert.match(streams, /video,1280,720/); assert.match(streams, /audio/);
  // hard-cut fallback path
  writeFileSync(join(d, 'list.txt'), concatList(['n0.mp4', 'n1.mp4', 'n2.mp4']));
  ff(concatArgs('list.txt', 'cut.mp4'));
  assert.ok(Math.abs(probe('cut.mp4') - (durs[0] + durs[1] + durs[2])) < 0.3);
  assert.ok(existsSync(join(d, 'mix.mp4')));
});

test('1080p vertical renders through the same graph', { skip: !hasFF && 'ffmpeg not installed' }, () => {
  const d = mkdtempSync(join(tmpdir(), 'ss2v-'));
  const ff = (args) => execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { cwd: d });
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=480x832:rate=16:duration=2', '-pix_fmt', 'yuv420p', 'a.mp4']);
  const [w, h] = outputSize('9:16', '1080');
  ff(normaliseArgs('a.mp4', 'n.mp4', w, h, false));
  const s = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', 'n.mp4'], { cwd: d }).toString().trim();
  assert.equal(s, '1080,1920');
});
