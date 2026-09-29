/**
 * imghost-config.ts — Image-host settings stored in `blog/data/imghost.json`.
 *
 * The JSON file keeps the original snake_case keys written by the OpenResty
 * version (the settings used to live in the `config` table under
 * `imghost_config`), so an existing deployment can be migrated by copying the
 * values across without a translation step.
 *
 * Two layers sit on top of the stored file and are deliberately kept apart:
 *
 *   1. `readImghostConfig()` merges the file over the defaults and then applies
 *      the `BMY_*` environment overrides. The result is what the upload code
 *      uses; it is never written back.
 *   2. `saveImghostConfig()` only ever persists what the admin form sent, so a
 *      deployment configured purely through environment variables keeps working
 *      when the form is saved with empty fields.
 *
 * Because the file holds an S3 secret it is created with mode 0600.
 */
import path from 'node:path';
import { DATA_DIR, IMGHOST } from '../paths.ts';
import { str } from '../lib/text.ts';
import { JsonStore } from './json-store.ts';

export interface ImghostConfig {
  /** Master switch; uploads are refused while this is false. */
  enabled: boolean;
  /** Storage backend: 'sftp' (legacy) or 's3' (MinIO / AWS / any S3 clone). */
  provider: 'sftp' | 's3';

  // ---- SFTP (provider = 'sftp') ----
  host: string;
  port: number;
  username: string;
  /** Path to the private key on the *server* filesystem. */
  ssh_key_path: string;
  /** Remote directory the templated filenames are written into. */
  remote_dir: string;

  // ---- S3 (provider = 's3') ----
  endpoint: string;
  bucket: string;
  access_key: string;
  secret_key: string;
  /** Optional; empty means 'us-east-1'. */
  region: string;
  /** Optional key prefix inside the bucket. */
  prefix: string;
  /** Skip TLS verification (self-signed certificates). */
  insecure: boolean;
  /** CA bundle used to verify the S3 server. */
  ssl_ca: string;
  /** Client certificate + private key for mutual TLS (must be set together). */
  ssl_cert: string;
  ssl_key: string;

  // ---- Common ----
  /** Base URL the uploaded objects are served from (CDN / web root). */
  public_url_base: string;
  /** Filename template; see `processFilenameTemplate` for the placeholders. */
  filename_template: string;
}

/** Default filename template — a date stamp plus the original extension. */
export const DEFAULT_FILENAME_TEMPLATE = '{yy}-{mm}-{dd}.{file_extension}';

/** Keys copied verbatim (string-to-string) out of the JSON file and the form. */
const STRING_FIELDS = [
  'host',
  'username',
  'ssh_key_path',
  'remote_dir',
  'endpoint',
  'bucket',
  'access_key',
  'secret_key',
  'region',
  'prefix',
  'ssl_ca',
  'ssl_cert',
  'ssl_key',
  'public_url_base',
  'filename_template',
] as const;

type StringField = (typeof STRING_FIELDS)[number];

function defaults(): ImghostConfig {
  return {
    enabled: false,
    provider: 'sftp',
    host: '',
    port: 22,
    username: '',
    ssh_key_path: '',
    remote_dir: '',
    endpoint: '',
    bucket: '',
    access_key: '',
    secret_key: '',
    region: '',
    prefix: '',
    insecure: false,
    ssl_ca: '',
    ssl_cert: '',
    ssl_key: '',
    public_url_base: '',
    filename_template: DEFAULT_FILENAME_TEMPLATE,
  };
}

export const imghostConfigStore = new JsonStore<ImghostConfig>(
  path.join(DATA_DIR, 'imghost.json'),
  defaults,
);

/**
 * Read the stored settings and re-coerce every field.
 *
 * `JsonStore` already merges the file over the defaults, but the file can be
 * hand-edited (or written by the Lua version, which stored a JSON string), so
 * the types are not trusted: a stray string port or a `"true"` boolean must not
 * leak into the upload code.
 */
function fromFile(): ImghostConfig {
  const raw = imghostConfigStore.read() as unknown as Record<string, unknown>;
  const base = defaults();
  const config: ImghostConfig = { ...base };

  for (const field of STRING_FIELDS) {
    config[field] = str(raw[field]);
  }

  const port = Number(raw.port);
  config.port = Number.isFinite(port) && port > 0 ? Math.trunc(port) : base.port;
  config.enabled = raw.enabled === true;
  config.insecure = raw.insecure === true;
  config.provider = raw.provider === 's3' ? 's3' : 'sftp';
  return config;
}

