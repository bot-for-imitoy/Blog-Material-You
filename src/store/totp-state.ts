/**
 * totp-state.ts — Persisted 2FA state in `blog/data/totp.json`.
 *
 * Shape: `{ enabled, secret, pendingSecret, updatedAt }`.
 * `pendingSecret` holds the not-yet-confirmed secret during enrollment, so
 * enabling 2FA requires proving the authenticator works before it takes effect.
 */
import path from 'node:path';
import { DATA_DIR } from '../paths.ts';
import { JsonStore } from './json-store.ts';

export interface TotpState {
  enabled: boolean;
  secret: string;
  pendingSecret: string;
  updatedAt: number;
}

function defaults(): TotpState {
  return { enabled: false, secret: '', pendingSecret: '', updatedAt: 0 };
}

const store = new JsonStore<TotpState>(path.join(DATA_DIR, 'totp.json'), defaults);

export function readTotpState(): TotpState {
  return store.read();
}

export function isTotpEnabled(): boolean {
  const state = store.read();
  return state.enabled === true && state.secret !== '';
}

/** The secret used to verify logins (empty when 2FA is off). */
export function getActiveSecret(): string {
  const state = store.read();
  return state.enabled ? state.secret : '';
}

export function getPendingSecret(): string {
  return store.read().pendingSecret;
}

/** Store a freshly generated secret awaiting confirmation. */
export function startEnable(secret: string): TotpState {
  return store.update((state) => ({ ...state, pendingSecret: secret, updatedAt: now() }));
}

/** Promote the pending secret to active. */
export function confirmEnable(): { ok: boolean; error?: string } {
  const state = store.read();
  if (!state.pendingSecret) return { ok: false, error: 'No pending secret' };
  store.write({ enabled: true, secret: state.pendingSecret, pendingSecret: '', updatedAt: now() });
  return { ok: true };
}

/** Disable 2FA and forget both secrets. */
export function disable(): TotpState {
  return store.write({ enabled: false, secret: '', pendingSecret: '', updatedAt: now() });
}

function now(): number {
  return Math.floor(Date.now() / 1000);
}

export { store as totpStore };
