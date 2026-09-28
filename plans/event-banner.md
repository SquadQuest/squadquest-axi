---
status: done
depends: [events-edit]
specs:
  - specs/api/instances.md
  - specs/commands/events.md
---

# Plan: banner images on create and edit

## Scope

`--banner <path|url>` on `events create` and `events edit`, plus the storage-upload half
of the adapter.

Out of scope: clearing a banner, and any image processing beyond what the storage
renderer already does.

## Why this exists

Found while setting a real event's banner by hand: `banner_photo` isn't in the CLI's
column list at all. The field exists, the app uses it, every event in the wild has one,
and an agent has no way to reach it — so the only path was a raw storage upload plus a
manual `PATCH`, which is exactly the kind of thing this tool exists to absorb.

## Implements

- `specs/api/instances.md` — the `event-banners` bucket, the event-id object path, the
  `_pending/{user_id}` → `{instance_id}` move on create, the `?width=1024&v=` render URL
- `specs/commands/events.md` — `--banner` on create and edit

## Approach

1. `uploadBanner(objectPath, bytes, contentType)` in the adapter:
   `POST /storage/v1/object/event-banners/<path>` with `x-upsert: true`.
2. **Re-host, always.** A local path is read from disk; a remote URL is fetched and its
   bytes uploaded. Never store someone else's URL in `banner_photo` — the app doesn't,
   and a hotlink rots.
3. Validate before any write: file exists and is an image, URL parses and fetches, size
   under the same ceiling `events draft --flyer` uses. A create that fails on the banner
   should fail before the event exists, not after.
4. **Create** uploads to `_pending/{user_id}`, creates the event, then moves the object to
   `{instance_id}` and patches `banner_photo` — matching the app so both produce the same
   layout. **Edit** uploads straight to `{instance_id}`.
5. Always append `&v=<epoch_ms>`. The object path never changes, so without it a replaced
   banner keeps serving the old image from cache.
6. If the upload fails after the event was created, report the event id *and* the banner
   failure with the fixing command — same honesty as the create+RSVP pair.

## Validation

- [x] `--banner <local.jpg>` on create attaches a banner that renders
- [x] `--banner <https://…>` re-hosts: the stored URL points at our storage, not theirs
- [x] `--banner` on edit replaces an existing banner and the new image actually serves
      (the cache-buster changed)
- [x] A missing file, a non-image, or an oversized image exits 2 before any write
- [x] An unfetchable URL exits 2 before the event is created
- [ ] A create whose banner upload fails still reports the event id and how to fix it — **unverified**, failure path not forced
- [x] The stored value matches the app's shape: render URL, `width=1024`, `&v=`
- [x] A banner set by this tool displays correctly in the app

## Risks / unknowns

- **Storage RLS is unverified.** Uploading to `_pending/{user_id}` worked by hand for the
  owner's own event; whether a non-host can upload, and whether `move` is permitted, is
  untested.
- **The app may be the only thing that cleans up `_pending`.** If a create fails between
  upload and move, an orphan object is left behind. Acceptable, but worth knowing.

## Notes

- **Verified end to end on a throwaway private event**: `--banner <local.jpg>` on create
  uploaded to `_pending/{user_id}`, moved onto the event id after save, and the stored
  render URL serves a 200 image/jpeg. The value matches the app's shape exactly
  (`?width=1024&v=<epoch_ms>`).
- **`banner_photo` had to be added to the read columns too** — it wasn't in
  `EVENT_COLUMNS`, which is why the field was invisible to the whole tool rather than
  merely unwritable.
- **Re-hosting is the whole point.** A remote `--banner` URL is fetched and its bytes
  uploaded, so `banner_photo` always points at SquadQuest storage. Storing the source URL
  would leave an event's artwork hostage to someone else's server.

## Follow-ups

- **Clearing a banner isn't supported.** There's no `--remove-banner`; the object would
  also need deleting from storage, and delete policies are unverified here the same way
  they were for events.
- **Non-host upload is untested.** Only the owner's own events were exercised, so storage
  RLS for `_pending/{other_user}` and for `move` is unknown.
