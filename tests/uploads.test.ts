import { describe, expect, it } from 'vitest';
import { MAX_UPLOAD_BYTES, validateImageBuffer } from '../apps/api/src/plugins/uploads.js';

/** Minimal 1x1 PNG */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('uploads validation', () => {
  it('rejects spoofed type, oversized files, and HEIC', async () => {
    await expect(validateImageBuffer(Buffer.from('not-an-image'), 'image/png')).rejects.toThrow(/spoofed|unsupported/i);
    await expect(validateImageBuffer(Buffer.alloc(MAX_UPLOAD_BYTES + 1), 'image/jpeg')).rejects.toThrow(/too large/i);
    await expect(validateImageBuffer(PNG_1X1, 'image/heic')).rejects.toThrow(/HEIC/i);
  });

  it('accepts real PNG and reports dimensions', async () => {
    const img = await validateImageBuffer(PNG_1X1, 'image/png');
    expect(img.mime).toBe('image/png');
    expect(img.width).toBe(1);
    expect(img.height).toBe(1);
  });
});

// Synthetic JPEG headers reproduce the previous spread-argument stack overflow.
it('rejects a large malformed JPEG through image validation rather than crashing the stack', async () => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xda, 0, 2]), Buffer.alloc(250_000), Buffer.from([0xff, 0xd9])]);
  await expect(validateImageBuffer(jpeg)).rejects.toThrow(/invalid|corrupt|image/i);
});

it('decodes large JPEGs and strips metadata for JPEG, PNG and WebP', async () => {
  const sharp = (await import('sharp')).default;
  const raw = Buffer.alloc(600 * 600 * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 113 + (i >> 8)) % 256;
  for (const format of ['jpeg', 'png', 'webp'] as const) {
    const input = await sharp(raw, { raw: { width: 600, height: 600, channels: 3 } }).toFormat(format, { quality: 100 }).withMetadata({ exif: { IFD0: { Artist: 'private-owner' } } }).toBuffer();
    const image = await validateImageBuffer(input);
    expect(image.width).toBe(600);
    expect(image.height).toBe(600);
    expect((await sharp(image.buffer).metadata()).exif).toBeUndefined();
    if (format === 'jpeg') expect(input.length).toBeGreaterThan(200_000);
  }
});

it('enforces the pixel limit for JPEG and WebP as well as PNG', async () => {
  const sharp = (await import('sharp')).default;
  for (const format of ['jpeg', 'png', 'webp'] as const) {
    const input = await sharp({ create: { width: 5000, height: 4001, channels: 3, background: 'white' } }).toFormat(format).toBuffer();
    await expect(validateImageBuffer(input)).rejects.toMatchObject({ code: 'TOO_MANY_PIXELS' });
  }
});
