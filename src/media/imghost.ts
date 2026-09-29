/**
 * imghost.ts — Upload files to the configured image host (SFTP or S3).
 *
 * The OpenResty version shelled out to `scp`, `ssh`, `mc` and a Python/boto3
 * helper. The rewrite talks to the storage directly through `ssh2-sftp-client`
 * and `@aws-sdk/client-s3`, which removes the external binaries (and the
 * credential files they needed) from the runtime image.
 *
 * Everything here fails with a short, human-readable Chinese message: callers
 * are HTTP handlers that put the string straight into an API response, so an
 * error object (let alone a stack trace) must never escape.
 */
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  DEFAULT_FILENAME_TEMPLATE,
  readImghostConfig,
  type ImghostConfig,
} from '../store/imghost-config.ts';

// ---------------------------------------------------------------------------
// ssh2-sftp-client has no type declarations and no `@types` package is
// installed, so it is loaded through createRequire with a local structural type
// describing only the handful of methods used here.
// ---------------------------------------------------------------------------

interface SftpClientLike {
  connect(options: Record<string, unknown>): Promise<unknown>;
  put(localPath: string, remotePath: string, options?: Record<string, unknown>): Promise<unknown>;
  list(remotePath: string): Promise<unknown>;
  mkdir(remotePath: string, recursive?: boolean): Promise<unknown>;
  exists(remotePath: string): Promise<string | false>;
  delete(remotePath: string, notFoundOK?: boolean): Promise<unknown>;
  end(): Promise<unknown>;
}

const nodeRequire = createRequire(import.meta.url);
let sftpCtor: (new () => SftpClientLike) | null = null;

/** Lazily load the SFTP client so S3-only deployments never pay for it. */
function sftpConstructor(): new () => SftpClientLike {
  if (!sftpCtor) {
    sftpCtor = nodeRequire('ssh2-sftp-client') as new () => SftpClientLike;
  }
  return sftpCtor;
}

/** Collapse an unknown thrown value into a single-line message. */
function errMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  const oneLine = raw.replace(/\s+/g, ' ').trim();
  return oneLine === '' ? '未知错误' : oneLine;
}

/**
 * Check the local file up front.
 *
 * `createReadStream` reports a missing file asynchronously, which the AWS SDK
 * turns into an unrecognisable header error; SSH clients are no better. A
 * synchronous access check gives the operator a plain ENOENT message instead.
 */
