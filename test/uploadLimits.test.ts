import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  isSupportedScheduleFile,
  validateUploads,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
} from '../lib/uploadLimits';

function file(name: string, type: string, bytes: number): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe('isSupportedScheduleFile', () => {
  test('accepts the documented formats and rejects everything else', () => {
    for (const type of ['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp']) {
      assert.ok(isSupportedScheduleFile(file('x', type, 1)), type);
    }
    for (const type of ['text/plain', 'image/heic', 'application/zip', '']) {
      assert.ok(!isSupportedScheduleFile(file('x', type, 1)), type);
    }
  });
});

describe('validateUploads', () => {
  test('accepts a batch within both limits', () => {
    assert.equal(validateUploads([file('a.pdf', 'application/pdf', 1024)]), null);
    assert.equal(validateUploads([]), null);
  });

  test('rejects an unsupported type by name', () => {
    const error = validateUploads([file('notes.txt', 'text/plain', 10)]);
    assert.match(String(error), /notes\.txt/);
    assert.match(String(error), /not a supported file type/);
  });

  test('rejects a single file over the per-file limit', () => {
    const error = validateUploads([file('big.pdf', 'application/pdf', MAX_FILE_BYTES + 1)]);
    assert.match(String(error), /big\.pdf/);
    assert.match(String(error), /under/);
  });

  test('rejects a batch that only breaches the combined limit', () => {
    // Each file is individually fine; the point is that the total is checked too.
    const each = Math.floor(MAX_FILE_BYTES / 2);
    const count = Math.ceil(MAX_TOTAL_BYTES / each) + 1;
    const files = Array.from({ length: count }, (_, i) =>
      file(`page-${i}.png`, 'image/png', each)
    );
    assert.match(String(validateUploads(files)), /combined size/);
  });

  test('names an unnamed file rather than producing an empty message', () => {
    assert.match(String(validateUploads([file('', 'text/plain', 1)])), /Unnamed file/);
  });
});
