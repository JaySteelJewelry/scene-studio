import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseArgs, outputSize, concatList } from '../stitch.js';

test('output size follows the story frame', () => {
  assert.deepEqual(outputSize('16:9'), [1280, 720]);
  assert.deepEqual(outputSize('9:16'), [720, 1280]);
  assert.deepEqual(outputSize('1:1'), [720, 720]);
});

test('silent clips get a silent stereo track so mixed clips can be joined', () => {
  const a = normaliseArgs('in0.mp4', 'n0.mp4', 1280, 720, false);
  assert.ok(a.join(' ').includes('anullsrc=channel_layout=stereo'));
  assert.ok(a.includes('-shortest'));
  const b = normaliseArgs('in0.mp4', 'n0.mp4', 1280, 720, true);
  assert.ok(!b.join(' ').includes('anullsrc'));
  for (const x of [a, b]) {
    assert.equal(x[x.length - 1], 'n0.mp4');
    assert.ok(x.join(' ').includes('scale=1280:720') && x.join(' ').includes('fps=24'));
  }
});

test('concat list keeps shot order', () => {
  assert.equal(concatList(['in0.mp4', 'in1.mp4', 'in2.mp4']), "file 'in0.mp4'\nfile 'in1.mp4'\nfile 'in2.mp4'\n");
});
