import { describe, expect, it } from "vitest";
import { looksLikeId, matchTiers, resolveAllIn, resolveIn } from "../src/squadquest/resolve.js";
import type { DetailedError } from "../src/errors.js";
import type { Person } from "../src/squadquest/friends.js";

/**
 * specs/behaviors/name-resolution.md. Invented people only — never a real
 * friend graph (specs/principles.md).
 */
const PEOPLE: Person[] = [
  { id: "1", first_name: "Ada", last_name: "Lovelace" },
  { id: "2", first_name: "Adaline", last_name: "Byron" },
  { id: "3", first_name: "Grace", last_name: "Hopper" },
  { id: "4", first_name: "Gracie", last_name: "Adams" },
  { id: "5", first_name: "Jean", last_name: "Bartik" },
  { id: "6", first_name: "Jean", last_name: "Sammet" },
  { id: "7", first_name: "sudo", last_name: "" },
  { id: "8", first_name: "Ada", last_name: "" },
  { id: "9", first_name: "李", last_name: "明" },
];

describe("the matching ladder", () => {
  it("stops at exact full name", () => {
    expect(matchTiers("Ada Lovelace", PEOPLE).map((p) => p.id)).toEqual(["1"]);
  });

  it("stops at an exact first name rather than falling through to prefixes", () => {
    // The whole point of tiering: "Ada" must not be drowned out by "Adaline".
    expect(matchTiers("Ada", PEOPLE).map((p) => p.id)).toEqual(["1", "8"]);
  });

  it("stops at an exact last name", () => {
    expect(matchTiers("Hopper", PEOPLE).map((p) => p.id)).toEqual(["3"]);
  });

  it("falls through to prefix when nothing is exact", () => {
    expect(matchTiers("Grac", PEOPLE).map((p) => p.id)).toEqual(["3", "4"]);
  });

  it("falls through to substring last", () => {
    expect(matchTiers("ove", PEOPLE).map((p) => p.id)).toEqual(["1"]);
  });

  it("is case-insensitive and trims", () => {
    expect(matchTiers("  aDa lOvElAcE ", PEOPLE).map((p) => p.id)).toEqual(["1"]);
  });

  it("handles single-word and non-Latin names", () => {
    expect(matchTiers("sudo", PEOPLE).map((p) => p.id)).toEqual(["7"]);
    expect(matchTiers("李", PEOPLE).map((p) => p.id)).toEqual(["9"]);
  });

  it("returns nothing for an empty query rather than everything", () => {
    expect(matchTiers("   ", PEOPLE)).toEqual([]);
  });
});

describe("resolveIn", () => {
  it("resolves a unique match", () => {
    const result = resolveIn("Grace", PEOPLE);
    expect(result.kind).toBe("one");
    expect(result.kind === "one" && result.person.id).toBe("3");
  });

  it("reports every candidate when ambiguous, rather than picking one", () => {
    const result = resolveIn("Jean", PEOPLE);
    expect(result.kind).toBe("many");
    expect(result.kind === "many" && result.candidates.map((p) => p.id)).toEqual(["5", "6"]);
  });

  it("reports none rather than widening the pool", () => {
    expect(resolveIn("Marge", PEOPLE).kind).toBe("none");
  });

  it("uses a uuid directly, even when it isn't in the listed set", () => {
    const id = "a4c7b11b-7cf7-4030-8fd9-5f758572893f";
    const result = resolveIn(id, PEOPLE);
    expect(result.kind).toBe("one");
    expect(result.kind === "one" && result.person.id).toBe(id);
  });

  it("recognizes uuids without confusing them for names", () => {
    expect(looksLikeId("a4c7b11b-7cf7-4030-8fd9-5f758572893f")).toBe(true);
    expect(looksLikeId("Ada Lovelace")).toBe(false);
    expect(looksLikeId("a4c7b11b")).toBe(false);
  });
});

describe("resolveAllIn (all-or-nothing)", () => {
  it("resolves every name when all are unambiguous", () => {
    expect(resolveAllIn(["Grace Hopper", "Jean Bartik"], PEOPLE).map((p) => p.id)).toEqual([
      "3",
      "5",
    ]);
  });

  it("de-duplicates when the same person is named twice", () => {
    // A caller slip, not an error — and a duplicate id would mean a duplicate
    // notification.
    expect(resolveAllIn(["Grace Hopper", "Hopper"], PEOPLE).map((p) => p.id)).toEqual(["3"]);
  });

  it("resolves nobody when any single name is ambiguous", () => {
    // A partial invite is the worst outcome: some people notified, the caller
    // unsure who, and no clean retry.
    expect(() => resolveAllIn(["Grace Hopper", "Jean"], PEOPLE)).toThrow(/nobody was contacted/);
  });

  it("resolves nobody when any single name is unmatched", () => {
    expect(() => resolveAllIn(["Grace Hopper", "Marge"], PEOPLE)).toThrow(/nobody was contacted/);
  });

  it("reports every problem name in one error, not just the first", () => {
    try {
      resolveAllIn(["Grace Hopper", "Marge", "Jean", "Nobody"], PEOPLE);
      expect.unreachable("should have thrown");
    } catch (error) {
      const detailed = error as DetailedError;
      expect(detailed.message).toContain("3 of 4");
      expect(detailed.details.unmatched).toEqual(["Marge", "Nobody"]);
      // Both Jeans ride along so the caller can correct in one turn.
      const ambiguous = detailed.details.ambiguous as Array<{ query: string; id: string }>;
      expect(ambiguous.map((a) => a.id)).toEqual(["5", "6"]);
      expect(ambiguous.every((a) => a.query === "Jean")).toBe(true);
    }
  });

  it("keeps the single-name error shape when only one name was given", () => {
    try {
      resolveAllIn(["Jean"], PEOPLE);
      expect.unreachable("should have thrown");
    } catch (error) {
      const detailed = error as DetailedError;
      expect(detailed.code).toBe("AMBIGUOUS_NAME");
      expect(detailed.message).toContain('"Jean" matches 2');
      expect(detailed.details.candidates).toHaveLength(2);
    }
  });
});
