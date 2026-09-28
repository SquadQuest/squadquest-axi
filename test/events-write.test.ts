import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCommand } from "../src/commands/events-write.js";
import { parseFlags, EVENTS_FLAGS } from "../src/flags.js";
import { writeSession } from "../src/config.js";
import { resetAnonKeyCache } from "../src/squadquest/keys.js";
import { NAME_SHAPE, conventionHint, distance, nearMisses } from "../src/squadquest/topics.js";

const ME = "11111111-1111-1111-1111-111111111111";
const scratch: string[] = [];
let networkCalls = 0;

function args(...rest: string[]) {
  return parseFlags("events create", rest, EVENTS_FLAGS.create!);
}

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "sq-axi-write-"));
  scratch.push(dir);
  process.env.SQUADQUEST_AXI_CONFIG_DIR = dir;
  process.env.SQUADQUEST_AXI_ANON_KEY = "testkey";
  resetAnonKeyCache();
  networkCalls = 0;
  writeSession({
    access_token: "t",
    refresh_token: "r",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    self: { id: ME, first_name: "Me", last_name: "M", phone: "+15555550100", cached_at: "" },
  });
  vi.stubGlobal("fetch", async () => {
    networkCalls++;
    throw new Error("no network expected in these cases");
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SQUADQUEST_AXI_CONFIG_DIR;
  delete process.env.SQUADQUEST_AXI_ANON_KEY;
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
  resetAnonKeyCache();
});

const NY = "America/New_York";

describe("events create — guards that run before any network call", () => {
  it("requires title, start and location", async () => {
    await expect(createCommand(args("--start", "2026-10-19T19:00", "--location", "L"), NY))
      .rejects.toThrow(/--title is required/);
    await expect(createCommand(args("--title", "T", "--location", "L"), NY))
      .rejects.toThrow(/--start is required/);
    await expect(createCommand(args("--title", "T", "--start", "2026-10-19T19:00"), NY))
      .rejects.toThrow(/--location is required/);
    expect(networkCalls).toBe(0);
  });

  it("rejects a backwards rally window", async () => {
    await expect(
      createCommand(
        args("--title", "T", "--location", "L", "--start", "2026-10-19T19:00", "--start-max", "2026-10-19T18:00"),
        NY,
      ),
    ).rejects.toThrow(/arrival window ends before it starts/);
    expect(networkCalls).toBe(0);
  });

  it("rejects an --end before the window closes", async () => {
    await expect(
      createCommand(
        args("--title", "T", "--location", "L", "--start", "2026-10-19T19:00", "--end", "2026-10-19T18:00"),
        NY,
      ),
    ).rejects.toThrow(/--end is earlier/);
  });

  it("rejects a window longer than a day as a likely date typo", async () => {
    await expect(
      createCommand(
        args("--title", "T", "--location", "L", "--start", "2026-10-19T19:00", "--start-max", "2026-10-25T19:00"),
        NY,
      ),
    ).rejects.toThrow(/arrival window is longer than 24 hours/);
  });

  it("rejects relative dates rather than guessing", async () => {
    await expect(
      createCommand(args("--title", "T", "--location", "L", "--start", "tomorrow"), NY),
    ).rejects.toThrow(/could not read/);
    expect(networkCalls).toBe(0);
  });

  it("rejects an unknown visibility", async () => {
    await expect(
      createCommand(
        args("--title", "T", "--location", "L", "--start", "2026-10-19T19:00", "--visibility", "secret"),
        NY,
      ),
    ).rejects.toThrow(/is not a visibility/);
  });

  it("rejects an out-of-range latitude, catching the reversed pair", async () => {
    // -75 is a valid longitude but not a latitude, so the common lon,lat slip
    // is caught here. It is a net, not a guarantee — a low-latitude reversal
    // still passes, which is why the WKT swap lives in exactly one place.
    await expect(
      createCommand(
        args("--title", "T", "--location", "L", "--start", "2026-10-19T19:00", "--rally-point", "-95.1,39.9"),
        NY,
      ),
    ).rejects.toThrow(/latitude .* out of range/);
  });

  it("rejects a malformed rally point", async () => {
    await expect(
      createCommand(
        args("--title", "T", "--location", "L", "--start", "2026-10-19T19:00", "--rally-point", "39.9"),
        NY,
      ),
    ).rejects.toThrow(/not a lat,lon pair/);
  });
});

