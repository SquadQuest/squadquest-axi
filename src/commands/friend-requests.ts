import { AxiError } from "axi-sdk-js";
import type { Parsed } from "../flags.js";
import { str } from "../flags.js";
import { callFunction } from "../squadquest/client.js";
import { displayPhone, normalizePhone } from "../squadquest/auth.js";
import { pendingFriendships } from "../squadquest/friends.js";
import { joinBlocks, renderHelp, renderObject } from "../output/index.js";

/**
 * Friend requests — specs/commands/friends.md.
 *
 * `request` is the only command in the tool that can contact someone outside
 * SquadQuest: an unknown number gets an SMS invitation via Twilio. It takes a
 * phone number and nothing else, so there is no fuzzy input and no way to
 * reach a stranger by a near-miss on a name.
 */

interface RequestResponse {
  status?: string;
  /** Present when the number already belonged to someone. */
  requestee?: { id?: string; first_name?: string; last_name?: string };
  /** Some deployments report the SMS path explicitly. */
  invited?: boolean;
  sms?: boolean;
  phone?: string;
}

export async function requestCommand(parsed: Parsed): Promise<string> {
  const rawPhone = str(parsed, "--phone");
  if (!rawPhone) {
    throw new AxiError("--phone is required", "USAGE", [
      "Run `squadquest-axi friends request --phone +12155550123`",
      "This command takes a number, never a name — it can text someone who isn't on SquadQuest",
    ]);
  }

  // Echo the normalized number prominently: after the fact it is the only
  // way a caller notices a mistyped digit reached the wrong person.
  const phone = normalizePhone(rawPhone);

  const response = await callFunction<RequestResponse>(
    "send-friend-request",
    {
      phone,
      ...(str(parsed, "--first-name") ? { first_name: str(parsed, "--first-name") } : {}),
      ...(str(parsed, "--last-name") ? { last_name: str(parsed, "--last-name") } : {}),
    },
    "sending the friend request",
  );

  const name = [response.requestee?.first_name, response.requestee?.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  const reachedMember = Boolean(response.requestee?.id);

  return joinBlocks(
    renderObject({
      request: reachedMember
        ? `sent to ${name || "an existing member"}`
        : "this number is not on SquadQuest — an SMS invitation was sent",
      // The server normalizes too, so prefer its echo when it gives one:
      // client and server could disagree about which number was contacted.
      phone: displayPhone(response.phone ?? phone),
      ...(response.status ? { status: response.status } : {}),
    }),
    renderHelp(["Run `squadquest-axi friends --pending` to see outstanding requests"]),
  );
}

export async function actionCommand(
  action: "accepted" | "declined",
  friendshipId: string | undefined,
): Promise<string> {
  const verb = action === "accepted" ? "accept" : "decline";

  if (!friendshipId) {
    throw new AxiError("a friendship id is required", "USAGE", [
      `Run \`squadquest-axi friends ${verb} <id>\``,
      "Run `squadquest-axi friends --pending` to see the ids",
    ]);
  }

  // The id is a *friendship* id, not a person id — that's what the backend
  // action takes, and accepting someone with no pending request is not a
  // meaningful operation.
  const pending = await pendingFriendships();
  const match = pending.find((f) => f.id === friendshipId);
  if (!match) {
    return renderObject({
      [verb]: `no pending request with that id (no-op)`,
      note: "it may already have been actioned",
    });
  }

  await callFunction("action-friend-request", { friend_id: friendshipId, action }, `${verb}ing the request`);

  return joinBlocks(
    renderObject({ [verb === "accept" ? "accepted" : "declined"]: match.person.first_name }),
    renderHelp(
      action === "accepted"
        ? ['Run `squadquest-axi invite "<name>" --event <id>` to invite them to something']
        : [],
    ),
  );
}