function assertReadable(localPath: string): void {
  try {
    fs.accessSync(localPath, fs.constants.R_OK);
  } catch (err) {
    throw new Error(`无法读取本地文件: ${errMessage(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Effective image-host configuration (file + environment overrides). */
export async function getImghostConfig(): Promise<ImghostConfig> {
  return readImghostConfig();
}

/**
 * Whether uploads should be attempted at all.
 *
 * This is intentionally just the stored flag: a settings page that saves an
 * incomplete configuration is still "enabled" and will produce a precise error
 * on the first upload, which is more useful than silently pretending to be off.
 */
export function isEnabled(config: ImghostConfig): boolean {
  return config.enabled === true;
}

// ---------------------------------------------------------------------------
// Key / URL building
// ---------------------------------------------------------------------------

/**
 * Render a filename template.
 *
 * Placeholders: `{yy}` `{mm}` `{dd}` (2-digit local date), `{file_extension}`
 * and `{original}` (client filename without its extension). Substitution order
 * matters: `{original}` is expanded *before* path separators are neutralised,
 * so a crafted upload name such as `../../etc/passwd` cannot escape the target
 * directory.
 */
export function processFilenameTemplate(template: string, originalBase: string, ext: string): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');

  const rendered = template
    .replaceAll('{yy}', pad(now.getFullYear() % 100))
    .replaceAll('{mm}', pad(now.getMonth() + 1))
    .replaceAll('{dd}', pad(now.getDate()))
    .replaceAll('{file_extension}', ext)
    .replaceAll('{original}', originalBase || 'image');

  return rendered.replace(/[/\\]/g, '_');
}

/**
 * Templates containing `{original}` derive the name from the uploaded file
 * itself, so two different uploads normally land on different names.
 * Date/extension-only templates (including the default) render the *same* name
 * for every upload on a given day, which is why those get a random suffix.
 */
function hasPerUploadUniqueness(template: string): boolean {
  return template.includes('{original}');
}

/** Insert a short random token before the extension: `250812.png` → `250812-9f3a1c.png`. */
function addRandomSuffix(filename: string, bytes = 3): string {
  const suffix = randomBytes(bytes).toString('hex');
  const dot = filename.lastIndexOf('.');
  if (dot > 0) return `${filename.slice(0, dot)}-${suffix}${filename.slice(dot)}`;
  return `${filename}-${suffix}`;
}

/**
 * Build the object key (S3) / remote path (SFTP) for an upload.
 *
 * Deliberate improvement over the original implementation: the old code mapped
 * every upload of the same file type on the same day onto one key, so the
 * second upload silently replaced the first. Templated names that carry no
 * per-upload uniqueness now get a short random suffix.
 */
export function buildKey(
  config: ImghostConfig,
  originalFilename: string,
): { key: string; filename: string } {
  const original = typeof originalFilename === 'string' ? originalFilename : '';

  // Extension = text after the last dot (Lua pattern `%.[^%.]+$`), 'png' when
  // the client sent no extension at all.
  const extMatch = /\.([^.]+)$/.exec(original);
  const ext = (extMatch?.[1] ?? '').toLowerCase() || 'png';
  const base = (extMatch ? original.slice(0, extMatch.index) : original) || 'image';

  const template = config.filename_template || DEFAULT_FILENAME_TEMPLATE;
  let filename = processFilenameTemplate(template, base, ext);
  if (filename === '') filename = `image.${ext}`;
  if (!hasPerUploadUniqueness(template)) filename = addRandomSuffix(filename);

  if (config.provider === 's3') {
    const prefix = (config.prefix || '').replace(/^\/+/, '').replace(/\/+$/, '');
    return { key: prefix === '' ? filename : `${prefix}/${filename}`, filename };
  }

  const remoteDir = (config.remote_dir || '').replace(/\/+$/, '');
  return { key: remoteDir === '' ? filename : `${remoteDir}/${filename}`, filename };
}

/** Strip trailing slashes, prefix `https://` when the endpoint has no scheme. */
function normaliseEndpoint(endpoint: string): string {
  const trimmed = (endpoint || '').replace(/\/+$/, '');
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/**
 * Public URL of an uploaded object.
 *
 * With a `public_url_base` the SFTP variant uses the bare filename only, which
 * is what the original `scp` implementation returned (`<base>/<filename>`, the
 * remote directory is not part of the public path).
 */
export function publicUrl(config: ImghostConfig, key: string, filename: string): string {
  const base = (config.public_url_base || '').replace(/\/+$/, '');
  if (base !== '') {
    const name = config.provider === 's3' ? key : path.posix.basename(filename || key);
    return `${base}/${name}`;
  }

  if (config.provider === 's3') {
    const endpoint = normaliseEndpoint(config.endpoint);
    return `${endpoint}/${config.bucket}/${key}`;
  }

  return key;
}

// ---------------------------------------------------------------------------
// S3 helpers
// ---------------------------------------------------------------------------

const MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  ico: 'image/x-icon',
};

function contentTypeFor(name: string): string {
  const ext = (/\.([^.]+)$/.exec(name)?.[1] ?? '').toLowerCase();
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}

/**
 * Create an S3 client for the configured endpoint.
 *
 * `forcePathStyle` is mandatory for MinIO and most self-hosted gateways, which
 * cannot serve virtual-host-style buckets. TLS options are only attached when
 * something is configured, so the default SDK behaviour (and its connection
 * pooling) is kept for plain deployments.
 */
function createS3Client(config: ImghostConfig): S3Client {
  const tls: https.AgentOptions = {};
  if (config.insecure) tls.rejectUnauthorized = false;
  if (config.ssl_ca !== '') tls.ca = fs.readFileSync(config.ssl_ca);
  if (config.ssl_cert !== '' && config.ssl_key !== '') {
    tls.cert = fs.readFileSync(config.ssl_cert);
    tls.key = fs.readFileSync(config.ssl_key);
  }

  const options: ConstructorParameters<typeof S3Client>[0] = {
    endpoint: config.endpoint,
    region: config.region || 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.access_key,
      secretAccessKey: config.secret_key,
    },
  };

  if (Object.keys(tls).length > 0) {
    options.requestHandler = { httpsAgent: new https.Agent(tls) };
  }

  return new S3Client(options);
}

/** Upload a local file to S3. Throws a readable Error on any failure. */
async function putS3(
  config: ImghostConfig,
  localPath: string,
  key: string,
  originalName: string,
): Promise<void> {
  let client: S3Client | null = null;
  try {
    assertReadable(localPath);
    client = createS3Client(config);
    await client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: key.replace(/^\/+/, ''), // S3 keys are always relative
        Body: fs.createReadStream(localPath),
        ContentType: contentTypeFor(originalName || key),
      }),
    );
  } catch (err) {
    throw new Error(`S3 上传失败: ${errMessage(err)}`);
  } finally {
    client?.destroy();
  }
}

