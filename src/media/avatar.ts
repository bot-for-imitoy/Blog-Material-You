/**
 * avatar.ts — Comment avatar processing.
 *
 * The original implementation piped uploads through ImageMagick
 * (`convert <tmp> -resize 512x512^ -gravity center -extent 512x512 out.webp`)
 * and a shell `mkdir`. ImageMagick is gone from the image, so sharp does the
 * same job in-process: cover-resize to a square and re-encode as WebP.
 */
import path from 'node:path';
import { createHmac } from 'node:crypto';
import sharp from 'sharp';
import { AVATARS_DIR, ensureDir } from '../paths.ts';
import { getImghostConfig, isEnabled, uploadKey } from './imghost.ts';

/** Minimum plausible image size; below this the payload is certainly not an image. */
const MIN_BYTES = 100;
/** Matches the request-body limit advertised by the upload endpoint. */
const MAX_BYTES = 5 * 1024 * 1024;
/** Avatars are always stored as 512x512 squares. */
const AVATAR_SIZE = 512;

export interface AvatarResult {
  /** Bare file name, e.g. `Ab3dEf12Gh_9klMn.webp`. */
  filename: string;
  /** Absolute path of the written file. */
  filePath: string;
  /** Local URL under the static tree. */
  url: string;
}

/**
 * Build the avatar file name.
 *
 * Kept from the original: HMAC-SHA1 of the current timestamp keyed with
 * `avatar-salt`, standard base64 made URL-safe (`/`→`_`, `+`→`-`, padding
 * stripped) and truncated to 16 characters. Hashing the timestamp means the
 * name is unguessable and free of user input, while still being deterministic
 * for a given instant — handy when correlating logs.
 */
function avatarFilename(): string {
  const digest = createHmac('sha1', 'avatar-salt').update(String(Date.now())).digest('base64');
  const safe = digest.replace(/\//g, '_').replace(/\+/g, '-').replace(/=/g, '').slice(0, 16);
  return `${safe}.webp`;
}

/**
 * Resize an uploaded image to 512x512 WebP and store it under `blog/public/avatars`.
 *
 * `fit: 'cover'` + `position: 'centre'` is the sharp equivalent of
 * `-resize 512x512^ -gravity center -extent 512x512`: the image fills the box
 * (upscaling small uploads, like ImageMagick does), is centre-cropped to a
 * square and never distorted.
 */
export async function processAvatar(buffer: Buffer): Promise<AvatarResult> {
  if (!buffer || buffer.length < MIN_BYTES) throw new Error('无效的图片数据');
  if (buffer.length > MAX_BYTES) throw new Error('图片太大，最大5MB');

  ensureDir(AVATARS_DIR);

  const filename = avatarFilename();
  const filePath = path.join(AVATARS_DIR, filename);

  try {
    await sharp(buffer)
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'centre' })
      .webp()
      .toFile(filePath);
  } catch (err) {
    // sharp reports decode/format problems in its own message; re-wrap it so
    // callers never have to interpret a raw sharp error (or see a stack).
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`图片处理失败: ${reason}`);
  }

  return { filename, filePath, url: `/avatars/${filename}` };
}

/**
 * Mirror a freshly written avatar to the image host.
 *
 * Distributed deployments serve avatars from S3 so every instance sees the same
 * file; local dev and SFTP setups keep serving them from disk. Mirroring is
 * strictly best effort: a failure logs a warning and returns `null` so the
 * caller falls back to the local URL instead of failing the upload.
 */
export async function mirrorToImghost(filePath: string, filename: string): Promise<string | null> {
  try {
    const config = await getImghostConfig();
    if (!isEnabled(config) || config.provider !== 's3') return null;
    return await uploadKey(filePath, `avatars/${filename}`, filename);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[avatar] 上传到头像图床失败，使用本地文件: ${reason}`);
    return null;
  }
}
