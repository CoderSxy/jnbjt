import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_PIXELS = 20_000_000;

export type ValidatedImage = {
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  buffer: Buffer;
  width: number | null;
  height: number | null;
  contentHash: string;
};

function sniffMime(buf: Buffer): ValidatedImage['mime'] | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return 'image/png';
  }
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

function readPngSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Strip common JPEG APP1 (EXIF) marker by rewriting without APP segments — best-effort. */
function stripJpegExif(buf: Buffer): Buffer {
  if (sniffMime(buf) !== 'image/jpeg') return buf;
  // Keep SOI and scan for SOS; drop APP0-APP15 between.
  const out: number[] = [0xff, 0xd8];
  let i = 2;
  while (i + 3 < buf.length) {
    if (buf[i] !== 0xff) break;
    const marker = buf[i + 1]!;
    if (marker === 0xd9 || marker === 0xda) {
      out.push(...buf.subarray(i));
      return Buffer.from(out);
    }
    const size = buf.readUInt16BE(i + 2);
    if (marker >= 0xe1 && marker <= 0xef) {
      i += 2 + size;
      continue;
    }
    out.push(...buf.subarray(i, i + 2 + size));
    i += 2 + size;
  }
  return buf;
}

export function validateImageBuffer(buf: Buffer, declaredMime?: string): ValidatedImage {
  if (buf.byteLength > MAX_UPLOAD_BYTES) {
    throw Object.assign(new Error('file too large'), { code: 'TOO_LARGE' });
  }
  if (/heic|heif/i.test(declaredMime ?? '')) {
    throw Object.assign(new Error('HEIC not supported; convert to JPEG/PNG/WebP first'), {
      code: 'HEIC',
    });
  }
  const mime = sniffMime(buf);
  if (!mime) {
    throw Object.assign(new Error('unsupported or spoofed image type'), { code: 'BAD_TYPE' });
  }
  let width: number | null = null;
  let height: number | null = null;
  if (mime === 'image/png') {
    const size = readPngSize(buf);
    width = size?.width ?? null;
    height = size?.height ?? null;
    if (width && height && width * height > MAX_PIXELS) {
      throw Object.assign(new Error('too many pixels'), { code: 'TOO_MANY_PIXELS' });
    }
  }
  const cleaned = mime === 'image/jpeg' ? stripJpegExif(buf) : buf;
  return {
    mime,
    buffer: cleaned,
    width,
    height,
    contentHash: createHash('sha256').update(cleaned).digest('hex'),
  };
}

export function uploadsRoot(): string {
  return resolve(process.env.UPLOADS_DIR ?? join(process.cwd(), 'data', 'uploads'));
}

export async function storeUpload(userId: string, image: ValidatedImage): Promise<string> {
  const id = randomUUID();
  const ext = image.mime === 'image/png' ? 'png' : image.mime === 'image/webp' ? 'webp' : 'jpg';
  const storagePath = join(uploadsRoot(), userId, `${id}.${ext}`);
  await mkdir(dirname(storagePath), { recursive: true });
  await writeFile(storagePath, image.buffer);
  return storagePath;
}
