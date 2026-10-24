import { describe, expect, it } from 'vitest';
import { MAX_UPLOAD_BYTES, validateImageBuffer } from '../apps/api/src/plugins/uploads.js';

/** Minimal 1x1 PNG */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('uploads validation', () => {
  it('rejects spoofed type, oversized files, and HEIC', () => {
    expect(() => validateImageBuffer(Buffer.from('not-an-image'), 'image/png')).toThrow(/spoofed|unsupported/i);
    expect(() => validateImageBuffer(Buffer.alloc(MAX_UPLOAD_BYTES + 1), 'image/jpeg')).toThrow(/too large/i);
    expect(() => validateImageBuffer(PNG_1X1, 'image/heic')).toThrow(/HEIC/i);
  });

  it('accepts real PNG and reports dimensions', () => {
    const img = validateImageBuffer(PNG_1X1, 'image/png');
    expect(img.mime).toBe('image/png');
    expect(img.width).toBe(1);
    expect(img.height).toBe(1);
  });
});
