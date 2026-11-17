import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AxiError } from "axi-sdk-js";
import { guestsCommand } from "../src/commands/guests.js";
import { formatError } from "../src/cli.js";
import { writeSession } from "../src/config.js";
import { resetAnonKeyCache } from "../src/squadquest/keys.js";
import { buildLink, matchGuest, parseBaseUrl, type Guest } from "../src/squadquest/guests.js";

// Invented people and ids only (specs/principles.md § 4).
const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "99999999-9999-4999-8999-999999999999";
const PARTY = "22222222-2222-4222-8222-222222222222";
const AFTERS = "33333333-3333-4333-8333-333333333333";
const PUBLIC_EVENT = "44444444-4444-4444-8444-444444444444";
const NOT_MINE = "55555555-5555-4555-8555-555555555555";
const BASE = "https://example.com/party/";

type Row = Record<string, unknown>;
let db: Record<string, Row[]>;
let writes: Array<{ method: string; table: string }>;
/** When set, POSTs to instance_guests are accepted but store nothing. */
let dropAttach = false;
let tablesMissing = false;
let seq = 0;
const scratch: string[] = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function event(id: string, title: string, created_by: string, visibility = "private"): Row {
  return {
    id,
    status: "live",
    visibility,
    title,
    topic: null,
    start_time_min: id === AFTERS ? "2026-12-02T04:00:00+00:00" : "2026-12-01T23:00:00+00:00",
    start_time_max: id === AFTERS ? "2026-12-02T04:00:00+00:00" : "2026-12-02T00:00:00+00:00",
    end_time: null,
    location_description: "Somewhere",
    rally_point_text: null,
    link: null,
    notes: null,
    banner_photo: null,
    created_by,
  };
}

function token(): string {
  seq++;
  return seq.toString(16).padStart(64, "0");
}

function uuid(): string {
  seq++;
  return `aaaaaaaa-aaaa-4aaa-8aaa-${seq.toString(16).padStart(12, "0")}`;
}

/** A tiny PostgREST: eq / in / is.null filters, select projection, RLS by host. */
function matches(row: Row, params: URLSearchParams): boolean {
  for (const [key, raw] of params) {
    if (key === "select" || key === "order") continue;
    const value = row[key];
    if (raw.startsWith("eq.")) {
      if (String(value) !== raw.slice(3)) return false;
    } else if (raw.startsWith("in.(")) {
      if (!raw.slice(4, -1).split(",").includes(String(value))) return false;
    } else if (raw === "is.null") {
      if (value !== null) return false;
    } else throw new Error(`unsupported filter ${key}=${raw}`);
  }
  return true;
}

function project(row: Row, params: URLSearchParams): Row {
  const select = params.get("select");
  if (!select || select === "*") return { ...row };
  return Object.fromEntries(select.split(",").map((c) => [c, row[c]]));
}