/** S3 environment variables → config fields (Lua `apply_env_overrides`). */
const S3_ENV_MAP: ReadonlyArray<readonly [StringField, string]> = [
  ['endpoint', IMGHOST.s3.endpoint],
  ['bucket', IMGHOST.s3.bucket],
  ['access_key', IMGHOST.s3.accessKey],
  ['secret_key', IMGHOST.s3.secretKey],
  ['region', IMGHOST.s3.region],
  ['prefix', IMGHOST.s3.prefix],
  ['public_url_base', IMGHOST.s3.publicUrlBase],
  ['ssl_ca', IMGHOST.s3.sslCa],
  ['ssl_cert', IMGHOST.s3.sslCert],
  ['ssl_key', IMGHOST.s3.sslKey],
];

/**
 * Apply deploy-time overrides. `BMY_IMGHOST_PROVIDER` selects *and* enables a
 * provider; non-empty `BMY_S3_*` values replace the stored ones; a complete set
 * of S3 credentials enables S3 on its own so a container can be configured
 * without ever touching the settings page.
 */
function applyEnvOverrides(stored: ImghostConfig): ImghostConfig {
  const config: ImghostConfig = { ...stored };

  const provider = IMGHOST.provider;
  if (provider === 'sftp' || provider === 's3') {
    config.enabled = true;
    config.provider = provider;
  }

  for (const [field, value] of S3_ENV_MAP) {
    if (value !== '') config[field] = value;
  }

  // IMGHOST.s3.insecure cannot distinguish "unset" from "false", so only apply
  // it when the raw variable is actually present — otherwise a stored
  // insecure=true would be silently reset by an unrelated deployment.
  const insecureRaw = process.env.BMY_S3_INSECURE;
  if (insecureRaw !== undefined && insecureRaw !== '') {
    config.insecure = IMGHOST.s3.insecure;
  }

  if (
    config.provider === 's3' &&
    config.endpoint !== '' &&
    config.bucket !== '' &&
    config.access_key !== '' &&
    config.secret_key !== ''
  ) {
    config.enabled = true;
  }

  return config;
}

/** Effective configuration: file merged over defaults, then env overrides. */
export function readImghostConfig(): ImghostConfig {
  return applyEnvOverrides(fromFile());
}

/**
 * Validate, normalise and persist a settings payload.
 *
 * The payload is treated as the complete configuration (exactly like the
 * admin API of the old implementation), with one exception: an empty or masked
 * `secret_key` keeps the stored secret so the browser never has to round-trip
 * it. Validation only runs when the host is enabled — a half-filled form can be
 * parked without being rejected.
 */
export function saveImghostConfig(
  input: Partial<ImghostConfig>,
): { ok: true; config: ImghostConfig } | { ok: false; error: string } {
  const stored = fromFile();
  const config: ImghostConfig = { ...stored };

  // Whitelist: unknown keys in the request body are dropped, missing string
  // fields become '' (the Lua `data.x or ""` behaviour).
  for (const field of STRING_FIELDS) {
    config[field] = str(input[field]);
  }

  const port = Number(input.port);
  config.port = Number.isFinite(port) && port > 0 ? Math.trunc(port) : 22;
  config.enabled = input.enabled === true;
  config.insecure = input.insecure === true;
  config.provider = input.provider === 's3' ? 's3' : 'sftp';

  // The form shows a masked placeholder; keep the real secret behind it.
  if (config.secret_key === '' || config.secret_key === '********') {
    config.secret_key = stored.secret_key;
  }

  if (config.filename_template === '') {
    config.filename_template = DEFAULT_FILENAME_TEMPLATE;
  }

  if (config.enabled) {
    if (config.provider === 's3') {
      if (config.endpoint === '') return { ok: false, error: 'S3 Endpoint 不能为空' };
      if (config.bucket === '') return { ok: false, error: 'S3 Bucket 不能为空' };
      if (config.access_key === '') return { ok: false, error: 'S3 Access Key 不能为空' };
      if (config.secret_key === '') return { ok: false, error: 'S3 Secret Key 不能为空' };

      const hasCert = config.ssl_cert !== '';
      const hasKey = config.ssl_key !== '';
      if (hasCert !== hasKey) {
        return { ok: false, error: 'S3 客户端证书与私钥需同时提供（双向 TLS）' };
      }
    } else {
      if (config.host === '') return { ok: false, error: 'SFTP 主机地址不能为空' };
      if (config.username === '') return { ok: false, error: '用户名不能为空' };
      if (config.ssh_key_path === '') return { ok: false, error: 'SSH 密钥路径不能为空' };
      if (config.remote_dir === '') return { ok: false, error: '远程目录不能为空' };
      if (config.public_url_base === '') return { ok: false, error: '公开 URL 基址不能为空' };
    }
  }

  imghostConfigStore.write(config);
  return { ok: true, config };
}

/** Copy of the config with the S3 secret replaced by the UI placeholder. */
export function maskImghostConfig(config: ImghostConfig): ImghostConfig {
  const masked: ImghostConfig = { ...config };
  if (masked.secret_key !== '') masked.secret_key = '********';
  return masked;
}
