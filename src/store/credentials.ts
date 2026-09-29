/**
 * credentials.ts — Admin credentials stored in `blog/data/admin.json`.
 *
 * New records use scrypt. Existing files written by the OpenResty version
 * (`{user, salt, data, setup_done}` with AES-256-CBC + EVP_BytesToKey) are
 * detected automatically and still verify, so an in-place upgrade does not lock
 * the owner out; a successful legacy login immediately re-hashes with scrypt.
 *
 * Recovery: set `BMY_ADMIN_PASS` (optionally with `BMY_ADMIN_USER`) and restart
 * to (re)initialise the account, or delete `blog/data/admin.json` to re-run the
 * first-run setup wizard.
 */
import path from 'node:path';
import { ADMIN_PASS, ADMIN_USER, DATA_DIR } from '../paths.ts';
import { JsonStore } from './json-store.ts';
import { hashPassword, verifyPassword, verifyLegacy, type PasswordRecord } from '../auth/password.ts';

export interface CredentialsFile {
  user: string;
  algo: 'scrypt' | 'legacy';
  /** scrypt salt (base64) */
  salt: string;
  /** scrypt hash (base64), when algo === 'scrypt' */
  hash?: string;
  /** legacy AES ciphertext (base64), when algo === 'legacy' */
  data?: string;
  setupDone: boolean;
  updatedAt: number;
}

function defaults(): CredentialsFile {
  return { user: ADMIN_USER, algo: 'scrypt', salt: '', hash: '', setupDone: false, updatedAt: 0 };
}

const store = new JsonStore<CredentialsFile>(path.join(DATA_DIR, 'admin.json'), defaults);

/** Normalise either on-disk shape into the internal representation. */
function normalise(raw: Record<string, unknown>): CredentialsFile {
  const base = defaults();
  const hasSetup = raw.setup_done === true || raw.setupDone === true;
  if (raw.hash) {
    return {
      user: String(raw.user ?? base.user),
      algo: 'scrypt',
      salt: String(raw.salt ?? ''),
      hash: String(raw.hash),
      setupDone: hasSetup,
      updatedAt: Number(raw.updatedAt ?? 0),
    };
  }
  if (raw.data) {
    return {
      user: String(raw.user ?? base.user),
      algo: 'legacy',
      salt: String(raw.salt ?? ''),
      data: String(raw.data),
      setupDone: hasSetup,
      updatedAt: Number(raw.updatedAt ?? 0),
    };
  }
  return { ...base, user: String(raw.user ?? base.user), setupDone: hasSetup };
}

function readRaw(): CredentialsFile {
  // JsonStore merges with defaults, which would drop `data`; read the raw file
  // shape first so legacy records survive.
  const merged = store.read() as CredentialsFile & { setup_done?: boolean };
  return normalise(merged as unknown as Record<string, unknown>);
}

let cached: CredentialsFile | null = null;
let cachedMtime = 0;

function current(): CredentialsFile {
  const merged = store.read() as CredentialsFile & { setup_done?: boolean };
  const normalized = normalise(merged as unknown as Record<string, unknown>);
  if (!cached || cachedMtime !== storeMtime()) {
    cached = normalized;
    cachedMtime = storeMtime();
  }
  return normalized;
}

function storeMtime(): number {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('node:fs').statSync(store.file).mtimeMs as number;
  } catch {
    return 0;
  }
}

export function isSetupDone(): boolean {
  const creds = readRaw();
  return creds.setupDone && (creds.algo === 'scrypt' ? creds.hash !== '' : creds.data !== '');
}

export function getUser(): string {
  return readRaw().user || ADMIN_USER;
}

/** Persist credentials using scrypt. */
export function setCredentials(user: string, password: string): CredentialsFile {
  const record: PasswordRecord = hashPassword(password);
  const next: CredentialsFile = {
    user,
    algo: 'scrypt',
    salt: record.salt,
    hash: record.hash,
    setupDone: true,
    updatedAt: Math.floor(Date.now() / 1000),
  };
  store.write(next);
  cached = null;
  cachedMtime = 0;
  return next;
}

export function clearCredentials(): void {
  store.reset();
  cached = null;
  cachedMtime = 0;
}

/**
 * Verify a username + password.
 * Legacy records are transparently upgraded to scrypt on success.
 */
export async function verifyCredentials(user: string, password: string): Promise<{ ok: boolean; upgraded: boolean }> {
  const creds = readRaw();
  if (!creds.setupDone || !password) return { ok: false, upgraded: false };

  // Username comparison is exact; the previous version compared it in Lua.
  if (creds.user && user !== creds.user) return { ok: false, upgraded: false };

  if (creds.algo === 'scrypt') {
    const ok = verifyPassword({ algo: 'scrypt', salt: creds.salt, hash: creds.hash ?? '' }, password);
    return { ok, upgraded: false };
  }

  const ok = await verifyLegacy({ salt: creds.salt, data: creds.data ?? '' }, password);
  if (!ok) return { ok: false, upgraded: false };

  setCredentials(creds.user, password);
  console.log('[credentials] legacy password record upgraded to scrypt');
  return { ok: true, upgraded: true };
}

/**
 * Which credential format is on disk. Used at startup to warn about legacy
 * records, whose verification is intentionally slow and depends on the
 * pre-rewrite KDF.
 */
export function credentialFormat(): 'scrypt' | 'legacy' | 'none' {
  const creds = readRaw();
  if (!creds.setupDone) return 'none';
  if (creds.algo === 'scrypt' && creds.hash) return 'scrypt';
  if (creds.algo === 'legacy' && creds.data) return 'legacy';
  return 'none';
}

/**
 * Bootstrap from the environment on startup.
 *
 * `BMY_ADMIN_PASS` only creates the account when none exists, so a password
 * changed through the admin UI is never silently reverted on restart. There is
 * intentionally no environment switch that overwrites an existing account —
 * use `npm run passwd-reset` for that.
 */
export function bootstrapFromEnv(): void {
  if (!ADMIN_PASS) return;
  if (isSetupDone()) return;

  setCredentials(ADMIN_USER, ADMIN_PASS);
  console.log(`[credentials] initialised admin account "${ADMIN_USER}" from BMY_ADMIN_PASS`);
}

export { store as credentialsStore };