function visible(table: string): Row[] {
  const mine = new Set(db.instances!.filter((e) => e.created_by === ME).map((e) => e.id));
  if (table === "guests") return db.guests!.filter((g) => g.host === ME);
  if (table === "instance_guests") return db.instance_guests!.filter((r) => mine.has(r.instance));
  if (table === "instance_open_links") return db.instance_open_links!.filter((l) => l.created_by === ME);
  return db[table] ?? [];
}

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "sq-axi-guests-"));
  scratch.push(dir);
  process.env.SQUADQUEST_AXI_CONFIG_DIR = dir;
  process.env.SQUADQUEST_AXI_ANON_KEY = "testkey";
  process.env.SQUADQUEST_AXI_TIMEZONE = "America/New_York";
  resetAnonKeyCache();
  process.exitCode = undefined;
  writes = [];
  dropAttach = false;
  tablesMissing = false;
  db = {
    instances: [
      event(PARTY, "Sample Party", ME),
      event(AFTERS, "Sample Afters", ME),
      event(PUBLIC_EVENT, "Sample Open House", ME, "public"),
      event(NOT_MINE, "Someone Else's Party", OTHER),
    ],
    guests: [],
    instance_guests: [],
    instance_open_links: [],
  };

  writeSession({
    access_token: "t",
    refresh_token: "r",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    self: { id: ME, first_name: "Host", last_name: "One", phone: "+15555550101", cached_at: "" },
  });

  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    if (!url.pathname.startsWith("/rest/v1/")) throw new Error(`unexpected ${url}`);
    const table = url.pathname.slice("/rest/v1/".length);
    const method = init?.method ?? "GET";
    const params = url.searchParams;

    if (tablesMissing && table !== "instances") {
      return json({ code: "42P01", message: `relation "public.${table}" does not exist` }, 404);
    }

    if (method === "GET") {
      return json(visible(table).filter((r) => matches(r, params)).map((r) => project(r, params)));
    }

    writes.push({ method, table });
    if (method === "POST") {
      const body = JSON.parse(String(init?.body));
      const items = (Array.isArray(body) ? body : [body]) as Row[];
      const created: Row[] = [];
      for (const item of items) {
        let row: Row;
        if (table === "guests") {
          if (item.phone && db.guests!.some((g) => g.host === ME && g.phone === item.phone)) {
            return json({ code: "23505", message: "duplicate key" }, 409);
          }
          row = { id: uuid(), host: ME, token: token(), phone: null, ...item };
        } else if (table === "instance_guests") {
          const ev = db.instances!.find((e) => e.id === item.instance);
          if (ev?.created_by !== ME) return json({ code: "42501", message: "rls" }, 403);
          if (dropAttach) continue;
          row = { status: "invited", ...item };
        } else if (table === "instance_open_links") {
          row = { token: token(), created_by: ME, closed_at: null, max_guests: 300, guests_created: 0, ...item };
        } else throw new Error(`unexpected POST ${table}`);
        db[table]!.push(row);
        created.push(project(row, params));
      }
      return json(created, 201);
    }
    if (method === "PATCH") {
      const body = JSON.parse(String(init?.body)) as Row;
      const hit = visible(table).filter((r) => matches(r, params));
      for (const r of hit) Object.assign(r, body);
      return json(hit.map((r) => project(r, params)));
    }
    if (method === "DELETE") {
      const hit = visible(table).filter((r) => matches(r, params));
      db[table] = db[table]!.filter((r) => !hit.includes(r));
      if (table === "guests") {
        const ids = new Set(hit.map((g) => g.id));
        db.instance_guests = db.instance_guests!.filter((r) => !ids.has(r.guest));
      }
      return json(hit);
    }
    throw new Error(`unexpected ${method}`);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SQUADQUEST_AXI_CONFIG_DIR;
  delete process.env.SQUADQUEST_AXI_ANON_KEY;
  delete process.env.SQUADQUEST_AXI_TIMEZONE;
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
  resetAnonKeyCache();
  process.exitCode = undefined;
});

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as AxiError).code;
  }
  throw new Error("expected a failure");
}

function addSam(...extra: string[]) {
  return guestsCommand(["add", "--event", PARTY, "--name", "Sam Example", "--phone", "+15555550100", ...extra]);
}

