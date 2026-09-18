import { AxiError } from "axi-sdk-js";
import { TOPICS_FLAGS, bool, parseSubcommand, str } from "../flags.js";
import {
  NAME_SHAPE,
  conventionHint,
  createTopic,
  listTopics,
  nearMisses,
} from "../squadquest/topics.js";
import { DetailedError } from "../errors.js";
import { computed, joinBlocks, renderHelp, renderListResponse, renderObject } from "../output/index.js";

export async function topicsCommand(args: string[]): Promise<string> {
  const { sub, parsed } = parseSubcommand("topics", args, TOPICS_FLAGS, "list");

  if (sub === "create") {
    return create(parsed.positional[0], bool(parsed, "--force"));
  }
  return list(str(parsed, "--search"), Number(str(parsed, "--limit", "200")));
}

async function list(search: string | undefined, limit: number): Promise<string> {
  const all = await listTopics();
  const matched = search
    ? all.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()))
    : all;

  return renderListResponse({
    summary: { count: search ? `${matched.length} of ${all.length}` : String(all.length) },
    name: "topics",
    // One column: ids exist but nobody types them — commands take names.
    items: matched.slice(0, limit).map((t) => ({ name: t.name })),
    schema: [computed("name", (i) => i.name)],
    emptyMessage: search ? `no topic matches "${search}"` : "no topics yet",
    suggestions: [
      ...(search ? [] : ["Run `squadquest-axi topics --search <text>` to narrow"]),
      "Run `squadquest-axi topics create <name>` to add one",
    ],
  });
}

async function create(name: string | undefined, force: boolean): Promise<string> {
  if (!name) {
    throw new AxiError("a topic name is required", "USAGE", [
      "Run `squadquest-axi topics create sports.hockey`",
    ]);
  }

  if (!NAME_SHAPE.test(name)) {
    throw new AxiError(`"${name}" is not a valid topic name`, "USAGE", [
      "Use domain.variant, lowercase, hyphens within a segment — e.g. bike.group-ride",
    ]);
  }

  const existing = await listTopics();

  const exact = existing.find((t) => t.name === name);
  if (exact) {
    // Idempotent: the topic the caller wanted already exists (AXI §6).
    return renderObject({ topic: `${exact.name} already exists (no-op)` });
  }

  if (!force) {
    // Anyone can create a topic and nothing prunes them, so a typo permanently
    // pollutes a namespace every user shares (specs/api/topics.md).
    const near = nearMisses(name, existing);
    if (near.length > 0) {
      throw new DetailedError(
        `"${name}" is close to an existing topic`,
        "NEAR_MISS",
        { candidates: near.map((t) => ({ name: t.name })) },
        [
          `Run \`squadquest-axi events create ... --topic ${near[0]!.name}\` to use the existing topic`,
          `Run \`squadquest-axi topics create ${name} --force\` to create it anyway`,
        ],
      );
    }
  }

  const hint = conventionHint(name);
  const created = await createTopic(name);

  return joinBlocks(
    renderObject({
      topic: created.name,
      created: true,
      // Advisory, after the fact — the convention describes the live
      // vocabulary, it isn't a rule the backend enforces.
      ...(hint ? { note: hint } : {}),
    }),
    renderHelp([`Run \`squadquest-axi events create ... --topic ${created.name}\` to use it`]),
  );
}
