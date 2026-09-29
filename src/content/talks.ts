/**
 * talks.ts — Short "moments" (微动态) backed by `blog/talks/*.md`.
 *
 * Each file is named after its creation timestamp (`<unixtime>.md`) and has:
 *   id, create_time
 * The Markdown body is the talk content.
 */
import { TALKS_DIR } from '../paths.ts';
import { str } from '../lib/text.ts';
import {
  atomicWriteFile,
  deleteMarkdownFile,
  isSafeSlug,
  readMarkdownFile,
  scanMarkdownDir,
  writeMarkdownFile,
  type MarkdownFile,
} from './markdown-files.ts';
import path from 'node:path';
import fs from 'node:fs';

export interface Talk {
  id: number;
  content: string;
  createTime: number;
}

function toTalk(md: MarkdownFile): Talk {
  const d = md.data;
  const fromName = Number.parseInt(md.name, 10);
  const id = Number(d.id) || (Number.isFinite(fromName) ? fromName : 0);
  const createTime = Number(d.create_time ?? d.createTime) || id || 0;
  return { id, content: md.body.trim(), createTime };
}

/** All talks, newest first. */
export function listTalks(): Talk[] {
  return scanMarkdownDir(TALKS_DIR)
    .map(toTalk)
    .sort((a, b) => b.createTime - a.createTime || b.id - a.id);
}

/** Load one talk by id, or null. */
export function getTalk(id: number): Talk | null {
  const md = readMarkdownFile(TALKS_DIR, String(id));
  return md ? toTalk(md) : null;
}

/** Post a new talk; returns the stored record. */
export function addTalk(content: unknown): Talk {
  const text = str(content);
  let ts = Math.floor(Date.now() / 1000);
  // The filename is the id, so nudge forward on the (very unlikely) collision.
  while (fs.existsSync(path.join(TALKS_DIR, `${ts}.md`))) ts += 1;
  writeMarkdownFile(TALKS_DIR, String(ts), { id: ts, create_time: ts }, text);
  return { id: ts, content: text, createTime: ts };
}

/** Update an existing talk's body. */
export function updateTalk(id: number, content: unknown): Talk | null {
  const md = readMarkdownFile(TALKS_DIR, String(id));
  if (!md) return null;
  const talk = toTalk(md);
  atomicWriteFile(
    md.file,
    `---\nid: ${talk.id}\ncreate_time: ${talk.createTime}\n---\n\n${str(content)}\n`,
  );
  return { ...talk, content: str(content) };
}

/** Delete a talk by id. */
export function deleteTalk(id: number): boolean {
  return deleteMarkdownFile(TALKS_DIR, String(id));
}

/** Escape hatch for callers that need to validate an id from a request. */
export function parseTalkId(value: unknown): number | null {
  const n = Number.parseInt(str(value), 10);
  return Number.isFinite(n) && n > 0 && isSafeSlug(String(n)) ? n : null;
}
