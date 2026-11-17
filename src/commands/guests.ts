import { AxiError } from "axi-sdk-js";
import { GUESTS_FLAGS, bool, multiStr, parseSubcommand, str, type Parsed } from "../flags.js";
import {
  E164_RE,
  NAME_MAX,
  ambiguous,
  attach,
  buildLink,
  closeOpenLink,
  createGuest,
  createOpenLink,
  deleteGuest,
  detach,
  eventTitles,
  findGuest,
  guestExists,
  isUuid,
  listGuestRows,
  listGuests,
  matchGuest,
  openLinkFor,
  parseBaseUrl,
  requireOwnEvents,
  rowsForGuest,
  setGuestPhone,
  type Guest,
  type GuestRow,
} from "../squadquest/guests.js";
import { formatWindow, resolveTimezone } from "../time/wallclock.js";
import { precheckExport, writeJsonExport } from "../output/export.js";
import {
  computed,
  joinBlocks,
  renderHelp,
  renderList,
  renderObject,
} from "../output/index.js";

/** Guests who have not registered — specs/commands/guests.md. */
export async function guestsCommand(args: string[]): Promise<string> {
  const { sub, parsed } = parseSubcommand("guests", args, GUESTS_FLAGS, "list");
  switch (sub) {
    case "add":
      return add(parsed);
    case "links":
      return links(parsed);
    case "remove":
      return removeCmd(parsed);
    case "open-link":
      return openLink(parsed);
    default:
      return list(parsed);
  }
}

function short(id: string): string {
  return id.slice(0, 8);
}

function eventIdFlag(parsed: Parsed, usage: string): string | undefined {
  const id = str(parsed, "--event");
  if (id !== undefined && !isUuid(id)) {
    throw new AxiError(`"${id}" is not an event id`, "USAGE", [usage]);
  }
  return id;
}

// list ───────────────────────────────────────────────────────────────

