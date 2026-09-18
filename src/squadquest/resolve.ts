import { DetailedError } from "../errors.js";
import { acceptedFriends, fullName, shortPersonName, type Friendship, type Person } from "./friends.js";

/**
 * Name resolution — specs/behaviors/name-resolution.md.
 *
 * The sharpest edge in the tool. A wrong match doesn't produce a confusing
 * error, it produces an invitation delivered to the wrong human: not
 * recoverable by the caller and not visible to them afterward. So failing is
 * always cheaper than guessing, and the result type has no "probably this one"
 * shape for a caller to mistake for success.
 */

export type Resolution =
  | { kind: "one"; person: Person }
  | { kind: "none" }
  | { kind: "many"; candidates: Person[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function looksLikeId(input: string): boolean {
  return UUID.test(input.trim());
}

/**
 * Tiered matching, stopping at the first tier that yields anything. The tiers
 * are what keep an exact "Chris" from being drowned out by every "Christine",
 * "Christopher" and "Chrischi".
 */
export function matchTiers(query: string, people: Person[]): Person[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [];

  const name = (p: Person) => fullName(p).toLowerCase();
  const first = (p: Person) => (p.first_name ?? "").toLowerCase();
  const last = (p: Person) => (p.last_name ?? "").toLowerCase();

  const tiers: Array<(p: Person) => boolean> = [
    // Exact full name and exact first/last are ONE tier, deliberately.
    // Splitting them lets a person with no last name (whose full name is just
    // their first) win the earlier tier alone and silently shadow everyone
    // sharing that first name — a wrong-person pick with no warning, which is
    // the exact failure specs/behaviors/name-resolution.md exists to prevent.
    (p) => name(p) === q || first(p) === q || last(p) === q,
    (p) => first(p).startsWith(q) || last(p).startsWith(q),
    (p) => name(p).includes(q),
  ];

  for (const tier of tiers) {
    const hits = people.filter(tier);
    if (hits.length > 0) return hits;
  }
  return [];
}

export function resolveIn(query: string, people: Person[]): Resolution {
  if (looksLikeId(query)) {
    const known = people.find((p) => p.id.toLowerCase() === query.trim().toLowerCase());
    // An id is used directly even when it isn't in the cached list — the
    // caller may legitimately hold an id we didn't list.
    return { kind: "one", person: known ?? { id: query.trim(), first_name: "", last_name: "" } };
  }

  const hits = matchTiers(query, people);
  if (hits.length === 0) return { kind: "none" };
  if (hits.length === 1) return { kind: "one", person: hits[0]! };
  return { kind: "many", candidates: hits };
}

function candidateRows(people: Person[]): Array<Record<string, unknown>> {
  return people.map((p) => ({ name: shortPersonName(p), id: p.id }));
}

function failure(query: string, resolution: Resolution, total: number): DetailedError {
  if (resolution.kind === "many") {
    return new DetailedError(
      `"${query}" matches ${resolution.candidates.length} accepted friends — re-run with an id`,
      "AMBIGUOUS_NAME",
      { candidates: candidateRows(resolution.candidates) },
      [`Run \`squadquest-axi friends --search ${query}\` to see them`],
    );
  }
  return new DetailedError(
    `no accepted friend matches "${query}"`,
    "NO_MATCH",
    {},
    [
      `Run \`squadquest-axi friends --search ${query.slice(0, 3)}\` to search your friend list`,
      `Run \`squadquest-axi friends\` to list all ${total}`,
    ],
  );
}

/** Resolve one name against the live friend graph. */
export async function resolveOne(query: string): Promise<Person> {
  const friends = await acceptedFriends();
  const people = friends.map((f) => f.person);
  const resolution = resolveIn(query, people);
  if (resolution.kind === "one") return resolution.person;
  throw failure(query, resolution, people.length);
}

/**
 * Resolve every name, or fail having resolved none.
 *
 * All-or-nothing because the invite function notifies on insert: a partially
 * resolved batch that fired anyway would notify some people, leave the caller
 * unsure which, and offer no clean retry. Every problem name is reported in
 * one error so the caller fixes them all in a single correction.
 */
export async function resolveAll(queries: string[]): Promise<Person[]> {
  const friends = await acceptedFriends();
  return resolveAllIn(queries, friends.map((f) => f.person));
}

/** The pure core of {@link resolveAll} — same rules, no network. */
export function resolveAllIn(queries: string[], people: Person[]): Person[] {
  const resolved: Person[] = [];
  const unmatched: string[] = [];
  const ambiguous: Array<{ query: string; candidates: Person[] }> = [];

  for (const query of queries) {
    const resolution = resolveIn(query, people);
    if (resolution.kind === "one") resolved.push(resolution.person);
    else if (resolution.kind === "none") unmatched.push(query);
    else ambiguous.push({ query, candidates: resolution.candidates });
  }

  if (unmatched.length === 0 && ambiguous.length === 0) {
    // De-duplicate: naming the same person twice is a caller slip, not an error.
    const seen = new Set<string>();
    return resolved.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
  }

  if (queries.length === 1) {
    const only = queries[0]!;
    throw failure(
      only,
      ambiguous.length > 0 ? { kind: "many", candidates: ambiguous[0]!.candidates } : { kind: "none" },
      people.length,
    );
  }

  const details: Record<string, unknown> = {};
  if (unmatched.length > 0) details.unmatched = unmatched;
  if (ambiguous.length > 0) {
    details.ambiguous = ambiguous.flatMap(({ query, candidates }) =>
      candidates.map((p) => ({ query, name: shortPersonName(p), id: p.id })),
    );
  }

  const problems = unmatched.length + ambiguous.length;
  throw new DetailedError(
    `${problems} of ${queries.length} names could not be resolved — nobody was contacted`,
    ambiguous.length > 0 ? "AMBIGUOUS_NAME" : "NO_MATCH",
    details,
    ["Re-run with an id for each unresolved name", "Run `squadquest-axi friends` to list them"],
  );
}

export type { Friendship, Person };
