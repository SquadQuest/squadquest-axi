import { insert, select } from "./client.js";

/** Topics — specs/api/topics.md. */

export interface Topic {
  id: string;
  name: string;
}

export async function listTopics(): Promise<Topic[]> {
  const rows = await select<Topic>("topics?select=id,name&order=name", "loading topics");
  return rows;
}

export async function createTopic(name: string): Promise<Topic> {
  const rows = await insert<Topic>("topics", { name }, "creating the topic");
  return rows[0] ?? { id: "", name };
}

/** `domain.variant`, lowercase, hyphens within a segment. */
export const NAME_SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*$/;

/**
 * Levenshtein distance, capped — used only for near-miss detection over a
 * ~100-name vocabulary, so a simple implementation is the right size.
 */
export function distance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i]![j] = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost);
    }
  }
  return rows[a.length]![b.length]!;
}

/**
 * Names close enough to the proposed one to be worth confirming. Conservative
 * on purpose: too loose and `--force` becomes reflexive, which defeats the
 * guard entirely (specs/commands/topics.md).
 */
export function nearMisses(name: string, existing: Topic[]): Topic[] {
  return existing.filter((t) => {
    if (t.name === name) return false;
    const d = distance(t.name, name);
    return d > 0 && d <= (name.length <= 6 ? 1 : 2);
  });
}

/**
 * The first segment should be a domain or medium, never a venue or place.
 * Advisory only — the live vocabulary is unmoderated and this tool does not
 * get to unilaterally tighten a shared namespace.
 */
const VENUE_PREFIXES = new Set([
  "stadium", "arena", "bar", "club", "venue", "theater", "theatre",
  "restaurant", "cafe", "gym", "office", "home", "house", "street",
]);

export function conventionHint(name: string): string | undefined {
  const first = name.split(".")[0];
  if (first && VENUE_PREFIXES.has(first)) {
    return `"${first}" is a place, not a domain — every other topic's first segment is an activity or medium (music, bike, run, party)`;
  }
  return undefined;
}
