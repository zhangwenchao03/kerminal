import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bytesPreview } from './redis_ops.js';

test('bytesPreview redacts by default', () => {
  const payload = bytesPreview(Buffer.from('secret-value'), 5, false);
  assert.equal(payload.length, 12);
  assert.equal(payload.value_redacted, true);
  assert.equal('value' in payload, false);
});

test('bytesPreview truncates shown values', () => {
  const payload = bytesPreview(Buffer.from('abcdef'), 3, true);
  assert.equal(payload.value, 'abc');
  assert.equal(payload.truncated, true);
});
