import assert from 'node:assert/strict';
import test from 'node:test';
import { median } from './median.mjs';

test('median handles odd and even counts without mutating input', () => {
  const values = [9, 1, 5, 3];
  assert.equal(median(values), 4);
  assert.deepEqual(values, [9, 1, 5, 3]);
  assert.equal(median([1, 7, 3]), 3);
});
