import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AxiError } from "axi-sdk-js";
import { inviteCommand } from "../src/commands/invite.js";
import { rsvpCommand } from "../src/commands/rsvp.js";
import { writeSession } from "../src/config.js";
import { resetAnonKeyCache } from "../src/squadquest/keys.js";

const ME = "11111111-1111-1111-1111-111111111111";
const HOST_EVENT = "22222222-2222-2222-2222-222222222222";
const OTHER_EVENT = "33333333-3333-3333-3333-333333333333";
const ADA = "44444444-4444-4444-4444-444444444444";
const GRACE = "55555555-5555-5555-5555-555555555555";

const scratch: string[] = [];
/** Bodies POSTed to edge functions, so a test can assert nothing was sent. */
let sent: Array<{ fn: string; body: unknown }> = [];
let members: Array<{ id: string; instance: string; member: string; status: string }> = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const EVENTS: Record<string, Record<string, unknown>> = {
  [HOST_EVENT]: {
    id: HOST_EVENT,
    status: "live",
    visibility: "private",
    title: "Test Event",
    topic: null,
    start_time_min: "2026-10-19T22:00:00+00:00",
    start_time_max: "2026-10-19T22:45:00+00:00",
    end_time: null,
    location_description: "Somewhere",
    rally_point_text: null,
    link: null,
    notes: null,
    created_by: ME,
  },
  [OTHER_EVENT]: {
    id: OTHER_EVENT,
    status: "live",
    visibility: "friends",
    title: "Someone Else's Event",
    topic: null,
    start_time_min: "2026-10-20T22:00:00+00:00",
    start_time_max: "2026-10-20T22:45:00+00:00",
    end_time: null,
    location_description: "Elsewhere",
    rally_point_text: null,
    link: null,
    notes: null,
    created_by: "99999999-9999-9999-9999-999999999999",
  },
};

const FRIENDS = [
  {
    id: "f1",
    status: "accepted",
    created_at: "2026-01-01T00:00:00Z",
    requester: { id: ME, first_name: "Me", last_name: "Myself" },
    requestee: { id: ADA, first_name: "Ada", last_name: "Lovelace" },
  },
  {
    id: "f2",
    status: "accepted",
    created_at: "2026-01-01T00:00:00Z",
    requester: { id: GRACE, first_name: "Grace", last_name: "Hopper" },
    requestee: { id: ME, first_name: "Me", last_name: "Myself" },
  },
];

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "sq-axi-invite-"));
  scratch.push(dir);
  process.env.SQUADQUEST_AXI_CONFIG_DIR = dir;
  process.env.SQUADQUEST_AXI_ANON_KEY = "testkey";
  process.env.SQUADQUEST_AXI_TIMEZONE = "America/New_York";
  resetAnonKeyCache();
  sent = [];
  members = [{ id: "m0", instance: HOST_EVENT, member: ME, status: "yes" }];

  writeSession({
    access_token: "t",
    refresh_token: "r",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    self: { id: ME, first_name: "Me", last_name: "Myself", phone: "+15555550100", cached_at: "" },
  });

  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url.includes("/functions/v1/")) {
      const fn = url.split("/functions/v1/")[1]!.split("?")[0]!;
      const body = JSON.parse(String(init?.body ?? "{}"));
      sent.push({ fn, body });
      if (fn === "invite") {
        const users = (body.users as string[]) ?? [];
        for (const user of users) {
          members.push({ id: `m${members.length}`, instance: body.instance_id, member: user, status: "invited" });
        }
        return json(users.map((id) => ({ status: "invited", member: { id, first_name: "X", last_name: "Y" } })));
      }
      if (fn === "rsvp") {
        const row = members.find((m) => m.instance === body.instance_id && m.member === ME);
        if (row) row.status = body.status;
        return json({ status: body.status });
      }
    }

    if (url.includes("/rest/v1/friends")) return json(FRIENDS);
    if (url.includes("/rest/v1/instance_members")) {
      // Honour the instance filter — ignoring it silently granted permission
      // on every event and masked the guard this suite is meant to prove.
      const scope = /instance=(?:eq|in)\.\(?([0-9a-f,-]+)\)?/.exec(url);
      const wanted = scope ? scope[1]!.split(",") : undefined;
      return json(wanted ? members.filter((m) => wanted.includes(m.instance)) : members);
    }
    if (url.includes("/rest/v1/instances")) {
      const match = /id=eq\.([0-9a-f-]+)/.exec(url);
      const event = match ? EVENTS[match[1]!] : undefined;
      return json(event ? [event] : []);
    }
    if (url.includes("/rest/v1/topics")) return json([]);
    throw new Error(`unexpected ${url}`);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SQUADQUEST_AXI_CONFIG_DIR;
  delete process.env.SQUADQUEST_AXI_ANON_KEY;
  delete process.env.SQUADQUEST_AXI_TIMEZONE;
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
  resetAnonKeyCache();
});

