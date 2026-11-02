/**
 * visits.ts — Page-view counters, persisted to `blog/data/visits.json`.
 *
 * Both servers (the blog on BMY_PORT and the standalone profile card on
 * BMY_PROFILE_PORT) share the same data directory, so both processes write
 * into this one file: `blog` counts rendered HTML pages on the blog, `profile`
 * counts renders of the personal card, and `total` is their sum. Reads are
 * mtime-cached by JsonStore, so hand-editing or an external reset still works,
 * and a counter write from the other process is picked up on the next read.
 *
 * Cross-process read-modify-write is not atomic; for a hobby-site visit
 * counter that race is acceptable (worst case a handful of views are lost
 * under simultaneous load), and it keeps the "no database" contract intact.
 */
import path from 'node:path';
import { DATA_DIR } from '../paths.ts';
import { JsonStore } from './json-store.ts';

export interface VisitCounts {
  /** Rendered HTML page views served by the blog. */
  blog: number;
  /** Renders of the standalone profile card. */
  profile: number;
  /** blog + profile, i.e. every counted page view. */
  total: number;
  /** Day (YYYY-MM-DD) counting started, for display purposes. */
  since: string;
}

export type VisitKind = 'blog' | 'profile';

const store = new JsonStore<VisitCounts>(
  path.join(DATA_DIR, 'visits.json'),
  () => ({ blog: 0, profile: 0, total: 0, since: new Date().toISOString().slice(0, 10) }),
);

/** Read the current counters (no write). */
export function getVisits(): VisitCounts {
  return store.read();
}

/** Increment one counter (and the total) and persist the file. */
export function recordVisit(kind: VisitKind): VisitCounts {
  // The static build fetches every page through the app in-process; those
  // renders are not human visits and must not pollute the counters.
  if (process.env.BMY_NO_RECORD === '1') return store.read();
  return store.update((current) => ({
    ...current,
    [kind]: (current[kind] ?? 0) + 1,
    total: (current.total ?? 0) + 1,
  }));
}