describe("guests add", () => {
  it("creates the guest once and attaches to every --event", async () => {
    const out = await guestsCommand([
      "add", "--event", PARTY, "--event", AFTERS, "--name", "Sam Example", "--phone", "+15555550100",
    ]);
    expect(out).toContain("action: created");
    expect(out).toContain(`${PARTY},Sample Party,added`);
    expect(out).toContain(`${AFTERS},Sample Afters,added`);
    expect(db.guests).toHaveLength(1);
    expect(db.instance_guests).toHaveLength(2);
    // the token is the server's; the CLI never sends one
    expect(db.guests![0]!.token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("re-running is exists + already, with no new writes to the guest", async () => {
    await addSam();
    writes = [];
    const out = await addSam();
    expect(out).toContain("action: exists");
    expect(out).toContain(`${PARTY},Sample Party,already`);
    expect(writes).toEqual([]);
    expect(db.guests).toHaveLength(1);
  });

  it("reuses by phone even under another name, and adds only the new event", async () => {
    await addSam();
    const out = await guestsCommand(["add", "--event", AFTERS, "--name", "Sammy", "--phone", "+15555550100"]);
    expect(out).toContain("action: exists");
    expect(out).toContain("guest: Sam Example");
    expect(db.guests).toHaveLength(1);
    expect(db.instance_guests).toHaveLength(2);
  });

  it("a phoneless same-name guest adopts the phone", async () => {
    await guestsCommand(["add", "--event", PARTY, "--name", "Lee Example"]);
    const out = await guestsCommand(["add", "--event", PARTY, "--name", "lee example", "--phone", "+15555550102"]);
    expect(out).toContain("action: updated");
    expect(db.guests).toHaveLength(1);
    expect(db.guests![0]!.phone).toBe("+15555550102");
  });

  it("two same-name guests and no phone is AMBIGUOUS_NAME with both ids, writing nothing", async () => {
    await guestsCommand(["add", "--event", PARTY, "--name", "Kim Example", "--phone", "+15555550103"]);
    await guestsCommand(["add", "--event", PARTY, "--name", "Kim Example", "--phone", "+15555550104"]);
    writes = [];
    try {
      await guestsCommand(["add", "--event", AFTERS, "--name", "Kim Example"]);
      expect.unreachable();
    } catch (error) {
      const e = error as AxiError & { details: { candidates: Array<{ id: string }> } };
      expect(e.code).toBe("AMBIGUOUS_NAME");
      expect(e.details.candidates.map((c) => c.id).sort()).toEqual(db.guests!.map((g) => g.id).sort());
    }
    expect(writes).toEqual([]);
  });

  it("an event you did not create is NOT_PERMITTED, exit 2, nothing written", async () => {
    const err = await guestsCommand(["add", "--event", PARTY, "--event", NOT_MINE, "--name", "Sam Example"]).catch((e) => e);
    expect(err.code).toBe("NOT_PERMITTED");
    expect(formatError(err).exitCode).toBe(2);
    expect(writes).toEqual([]);
  });

  it("an unknown event is EVENT_NOT_FOUND, nothing written", async () => {
    expect(await code(guestsCommand(["add", "--event", "66666666-6666-4666-8666-666666666666", "--name", "Sam"]))).toBe("EVENT_NOT_FOUND");
    expect(writes).toEqual([]);
  });

  it("validates name, phone and events before any call", async () => {
    expect(await code(guestsCommand(["add", "--event", PARTY]))).toBe("USAGE");
    expect(await code(guestsCommand(["add", "--name", "Sam"]))).toBe("USAGE");
    expect(await code(guestsCommand(["add", "--event", PARTY, "--name", "Sam", "--phone", "215-555-0100"]))).toBe("USAGE");
    expect(await code(guestsCommand(["add", "--event", "nope", "--name", "Sam"]))).toBe("USAGE");
    expect(await code(guestsCommand(["add", "--event", PARTY, "--name", "x".repeat(101)]))).toBe("USAGE");
    expect(await code(guestsCommand(["add", "--event", PARTY, "--name", "Sam", "--bogus"]))).toBe("UNKNOWN_FLAG");
    expect(writes).toEqual([]);
  });

  it("an attach that is not read back is confirmed: false, exit 1", async () => {
    dropAttach = true;
    const out = await addSam();
    expect(out).toContain("confirmed: false");
    expect(out).toContain(`${PARTY},Sample Party,missing`);
    expect(process.exitCode).toBe(1);
  });
});

describe("guests list", () => {
  beforeEach(async () => {
    await guestsCommand(["add", "--event", PARTY, "--event", AFTERS, "--name", "Sam Example", "--phone", "+15555550100"]);
    await guestsCommand(["add", "--event", PARTY, "--name", "Pat Example"]);
    await guestsCommand(["add", "--event", PUBLIC_EVENT, "--name", "Lee Example"]);
    await guestsCommand(["remove", "Lee Example", "--event", PUBLIC_EVENT]);
    db.instance_guests!.find((r) => r.instance === PARTY && r.guest === db.guests![0]!.id)!.status = "yes";
  });

  it("shows name, event, rsvp and id — never the phone", async () => {
    const out = await guestsCommand([]);
    expect(out).toContain("guests[4]{name,event,rsvp,id}:");
    expect(out).toContain("Sam Example,Sample Party,yes,");
    expect(out).toContain("Pat Example,Sample Party,invited,");
    expect(out).toContain("Sam Example,Sample Afters,invited,");
    expect(out).toMatch(/Lee Example,\(no events\),none,\S+\n(?!.*Example)/);
    expect(out).not.toContain("+1555");
  });

  it("--event moves the event to a header and totals the answers", async () => {
    const out = await guestsCommand(["--event", PARTY]);
    expect(out).toContain(`event: "Sample Party (Tue, Dec 1 6:00 PM-7:00 PM EST)"`);
    expect(out).toContain(`answers: "yes 1, maybe 0, no 0, invited 1"`);
    expect(out).toContain("guests[2]{name,rsvp,id}:");
  });

  it("an empty list says so", async () => {
    db.guests = [];
    db.instance_guests = [];
    expect(await guestsCommand([])).toContain("guests: 0 guests found");
  });

  it("a server without the tables is GUESTS_UNAVAILABLE, never an empty list", async () => {
    tablesMissing = true;
    expect(await code(guestsCommand([]))).toBe("GUESTS_UNAVAILABLE");
  });
});

describe("guests links", () => {
  beforeEach(async () => {
    await addSam();
    await guestsCommand(["add", "--event", AFTERS, "--name", "Lee Example"]);
  });

  it("prints name, phone and a ?t= link per guest", async () => {
    const out = await guestsCommand(["links", "--base-url", BASE]);
    const sam = db.guests!.find((g) => g.name === "Sam Example")!;
    expect(out).toContain("links[2]{name,phone,link}:");
    expect(out).toContain(`Sam Example,"+15555550100","${BASE}?t=${sam.token}"`);
    expect(out).toMatch(/Lee Example,"","https:\/\/example.com\/party\/\?t=[0-9a-f]{64}"/);
  });

  it("--event narrows to that event's guests", async () => {
    const out = await guestsCommand(["links", "--base-url", BASE, "--event", AFTERS]);
    expect(out).toContain("links[1]");
    expect(out).toContain("Lee Example");
  });

  it("appends with & when the base already has a query", () => {
    expect(buildLink(parseBaseUrl("https://example.com/p?x=1"), "t", "ab")).toBe("https://example.com/p?x=1&t=ab");
    expect(() => parseBaseUrl("https://example.com/p?t=old")).toThrow(/t= or o=/);
    expect(() => parseBaseUrl("ftp://example.com/")).toThrow(/http/);
    expect(() => parseBaseUrl("not a url")).toThrow(/not a URL/);
  });

  it("--json-out writes the same keys, and stdout only gains wrote/columns/hint", async () => {
    const plain = await guestsCommand(["links", "--base-url", BASE]);
    const dir = mkdtempSync(join(tmpdir(), "sq-axi-links-"));
    scratch.push(dir);
    const path = join(dir, "links.json");
    const out = await guestsCommand(["links", "--base-url", BASE, `--json-out=${path}`]);

    const table = (s: string) => s.slice(s.indexOf("links["), s.indexOf("\n", s.lastIndexOf(BASE)));
    expect(table(out)).toBe(table(plain));
    expect(out).toContain(`wrote: "${path} (2 rows, 4 cols)"`);
    expect(out).toContain(`columns: "id, name, phone, link"`);

    const file = JSON.parse(readFileSync(path, "utf8")) as { rows: Array<Record<string, string>> };
    expect(Object.keys(file.rows[0]!).sort()).toEqual(["id", "link", "name", "phone"]);
    expect(file.rows.find((r) => r.name === "Sam Example")!.link).toContain("?t=");
    expect(statSync(path).mode & 0o077).toBe(0);

    // the printed hint runs as printed
    const hint = /Run `(jq '\.rows\[\]' \S+)`/.exec(out)![1]!;
    const result = execFileSync("sh", ["-c", `${hint} | jq -r .name`], { encoding: "utf8" });
    expect(result.trim().split("\n").sort()).toEqual(["Lee Example", "Sam Example"]);
  });

  it("bare --json-out writes a private file in the per-user temp dir", async () => {
    const out = await guestsCommand(["links", "--base-url", BASE, "--json-out"]);
    const path = /wrote: "?(\S+) \(/.exec(out)![1]!;
    scratch.push(path);
    expect(existsSync(path)).toBe(true);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("--json is refused with a hint to --json-out; the space form names the = form", async () => {
    const err = await guestsCommand(["links", "--base-url", BASE, "--json"]).catch((e) => e);
    expect(err.code).toBe("UNKNOWN_FLAG");
    expect(err.suggestions.join(" ")).toContain("--json-out");
    const space = await guestsCommand(["links", "--base-url", BASE, "--json-out", "x.json"]).catch((e) => e);
    expect(space.code).toBe("USAGE");
    expect(space.suggestions.join(" ")).toContain("--json-out=x.json");
  });

  it("an unwritable export path fails before any read", async () => {
    let reads = 0;
    const real = globalThis.fetch;
    vi.stubGlobal("fetch", (...a: Parameters<typeof fetch>) => {
      reads++;
      return real(...a);
    });
    expect(await code(guestsCommand(["links", "--base-url", BASE, "--json-out=/nonexistent-dir/x.json"]))).toBe("USAGE");
    expect(reads).toBe(0);
  });

  it("--base-url is required", async () => {
    expect(await code(guestsCommand(["links"]))).toBe("USAGE");
  });
});

describe("guests remove", () => {
  let sam: string;
  beforeEach(async () => {
    await guestsCommand(["add", "--event", PARTY, "--event", AFTERS, "--name", "Sam Example", "--phone", "+15555550100"]);
    sam = db.guests![0]!.id as string;
    writes = [];
  });

  it("detaching an unanswered guest needs no flag", async () => {
    const out = await guestsCommand(["remove", sam, "--event", AFTERS]);
    expect(out).toContain("action: detached");
    expect(db.instance_guests).toHaveLength(1);
  });

  it("detaching an answered guest needs --discard-answer", async () => {
    db.instance_guests!.find((r) => r.instance === PARTY)!.status = "maybe";
    const err = await guestsCommand(["remove", "Sam Example", "--event", PARTY]).catch((e) => e);
    expect(err.code).toBe("ANSWER_WOULD_BE_LOST");
    expect(formatError(err).exitCode).toBe(2);
    expect(writes).toEqual([]);
    const out = await guestsCommand(["remove", "Sam Example", "--event", PARTY, "--discard-answer"]);
    expect(out).toContain(`${PARTY},maybe`);
  });

  it("an event they are not on is a no-op, exit 0", async () => {
    const out = await guestsCommand(["remove", sam, "--event", PUBLIC_EVENT]);
    expect(out).toContain("(no-op)");
    expect(writes).toEqual([]);
  });

  it("deleting needs --confirm matching the stored name", async () => {
    expect(await code(guestsCommand(["remove", sam]))).toBe("CONFIRM_REQUIRED");
    expect(await code(guestsCommand(["remove", sam, "--confirm", "Someone Else"]))).toBe("CONFIRM_REQUIRED");
    expect(writes).toEqual([]);
    const out = await guestsCommand(["remove", sam, "--confirm", "Sam Example"]);
    expect(out).toContain("action: deleted");
    expect(out).toContain("events_lost: 2");
    expect(db.guests).toHaveLength(0);
    expect(db.instance_guests).toHaveLength(0);
  });

  it("an unknown guest is NO_MATCH", async () => {
    expect(await code(guestsCommand(["remove", "Nobody"]))).toBe("NO_MATCH");
  });
});

describe("guests open-link", () => {
  it("creates once on a public event, then reports exists with the same link", async () => {
    const first = await guestsCommand(["open-link", "--event", PUBLIC_EVENT, "--base-url", BASE]);
    expect(first).toContain("action: created");
    expect(first).toMatch(/link: "?https:\/\/example.com\/party\/\?o=[0-9a-f]{64}/);
    expect(first).toContain("joined: 0 of 300");
    const second = await guestsCommand(["open-link", "--event", PUBLIC_EVENT, "--base-url", BASE]);
    expect(second).toContain("action: exists");
    expect(db.instance_open_links).toHaveLength(1);
    expect(second).toContain(db.instance_open_links![0]!.token as string);
  });

  it("a non-public event needs --confirm", async () => {
    const err = await guestsCommand(["open-link", "--event", PARTY, "--base-url", BASE]).catch((e) => e);
    expect(err.code).toBe("CONFIRM_REQUIRED");
    expect(formatError(err).exitCode).toBe(2);
    expect(db.instance_open_links).toHaveLength(0);
    expect(await guestsCommand(["open-link", "--event", PARTY, "--base-url", BASE, "--confirm"])).toContain("action: created");
  });

  it("--close closes, and with nothing open is a no-op", async () => {
    await guestsCommand(["open-link", "--event", PUBLIC_EVENT, "--base-url", BASE]);
    const out = await guestsCommand(["open-link", "--event", PUBLIC_EVENT, "--close"]);
    expect(out).toContain("action: closed");
    expect(db.instance_open_links![0]!.closed_at).not.toBeNull();
    expect(await guestsCommand(["open-link", "--event", PUBLIC_EVENT, "--close"])).toContain("(no-op)");
    // a later open-link is a NEW link
    const again = await guestsCommand(["open-link", "--event", PUBLIC_EVENT, "--base-url", BASE]);
    expect(again).toContain("action: created");
    expect(db.instance_open_links).toHaveLength(2);
  });

  it("refuses an event you did not create", async () => {
    expect(await code(guestsCommand(["open-link", "--event", NOT_MINE, "--base-url", BASE, "--confirm"]))).toBe("NOT_PERMITTED");
  });

  it("requires --event and --base-url (unless closing)", async () => {
    expect(await code(guestsCommand(["open-link", "--base-url", BASE]))).toBe("USAGE");
    expect(await code(guestsCommand(["open-link", "--event", PUBLIC_EVENT]))).toBe("USAGE");
  });
});

describe("matchGuest", () => {
  const g = (id: string, name: string, phone: string | null): Guest => ({ id, name, phone, token: "x" });
  it("prefers phone, then a phoneless same name, never guessing between two", () => {
    const list = [g("1", "Sam", "+15555550100"), g("2", "Sam", null), g("3", "Pat", null), g("4", "Pat", null)];
    expect(matchGuest(list, "Other", "+15555550100")).toMatchObject({ kind: "one", guest: { id: "1" } });
    expect(matchGuest(list, "sam", "+15555550199")).toMatchObject({ kind: "one", guest: { id: "2" }, adoptPhone: true });
    expect(matchGuest(list, "Pat", "+15555550199")).toMatchObject({ kind: "many" });
    expect(matchGuest(list, "Sam")).toMatchObject({ kind: "many" });
    expect(matchGuest(list, "Lee")).toEqual({ kind: "none" });
  });
});