async function list(parsed: Parsed): Promise<string> {
  const zone = resolveTimezone(str(parsed, "--timezone"));
  const eventId = eventIdFlag(parsed, "Run `squadquest-axi guests --event <id>`");

  if (eventId) {
    const [event] = await requireOwnEvents([eventId]);
    const [guests, rows] = await Promise.all([listGuests(), listGuestRows(eventId)]);
    const byId = new Map(guests.map((g) => [g.id, g]));
    const items = rows
      .map((r) => ({ name: byId.get(r.guest)?.name ?? "(unknown)", rsvp: r.status, id: r.guest }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const tally = (s: string) => rows.filter((r) => r.status === s).length;
    const header = renderObject({
      event: `${event!.title} (${formatWindow(Date.parse(event!.start_time_min), Date.parse(event!.start_time_max), zone)})`,
      answers: `yes ${tally("yes")}, maybe ${tally("maybe")}, no ${tally("no")}, invited ${tally("invited")}`,
    });
    if (items.length === 0) {
      return joinBlocks(
        header,
        renderObject({ guests: "0 guests found on that event" }),
        renderHelp([`Run \`squadquest-axi guests add --event ${eventId} --name "<name>"\` to add one`]),
      );
    }
    return joinBlocks(
      header,
      renderList("guests", items, [
        computed("name", (i) => i.name),
        computed("rsvp", (i) => i.rsvp),
        computed("id", (i) => i.id),
      ]),
      renderHelp([`Run \`squadquest-axi guests links --base-url <page url> --event ${eventId}\` to get their links`]),
    );
  }

  const [guests, rows] = await Promise.all([listGuests(), listGuestRows()]);
  if (guests.length === 0) {
    return joinBlocks(
      renderObject({ guests: "0 guests found" }),
      renderHelp(['Run `squadquest-axi guests add --event <id> --name "<name>"` to add one']),
    );
  }
  const titles = await eventTitles([...new Set(rows.map((r) => r.instance))]);
  const mine = new Set(guests.map((g) => g.id));
  const items: Array<{ name: string; event: string; start: string | null; rsvp: string; id: string }> = [];
  for (const g of guests) {
    const theirs = rows.filter((r) => r.guest === g.id);
    if (theirs.length === 0) items.push({ name: g.name, event: "(no events)", start: null, rsvp: "none", id: g.id });
    for (const r of theirs) {
      const t = titles.get(r.instance);
      items.push({ name: g.name, event: t?.title ?? short(r.instance), start: t?.start ?? null, rsvp: r.status, id: g.id });
    }
  }
  // by event start (ISO strings compare correctly), guests with no events last
  const byStart = (a: string | null, b: string | null) =>
    a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1;
  items.sort((a, b) => byStart(a.start, b.start) || a.name.localeCompare(b.name));
  const eventCount = new Set(rows.filter((r) => mine.has(r.guest)).map((r) => r.instance)).size;

  return joinBlocks(
    renderObject({ count: `${guests.length} guests on ${eventCount} events` }),
    renderList("guests", items, [
      computed("name", (i) => i.name),
      computed("event", (i) => i.event),
      computed("rsvp", (i) => i.rsvp),
      computed("id", (i) => i.id),
    ]),
    renderHelp(["Run `squadquest-axi guests --event <id>` to see one event's answers with totals"]),
  );
}

// add ────────────────────────────────────────────────────────────────

async function add(parsed: Parsed): Promise<string> {
  const usage = 'Run `squadquest-axi guests add --event <id> --name "<name>" [--phone +15555550100]`';
  const name = str(parsed, "--name")?.trim();
  const phone = str(parsed, "--phone");
  const eventIds = [...new Set(multiStr(parsed, "--event").map((e) => e.toLowerCase()))];

  if (!name) throw new AxiError("--name is required", "USAGE", [usage]);
  if (name.length > NAME_MAX) {
    throw new AxiError(`--name is ${name.length} characters; the limit is ${NAME_MAX}`, "USAGE", [usage]);
  }
  if (phone !== undefined && !E164_RE.test(phone)) {
    throw new AxiError(`--phone "${phone}" is not E.164`, "USAGE", ["Pass it as + country code and number, e.g. --phone +15555550100"]);
  }
  if (eventIds.length === 0) {
    throw new AxiError("at least one --event is required", "USAGE", [
      usage,
      "Run `squadquest-axi events --hosting` to find the id",
    ]);
  }

  // every event is checked before anything is written
  const events = await requireOwnEvents(eventIds);
  const guests = await listGuests();
  const match = matchGuest(guests, name, phone);
  if (match.kind === "many") throw ambiguous(name, match.candidates);

  let guest: Guest;
  let action: "created" | "updated" | "exists";
  if (match.kind === "none") {
    guest = await createGuest(name, phone);
    action = "created";
  } else if (match.adoptPhone && phone) {
    const updated = await setGuestPhone(match.guest.id, phone);
    if (!updated || updated.phone !== phone) {
      throw new AxiError("the phone was sent but could not be read back", "OUTCOME_UNKNOWN", [
        "Run `squadquest-axi guests` to check before trying again",
      ]);
    }
    guest = updated;
    action = "updated";
  } else {
    guest = match.guest;
    action = "exists";
  }

  const before = new Set((await rowsForGuest(guest.id)).map((r) => r.instance));
  const fresh = eventIds.filter((id) => !before.has(id));
  const after = new Map((await attach(guest.id, fresh)).map((r) => [r.instance, r]));
  const missing = eventIds.filter((id) => !after.has(id));

  const blocks = [
    renderObject({ action, guest: guest.name, id: guest.id, phone: guest.phone ?? "none" }),
    renderList(
      "events",
      events.map((e) => ({
        event: e.id,
        title: e.title,
        change: !after.has(e.id) ? "missing" : before.has(e.id) ? "already" : "added",
      })),
      [computed("event", (i) => i.event), computed("title", (i) => i.title), computed("change", (i) => i.change)],
    ),
  ];
  if (missing.length > 0) {
    // reported, never hidden: the agent must not believe these were added
    blocks.push(renderObject({ confirmed: false, warning: `${missing.length} event(s) not found on the guest after the write` }));
    blocks.push(renderHelp([`Run \`squadquest-axi guests --event ${missing[0]}\` to check`]));
    return exitOne(joinBlocks(...blocks));
  }
  const undo =
    action === "created"
      ? `Run \`squadquest-axi guests remove ${guest.id} --confirm "${guest.name}"\` to undo`
      : fresh.length > 0
        ? `Run \`squadquest-axi guests remove ${guest.id} ${fresh.map((e) => `--event ${e}`).join(" ")}\` to undo`
        : undefined;
  blocks.push(
    renderHelp([
      "Run `squadquest-axi guests links --base-url <page url>` to get their link",
      ...(undo ? [undo] : []),
    ]),
  );
  return joinBlocks(...blocks);
}

/**
 * A result that must exit 1 but still print everything it knows — what was
 * and was not written, or the preview beside a failed export. The SDK only
 * sets the exit code on a thrown error, so the code is set here and the full
 * block is returned as normal output.
 */
function exitOne(output: string): string {
  process.exitCode = 1;
  return output;
}

// links ──────────────────────────────────────────────────────────────

async function links(parsed: Parsed): Promise<string> {
  const exportTarget = parsed.flags["--json-out"];
  if (parsed.positional.length > 0) {
    throw new AxiError(
      exportTarget === true
        ? `--json-out takes its path with =, so "${parsed.positional[0]}" was read as an argument`
        : "`guests links` takes no positional arguments",
      "USAGE",
      [exportTarget === true ? `Run with --json-out=${parsed.positional[0]}` : "Run `squadquest-axi guests links --base-url <page url>`"],
    );
  }
  const rawBase = str(parsed, "--base-url");
  if (!rawBase) {
    throw new AxiError("--base-url is required", "USAGE", [
      "Run `squadquest-axi guests links --base-url https://example.com/party/`",
    ]);
  }
  const base = parseBaseUrl(rawBase);
  const eventId = eventIdFlag(parsed, "Run `squadquest-axi guests links --base-url <url> --event <id>`");
  // the export path is validated before any work
  if (exportTarget !== undefined) {
    const problem = precheckExport(exportTarget);
    if (problem) throw new AxiError(`cannot write --json-out: ${problem}`, "USAGE", ["Pass a path in an existing directory, or --json-out alone"]);
  }

  if (eventId) await requireOwnEvents([eventId]);
  let guests = await listGuests();
  if (eventId) {
    const on = new Set((await listGuestRows(eventId)).map((r) => r.guest));
    guests = guests.filter((g) => on.has(g.id));
  }

  const rows = guests.map((g) => ({ id: g.id, name: g.name, phone: g.phone ?? "", link: buildLink(base, "t", g.token) }));
  if (rows.length === 0) {
    return joinBlocks(
      renderObject({ links: eventId ? "0 guests found on that event" : "0 guests found" }),
      renderHelp(['Run `squadquest-axi guests add --event <id> --name "<name>"` to add one']),
    );
  }

  const blocks = [
    renderObject({ count: `${rows.length} guests` }),
    renderList("links", rows, [
      computed("name", (i) => i.name),
      computed("phone", (i) => i.phone),
      computed("link", (i) => i.link),
    ]),
  ];
  if (exportTarget === undefined) {
    blocks.push(renderHelp(["Each link is that guest's credential: send it only to them"]));
    return joinBlocks(...blocks);
  }

  const outcome = writeJsonExport(exportTarget, "guest-links", { rows }, 4);
  if (!outcome.ok) {
    blocks.push(renderObject({ export_error: outcome.error }), renderHelp([outcome.helpLine]));
    return exitOne(joinBlocks(...blocks));
  }
  blocks.push(
    renderObject({ wrote: outcome.wrote, columns: "id, name, phone, link" }),
    renderHelp([outcome.helpLine]),
  );
  return joinBlocks(...blocks);
}

// remove ─────────────────────────────────────────────────────────────

async function removeCmd(parsed: Parsed): Promise<string> {
  const query = parsed.positional[0];
  if (!query) {
    throw new AxiError("a guest id or name is required", "USAGE", [
      "Run `squadquest-axi guests remove <id|name> [--event <id>]`",
      "Run `squadquest-axi guests` to see your guests",
    ]);
  }
  const eventIds = [...new Set(multiStr(parsed, "--event").map((e) => e.toLowerCase()))];
  for (const id of eventIds) {
    if (!isUuid(id)) throw new AxiError(`"${id}" is not an event id`, "USAGE", ["Run `squadquest-axi guests` to see event ids"]);
  }

  const guest = findGuest(await listGuests(), query);
  const rows = await rowsForGuest(guest.id);

  if (eventIds.length > 0) {
    if (parsed.flags["--confirm"] !== undefined) {
      throw new AxiError("--confirm is for deleting a guest; with --event use --discard-answer", "USAGE", [
        `Run \`squadquest-axi guests remove ${guest.id} ${eventIds.map((e) => `--event ${e}`).join(" ")}\``,
      ]);
    }
    const on = rows.filter((r) => eventIds.includes(r.instance));
    const answered = on.filter((r) => r.status !== "invited");
    if (answered.length > 0 && !bool(parsed, "--discard-answer")) {
      throw new AxiError(
        `${guest.name} has answered on ${answered.length} of those events; removing them loses the answer`,
        "ANSWER_WOULD_BE_LOST",
        [
          `Run \`squadquest-axi guests --event ${answered[0]!.instance}\` to see the answer first`,
          `Run \`squadquest-axi guests remove ${guest.id} ${eventIds.map((e) => `--event ${e}`).join(" ")} --discard-answer\` to remove anyway`,
        ],
      );
    }
    if (on.length === 0) {
      return joinBlocks(
        renderObject({ action: "noop", reason: `${guest.name} is not on those events (no-op)`, id: guest.id }),
      );
    }
    await detach(guest.id, on.map((r) => r.instance));
    const left = await rowsForGuest(guest.id);
    const still = on.filter((r) => left.some((l) => l.instance === r.instance));
    if (still.length > 0) {
      throw new AxiError(`${still.length} event row(s) still present after removing`, "REMOVE_UNCONFIRMED", [
        `Run \`squadquest-axi guests --event ${still[0]!.instance}\` to check before trying again`,
      ]);
    }
    return joinBlocks(
      renderObject({ action: "detached", guest: guest.name, id: guest.id }),
      renderList(
        "removed_from",
        on.map((r) => ({ event: r.instance, was: r.status })),
        [computed("event", (i) => i.event), computed("was", (i) => i.was)],
      ),
      renderHelp([
        `Run \`squadquest-axi guests add --name "${guest.name}"${guest.phone ? ` --phone ${guest.phone}` : ""} ${on.map((r) => `--event ${r.instance}`).join(" ")}\` to add them back (answers are not restored)`,
      ]),
    );
  }

  // deleting the guest: their link dies and every answer is lost
  if (bool(parsed, "--discard-answer")) {
    throw new AxiError("--discard-answer is for --event; deleting a guest takes --confirm \"<name>\"", "USAGE", [
      `Run \`squadquest-axi guests remove ${guest.id} --confirm "${guest.name}"\``,
    ]);
  }
  const confirm = str(parsed, "--confirm");
  if (confirm === undefined || confirm.trim().toLowerCase() !== guest.name.trim().toLowerCase()) {
    throw new AxiError(
      confirm === undefined
        ? `deleting ${guest.name} kills their link and loses ${rows.length} event answer(s)`
        : `--confirm "${confirm}" does not match the guest's name`,
      "CONFIRM_REQUIRED",
      [
        `Run \`squadquest-axi guests remove ${guest.id} --event <id>\` to take them off one event instead`,
        `Run \`squadquest-axi guests remove ${guest.id} --confirm "${guest.name}"\` to delete them`,
      ],
    );
  }
  await deleteGuest(guest.id);
  if (await guestExists(guest.id)) {
    throw new AxiError(`${guest.name} is still present after deleting`, "REMOVE_UNCONFIRMED", [
      "Run `squadquest-axi guests` to check before trying again",
    ]);
  }
  return joinBlocks(
    renderObject({ action: "deleted", guest: guest.name, id: guest.id, events_lost: rows.length }),
    renderHelp([
      `Run \`squadquest-axi guests add --name "${guest.name}"${guest.phone ? ` --phone ${guest.phone}` : ""} --event <id>\` to add them again (with a new link)`,
    ]),
  );
}

// open-link ──────────────────────────────────────────────────────────

async function openLink(parsed: Parsed): Promise<string> {
  const zone = resolveTimezone(str(parsed, "--timezone"));
  const eventId = eventIdFlag(parsed, "Run `squadquest-axi guests open-link --event <id> --base-url <url>`");
  if (!eventId) {
    throw new AxiError("--event is required", "USAGE", [
      "Run `squadquest-axi guests open-link --event <id> --base-url <url>`",
      "Run `squadquest-axi events --hosting` to find the id",
    ]);
  }
  const close = bool(parsed, "--close");
  const rawBase = str(parsed, "--base-url");
  if (close && (rawBase !== undefined || bool(parsed, "--confirm"))) {
    throw new AxiError("--close takes only --event", "USAGE", [`Run \`squadquest-axi guests open-link --event ${eventId} --close\``]);
  }
  if (!close && !rawBase) {
    throw new AxiError("--base-url is required", "USAGE", [
      `Run \`squadquest-axi guests open-link --event ${eventId} --base-url https://example.com/party/\``,
    ]);
  }
  const base = rawBase ? parseBaseUrl(rawBase) : undefined;

  const [event] = await requireOwnEvents([eventId]);
  const when = formatWindow(Date.parse(event!.start_time_min), Date.parse(event!.start_time_max), zone);
  const existing = await openLinkFor(eventId);

  if (close) {
    if (!existing) {
      return renderObject({ action: "noop", reason: "no open link on that event (no-op)", event: `${event!.title} (${when})` });
    }
    await closeOpenLink(eventId);
    if (await openLinkFor(eventId)) {
      throw new AxiError("the link is still open after closing", "CLOSE_UNCONFIRMED", [
        `Run \`squadquest-axi guests open-link --event ${eventId} --close\` again`,
      ]);
    }
    return joinBlocks(
      renderObject({
        action: "closed",
        event: `${event!.title} (${when})`,
        joined: `${existing.guests_created} of ${existing.max_guests}`,
      }),
      renderHelp([
        "Guests who already answered keep their own links",
        `Run \`squadquest-axi guests open-link --event ${eventId} --base-url <url>\` to make a NEW link (the old one stays dead)`,
      ]),
    );
  }

  let link = existing;
  let action: "created" | "exists" = "exists";
  if (!link) {
    // a link on a non-public event shows its details to anyone with the flyer
    if (event!.visibility !== "public" && !bool(parsed, "--confirm")) {
      throw new AxiError(
        `${event!.title} is ${event!.visibility}; an open link shows its title, time, place and notes to anyone who has it`,
        "CONFIRM_REQUIRED",
        [`Run \`squadquest-axi guests open-link --event ${eventId} --base-url ${base!.toString()} --confirm\` to create it anyway`],
      );
    }
    link = await createOpenLink(eventId);
    action = "created";
  }

  return joinBlocks(
    renderObject({
      action,
      event: `${event!.title} (${when})`,
      link: buildLink(base!, "o", link.token),
      joined: `${link.guests_created} of ${link.max_guests}`,
    }),
    renderHelp([
      `Run \`squadquest-axi guests open-link --event ${eventId} --close\` to stop new sign-ups`,
      `Run \`squadquest-axi guests --event ${eventId}\` to see who answered`,
    ]),
  );
}

export type { GuestRow };
