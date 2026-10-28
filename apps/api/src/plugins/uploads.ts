import sharp from 'sharp';
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

export async function validateImageBuffer(buf: Buffer, declaredMime?: string): Promise<ValidatedImage> {
  if (buf.byteLength > MAX_UPLOAD_BYTES) {
    throw Object.assign(new Error('file too large'), { code: 'TOO_LARGE' });
  }
  if (/heic|heif/i.test(declaredMime ?? '')) {
    throw Object.assign(new Error('HEIC not supported; convert to JPEG/PNG/WebP first'), { code: 'HEIC' });
  }
  try {
    const image = sharp(buf, { limitInputPixels: MAX_PIXELS, animated: true });
    const metadata = await image.metadata();
    const mime = ({ jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } as Record<string, string>)[metadata.format ?? ''];
    if (!mime || !metadata.width || !metadata.height || (metadata.pages ?? 1) > 1) {
      throw new Error('unsupported or spoofed image type');
    }
    if (metadata.width * metadata.height > MAX_PIXELS) throw new Error('too many pixels');
    if (declaredMime?.startsWith('image/') && declaredMime !== mime) throw new Error('spoofed image type');
    // Decoding verifies the complete image. Re-encoding removes EXIF, XMP and other metadata.
    const cleaned = await image.rotate().toBuffer({ resolveWithObject: true });
    return {
      mime: mime as ValidatedImage['mime'], buffer: cleaned.data,
      width: cleaned.info.width, height: cleaned.info.height,
      contentHash: createHash('sha256').update(cleaned.data).digest('hex'),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw Object.assign(new Error(`invalid image: ${message}`), {
      code: /pixel/i.test(message) ? 'TOO_MANY_PIXELS' : 'BAD_TYPE',
    });
  }
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
