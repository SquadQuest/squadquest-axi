import { callFunction } from "./client.js";
import type { Person } from "./friends.js";
import type { RsvpStatus } from "./events.js";

/**
 * RSVPs and invitations — specs/api/members.md.
 *
 * Both go through edge functions, never a direct `instance_members` write. A
 * direct insert produces a row that renders correctly in the app and notifies
 * nobody: the person is invited in the database and uninvited in real life.
 */

interface MemberResponse {
  id?: string;
  status?: RsvpStatus | null;
  member?: Person & Record<string, unknown>;
}

export interface RsvpResult {
  status: RsvpStatus | null;
}

export async function setRsvp(
  eventId: string,
  status: RsvpStatus | null,
  note?: string,
): Promise<RsvpResult> {
  const body: Record<string, unknown> = { instance_id: eventId, status };
  if (note) body.note = note;

  const response = await callFunction<MemberResponse>(
    "rsvp",
    body,
    status === null ? "withdrawing your RSVP" : "setting your RSVP",
  );
  return { status: response?.status ?? null };
}

export interface InviteResult {
  invited: Person[];
}

/**
 * Invite several people in one call. The function filters out users who
 * already have a member row, so re-inviting is a safe no-op — which is what
 * lets the command treat "already invited" as exit 0 rather than an error.
 */
export async function invitePeople(eventId: string, userIds: string[]): Promise<InviteResult> {
  const response = await callFunction<MemberResponse[] | undefined>(
    "invite",
    { instance_id: eventId, users: userIds },
    "sending invitations",
  );

  const rows = Array.isArray(response) ? response : [];
  return {
    invited: rows
      .map((row) => row.member)
      .filter((p): p is Person & Record<string, unknown> => Boolean(p))
      // Only the fields needed to confirm who was reached. The function scrubs
      // its profiles, but narrowing again here means a future change to what it
      // returns can't leak a phone number into our output.
      .map((p) => ({ id: p.id, first_name: p.first_name, last_name: p.last_name })),
  };
}