describe("negative numbers as flag values", () => {
  it("accepts a negative longitude, which every Western coordinate needs", () => {
    // Treating any leading `-` as a flag broke the entire Western hemisphere.
    const parsed = args("--rally-point", "-75.172,39.9012");
    expect(parsed.flags["--rally-point"]).toBe("-75.172,39.9012");
  });

  it("still rejects a genuinely missing value", () => {
    expect(() => args("--title", "--location")).toThrow(/requires a value/);
  });
});

describe("topic vocabulary rules", () => {
  it("accepts the live naming convention", () => {
    for (const name of ["sports.hockey", "bike.group-ride", "movie", "art.projection"]) {
      expect(NAME_SHAPE.test(name), name).toBe(true);
    }
  });

  it("rejects shapes that aren't lowercase dot-separated", () => {
    for (const name of ["Sports Hockey", "sports/hockey", "Sports.Hockey", "sports .hockey"]) {
      expect(NAME_SHAPE.test(name), name).toBe(false);
    }
  });

  it("detects a near miss without flagging every neighbour", () => {
    const existing = [{ id: "1", name: "sports.hockey" }, { id: "2", name: "bike.race" }];
    expect(nearMisses("sports.hocky", existing).map((t) => t.name)).toEqual(["sports.hockey"]);
    expect(nearMisses("cooking.pasta", existing)).toEqual([]);
  });

  it("does not flag the exact name as a near miss of itself", () => {
    const existing = [{ id: "1", name: "sports.hockey" }];
    expect(nearMisses("sports.hockey", existing)).toEqual([]);
  });

  it("measures edit distance", () => {
    expect(distance("hockey", "hocky")).toBe(1);
    expect(distance("same", "same")).toBe(0);
  });

  it("hints when the first segment is a place rather than a domain", () => {
    expect(conventionHint("stadium.hockey")).toMatch(/is a place, not a domain/);
    expect(conventionHint("sports.hockey")).toBeUndefined();
  });
});

describe("positional arity — the silent-duplicate bug", () => {
  it("rejects a positional on create instead of dropping it", () => {
    // `events create <id> --title x` silently ignored the id and inserted a
    // duplicate while reporting success. AXI §6: a dropped argument is worse
    // than an error, because the caller proceeds on a wrong result.
    expect(() =>
      parseFlags("events create", ["687a244a-62a4-43c7-9366-7516c91f0fc0", "--title", "x"], EVENTS_FLAGS.create!),
    ).toThrow(/takes no positional arguments/);
  });

  it("still allows the positionals commands legitimately take", () => {
    expect(parseFlags("events view", ["abc"], EVENTS_FLAGS.view!).positional).toEqual(["abc"]);
    expect(parseFlags("events edit", ["abc"], EVENTS_FLAGS.edit!).positional).toEqual(["abc"]);
    expect(parseFlags("events cancel", ["abc"], EVENTS_FLAGS.cancel!).positional).toEqual(["abc"]);
    expect(parseFlags("events uncancel", ["abc"], EVENTS_FLAGS.uncancel!).positional).toEqual(["abc"]);
  });

  it("rejects a second positional where only one is allowed", () => {
    expect(() => parseFlags("events view", ["a", "b"], EVENTS_FLAGS.view!)).toThrow(
      /takes 1 positional argument/,
    );
  });
});

describe("topic is required on create", () => {
  it("refuses to create an event with no topic", async () => {
    // A null topic crashes the v1 clients for everyone who can see the event.
    // The column is nullable, so refusing is the client's job.
    await expect(
      createCommand(
        args("--title", "T", "--location", "L", "--start", "2026-10-19T19:00"),
        NY,
      ),
    ).rejects.toThrow(/--topic is required/);
    expect(networkCalls).toBe(0);
  });

  it("points at the vocabulary when the topic is missing", async () => {
    try {
      await createCommand(args("--title", "T", "--location", "L", "--start", "2026-10-19T19:00"), NY);
      expect.unreachable();
    } catch (error) {
      expect((error as { suggestions: string[] }).suggestions.join(" ")).toContain(
        "squadquest-axi topics",
      );
    }
  });
});
