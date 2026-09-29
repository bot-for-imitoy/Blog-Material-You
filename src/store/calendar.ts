/**
 * calendar.ts — Calendar events stored in `blog/data/calendar.json`.
 *
 * Replaces the `calendar_events` table. Access is permission-gated: only
 * visitors holding the `calendar` permission can read them (see
 * `src/routes/public-api.ts`).
 */
import path from 'node:path';
import { DATA_DIR } from '../paths.ts';
import { str } from '../lib/text.ts';
import { JsonStore } from './json-store.ts';

export interface CalendarEvent {
  id: number;
  title: string;
  date: string;
  description: string;
  color: string;
  createdAt: number;
}

export interface CalendarFile {
  events: CalendarEvent[];
}

function defaults(): CalendarFile {
  return { events: [] };
}

export const calendarStore = new JsonStore<CalendarFile>(
  path.join(DATA_DIR, 'calendar.json'),
  defaults,
  0o600,
);

/** All events, ordered by date ascending. */
export function listEvents(): CalendarEvent[] {
  return (calendarStore.read().events ?? [])
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
}

export interface CalendarEventInput {
  title?: unknown;
  date?: unknown;
  description?: unknown;
  color?: unknown;
}

export function addEvent(input: CalendarEventInput): CalendarEvent {
  const store = calendarStore.read();
  const events = store.events ?? [];
  const event: CalendarEvent = {
    id: Date.now(),
    title: str(input.title),
    date: str(input.date),
    description: str(input.description),
    color: str(input.color),
    createdAt: Math.floor(Date.now() / 1000),
  };
  events.push(event);
  calendarStore.write({ events });
  return event;
}

export function deleteEvent(id: number): boolean {
  const store = calendarStore.read();
  const events = store.events ?? [];
  const next = events.filter((e) => e.id !== id);
  if (next.length === events.length) return false;
  calendarStore.write({ events: next });
  return true;
}

export function replaceEvents(events: CalendarEvent[]): void {
  calendarStore.write({ events: Array.isArray(events) ? events : [] });
}