describe("invite", () => {
  it("resolves a name and invites in one call", async () => {
    const out = await inviteCommand(["Ada", "--event", HOST_EVENT]);
    expect(out).toContain("Ada L.");
    expect(sent.filter((s) => s.fn === "invite")).toHaveLength(1);
    expect((sent[0]!.body as { users: string[] }).users).toEqual([ADA]);
  });

  it("sends several people as one array, not one call each", async () => {
    await inviteCommand(["Ada", "Grace", "--event", HOST_EVENT]);
    const invites = sent.filter((s) => s.fn === "invite");
    expect(invites).toHaveLength(1);
    expect((invites[0]!.body as { users: string[] }).users).toEqual([ADA, GRACE]);
  });

  it("sends NOTHING when any one name is unresolvable", async () => {
    // The whole point of all-or-nothing: a partial fan-out has no clean retry.
    await expect(inviteCommand(["Ada", "Nobody", "--event", HOST_EVENT])).rejects.toThrow(
      /nobody was contacted/,
    );
    expect(sent.filter((s) => s.fn === "invite")).toHaveLength(0);
  });

  it("reports an already-invited person as skipped, exit 0, with no call", async () => {
    members.push({ id: "m1", instance: HOST_EVENT, member: ADA, status: "invited" });
    const out = await inviteCommand(["Ada", "--event", HOST_EVENT]);
    expect(out).toContain("nobody new");
    expect(sent.filter((s) => s.fn === "invite")).toHaveLength(0);
  });

  it("splits fresh from already-invited in a mixed batch", async () => {
    members.push({ id: "m1", instance: HOST_EVENT, member: ADA, status: "invited" });
    const out = await inviteCommand(["Ada", "Grace", "--event", HOST_EVENT]);
    expect(out).toContain("skipped");
    expect((sent.find((s) => s.fn === "invite")!.body as { users: string[] }).users).toEqual([
      GRACE,
    ]);
  });

  it("refuses to invite to an event you neither host nor belong to", async () => {
    try {
      await inviteCommand(["Ada", "--event", OTHER_EVENT]);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as AxiError).code).toBe("NOT_PERMITTED");
    }
    expect(sent.filter((s) => s.fn === "invite")).toHaveLength(0);
  });

  it("requires --event and at least one name before any call", async () => {
    await expect(inviteCommand(["Ada"])).rejects.toThrow(/--event is required/);
    await expect(inviteCommand(["--event", HOST_EVENT])).rejects.toThrow(/at least one name/);
    expect(sent).toHaveLength(0);
  });

  it("never claims a notification was delivered", async () => {
    const out = await inviteCommand(["Ada", "--event", HOST_EVENT]);
    expect(out).not.toMatch(/notified|notification sent|will receive/i);
  });
});

describe("rsvp", () => {
  it("sets a status and reports the post-change going count", async () => {
    const out = await rsvpCommand(["maybe", "--event", HOST_EVENT]);
    expect(out).toContain("status: maybe");
    expect(out).toContain("going: 0");
  });

  it("is a no-op when the status is unchanged", async () => {
    const out = await rsvpCommand(["yes", "--event", HOST_EVENT]);
    expect(out).toContain("no-op");
    expect(sent.filter((s) => s.fn === "rsvp")).toHaveLength(0);
  });

  it("announces that omw starts sharing location", async () => {
    const out = await rsvpCommand(["omw", "--event", HOST_EVENT]);
    expect(out).toContain("sharing your location");
  });

  it("withdraws with `none`", async () => {
    const out = await rsvpCommand(["none", "--event", HOST_EVENT]);
    expect(out).toContain("withdrawn");
    expect((sent.find((s) => s.fn === "rsvp")!.body as { status: null }).status).toBeNull();
  });

  it("reports an unseeable event as not found, without implying access", async () => {
    try {
      await rsvpCommand(["yes", "--event", "66666666-6666-6666-6666-666666666666"]);
      expect.unreachable("should have thrown");
    } catch (error) {
      const axi = error as AxiError;
      expect(axi.code).toBe("EVENT_NOT_FOUND");
      expect(axi.message).not.toMatch(/permission|access|allowed/i);
    }
  });

  it("rejects a status that isn't one of the five", async () => {
    await expect(rsvpCommand(["probably", "--event", HOST_EVENT])).rejects.toThrow(
      /not an RSVP status/,
    );
    expect(sent).toHaveLength(0);
  });
});