// ---------------------------------------------------------------------------
// SFTP helpers
// ---------------------------------------------------------------------------

/** Open an SFTP connection using the configured private key. */
async function connectSftp(config: ImghostConfig): Promise<SftpClientLike> {
  const Ctor = sftpConstructor();
  const client = new Ctor();

  let privateKey: Buffer;
  try {
    privateKey = fs.readFileSync(config.ssh_key_path);
  } catch (err) {
    throw new Error(`无法读取 SSH 密钥: ${errMessage(err)}`);
  }

  try {
    await client.connect({
      host: config.host,
      port: config.port,
      username: config.username,
      privateKey,
      readyTimeout: 15_000,
    });
  } catch (err) {
    await closeQuietly(client);
    throw err;
  }

  return client;
}

/** Best-effort disconnect; a dead connection must not mask the real error. */
async function closeQuietly(client: SftpClientLike | null): Promise<void> {
  if (!client) return;
  try {
    await client.end();
  } catch {
    /* nothing left to close */
  }
}

/** Create a remote directory (and its parents) when it does not exist yet. */
async function ensureRemoteDir(client: SftpClientLike, dir: string): Promise<void> {
  const target = (dir || '').replace(/\/+$/, '');
  if (target === '' || target === '.') return;
  const existing = await client.exists(target);
  if (existing === false) await client.mkdir(target, true);
}

/** Upload a local file over SFTP. Throws a readable Error on any failure. */
async function putSftp(
  config: ImghostConfig,
  localPath: string,
  key: string,
): Promise<void> {
  let client: SftpClientLike | null = null;
  try {
    assertReadable(localPath);
    client = await connectSftp(config);

    // Collapse duplicate slashes the way the original scp command did.
    const remotePath = key.replace(/\/{2,}/g, '/');
    await ensureRemoteDir(client, config.remote_dir);
    // Explicit keys (avatars) can point at a subdirectory of remote_dir.
    await ensureRemoteDir(client, path.posix.dirname(remotePath));
    await client.put(localPath, remotePath);
  } catch (err) {
    throw new Error(`SFTP 上传失败: ${errMessage(err)}`);
  } finally {
    await closeQuietly(client);
  }
}

/** Route a file to the configured provider. */
async function putObject(
  config: ImghostConfig,
  localPath: string,
  key: string,
  originalName: string,
): Promise<void> {
  if (config.provider === 's3') {
    await putS3(config, localPath, key, originalName);
    return;
  }
  await putSftp(config, localPath, key);
}

