/**
 * visitors.ts — Visitor (non-admin) identities and permissions.
 *
 * Replaces the `emails` / `pending_registrations` tables with
 * `blog/data/visitors.json`:
 *   { emails: { "<email>": { permissions: [], name, createdAt } },
 *     pending: [ { email, name, createdAt } ] }
 *
 * Legacy files (`data/auth/emails.json`, `data/auth/pending.json`) are imported
 * automatically the first time this store is read, so nothing is lost when
 * upgrading.
 */
import fs from 'node:fs';
import path from 'node:path';
import { BLOG_DIR, DATA_DIR } from '../paths.ts';
import { str } from '../lib/text.ts';
import { JsonStore } from './json-store.ts';

export interface Visitor {
  email: string;
  name: string;
  permissions: string[];
  createdAt: number;
}

export interface PendingVisitor {
  email: string;
  name: string;
  createdAt: number;
}

export interface VisitorsFile {
  emails: Record<string, { permissions: string[]; name?: string; createdAt: number }>;
  pending: PendingVisitor[];
}

/** Every permission the app understands. */
export const PERMISSIONS = ['calendar'] as const;

function defaults(): VisitorsFile {
  return { emails: {}, pending: [] };
}

const store = new JsonStore<VisitorsFile>(path.join(DATA_DIR, 'visitors.json'), defaults);

let migrationChecked = false;

/** Import legacy `data/auth/*.json` files once. */
function migrateLegacy(): void {
  if (migrationChecked) return;
  migrationChecked = true;
  if (store.exists()) return;

  const legacyEmails = path.join(BLOG_DIR, 'data', 'auth', 'emails.json');
  const legacyPending = path.join(BLOG_DIR, 'data', 'auth', 'pending.json');
  if (!fs.existsSync(legacyEmails) && !fs.existsSync(legacyPending)) return;

  const next = defaults();
  try {
    const raw = JSON.parse(fs.readFileSync(legacyEmails, 'utf8')) as Record<
      string,
      { permissions?: unknown; created_at?: unknown; createdAt?: unknown; name?: unknown }
    >;
    for (const [email, value] of Object.entries(raw)) {
      next.emails[email.toLowerCase()] = {
        permissions: Array.isArray(value.permissions) ? value.permissions.map((p) => str(p)) : [],
        name: str(value.name),
        createdAt: Number(value.created_at ?? value.createdAt) || Math.floor(Date.now() / 1000),
      };
    }
  } catch (err) {
    console.warn('[visitors] could not import legacy emails.json:', (err as Error).message);
  }

  try {
    const raw = JSON.parse(fs.readFileSync(legacyPending, 'utf8')) as Array<{
      email?: unknown;
      name?: unknown;
      time?: unknown;
      created_at?: unknown;
    }>;
    for (const item of raw) {
      const email = str(item.email).toLowerCase();
      if (!email) continue;
      next.pending.push({
        email,
        name: str(item.name),
        createdAt: Number(item.created_at ?? item.time) || Math.floor(Date.now() / 1000),
      });
    }
  } catch {
    /* no legacy pending file */
  }

  if (Object.keys(next.emails).length > 0 || next.pending.length > 0) {
    store.write(next);
    console.log('[visitors] imported legacy visitor data into blog/data/visitors.json');
  }
}

function read(): VisitorsFile {
  migrateLegacy();
  const data = store.read();
  return { emails: data.emails ?? {}, pending: data.pending ?? [] };
}

/** Normalise an email the same way the previous implementation did. */
export function normaliseEmail(value: unknown): string {
  return str(value).toLowerCase();
}

/** Loose email shape check (mirrors the original regex). */
export function isValidEmail(email: string): boolean {
  return /^[^@]+@[^@]+\.[^@]+$/.test(email);
}

export function listVisitors(): Visitor[] {
  const { emails } = read();
  return Object.entries(emails)
    .map(([email, value]) => ({
      email,
      name: str(value.name),
      permissions: Array.isArray(value.permissions) ? value.permissions : [],
      createdAt: value.createdAt ?? 0,
    }))
    .sort((a, b) => a.email.localeCompare(b.email));
}

export function getVisitor(email: string): Visitor | null {
  const key = normaliseEmail(email);
  return listVisitors().find((v) => v.email === key) ?? null;
}

export function isRegistered(email: string): boolean {
  return getVisitor(email) !== null;
}

export function hasPermission(email: string, permission: string): boolean {
  const visitor = getVisitor(email);
  return visitor !== null && visitor.permissions.includes(permission);
}

export function permissionsOf(email: string): string[] {
  return getVisitor(email)?.permissions ?? [];
}

export function setVisitor(email: string, permissions: string[], name = ''): Visitor {
  const key = normaliseEmail(email);
  const next = read();
  const existing = next.emails[key];
  next.emails[key] = {
    permissions: permissions.map((p) => str(p)).filter(Boolean),
    name: name || existing?.name || '',
    createdAt: existing?.createdAt ?? Math.floor(Date.now() / 1000),
  };
  store.write(next);
  return getVisitor(key)!;
}

export function removeVisitor(email: string): boolean {
  const key = normaliseEmail(email);
  const next = read();
  if (!next.emails[key]) return false;
  delete next.emails[key];
  store.write(next);
  return true;
}

export function listPending(): PendingVisitor[] {
  return read().pending.slice().sort((a, b) => a.createdAt - b.createdAt);
}

export function addPending(email: string, name = ''): { ok: boolean; error?: string } {
  const key = normaliseEmail(email);
  const next = read();
  if (next.emails[key]) return { ok: false, error: '该邮箱已注册' };
  if (next.pending.some((p) => p.email === key)) return { ok: false, error: '该邮箱已在审核队列中' };
  next.pending.push({ email: key, name: str(name), createdAt: Math.floor(Date.now() / 1000) });
  store.write(next);
  return { ok: true };
}

export function removePending(email: string): boolean {
  const key = normaliseEmail(email);
  const next = read();
  const before = next.pending.length;
  next.pending = next.pending.filter((p) => p.email !== key);
  if (next.pending.length === before) return false;
  store.write(next);
  return true;
}

/** Approve a pending registration, optionally granting permissions. */
export function approvePending(email: string, permissions: string[] = []): Visitor | null {
  const key = normaliseEmail(email);
  const pending = read().pending.find((p) => p.email === key);
  if (!pending) return null;
  const visitor = setVisitor(key, permissions, pending.name);
  removePending(key);
  return visitor;
}

export function countVisitors(): number {
  return Object.keys(read().emails).length;
}

export { store as visitorsStore };