// ---------------------------------------------------------------------------
// Upload / delete / test
// ---------------------------------------------------------------------------

/**
 * Upload a file, deriving the object key from the original filename template.
 * Returns the public URL plus the key so callers can store or delete it later.
 */
export async function upload(
  localPath: string,
  originalFilename: string,
): Promise<{ url: string; key: string }> {
  const config = readImghostConfig();
  if (!isEnabled(config)) throw new Error('图床未启用，请先在设置中配置');

  const { key, filename } = buildKey(config, originalFilename);
  await putObject(config, localPath, key, originalFilename);
  return { url: publicUrl(config, key, filename), key };
}

/**
 * Upload a file under an explicit key (avatars use `avatars/<file>.webp`).
 *
 * The key is used verbatim — it is not decorated with `prefix`/`remote_dir`,
 * matching the original `upload_key` helper — and the public URL is returned.
 */
export async function uploadKey(
  localPath: string,
  key: string,
  originalFilename?: string,
): Promise<string> {
  const config = readImghostConfig();
  if (!isEnabled(config)) throw new Error('图床未启用，请先在设置中配置');

  // S3 keys are always relative; an SFTP key may legitimately be absolute.
  const explicitKey = config.provider === 's3' ? key.replace(/^\/+/, '') : key;
  await putObject(config, localPath, explicitKey, originalFilename ?? explicitKey);
  return publicUrl(config, explicitKey, path.posix.basename(explicitKey));
}

/** Probe the configured storage. Never throws. */
export async function testConnection(): Promise<{ ok: boolean; message: string }> {
  const config = readImghostConfig();

  if (config.provider === 's3') {
    if (config.bucket === '') return { ok: false, message: '未配置 Bucket' };
    let client: S3Client | null = null;
    try {
      client = createS3Client(config);
      // Listing one key both authenticates and proves the bucket is reachable;
      // it also works on gateways that refuse HeadBucket for restricted keys.
      await client.send(new ListObjectsV2Command({ Bucket: config.bucket, MaxKeys: 1 }));
      return { ok: true, message: `S3 连接成功: ${config.endpoint}/${config.bucket}` };
    } catch (err) {
      return { ok: false, message: `S3 连接测试失败: ${errMessage(err)}` };
    } finally {
      client?.destroy();
    }
  }

  if (config.host === '') return { ok: false, message: '未配置主机地址' };

  let client: SftpClientLike | null = null;
  try {
    client = await connectSftp(config);
    await client.list(config.remote_dir === '' ? '.' : config.remote_dir);
    return { ok: true, message: `连接成功: ${config.host}` };
  } catch (err) {
    return { ok: false, message: `连接测试失败: ${errMessage(err)}` };
  } finally {
    await closeQuietly(client);
  }
}

/**
 * Delete an object by key. Returns false (and logs) instead of throwing, since
 * deletion is usually a cleanup step that must not fail the surrounding action.
 */
export async function deleteObject(key: string): Promise<boolean> {
  const config = readImghostConfig();

  try {
    if (config.provider === 's3') {
      let client: S3Client | null = null;
      try {
        client = createS3Client(config);
        await client.send(
          new DeleteObjectCommand({ Bucket: config.bucket, Key: key.replace(/^\/+/, '') }),
        );
      } finally {
        client?.destroy();
      }
      return true;
    }

    let client: SftpClientLike | null = null;
    try {
      client = await connectSftp(config);
      // No leading-slash stripping here: remote_dir is often absolute.
      await client.delete(key.replace(/\/{2,}/g, '/'), true);
    } finally {
      await closeQuietly(client);
    }
    return true;
  } catch (err) {
    console.warn(`[imghost] 删除失败 (${key}): ${errMessage(err)}`);
    return false;
  }
}
