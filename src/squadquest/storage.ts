import { readFileSync, statSync } from "node:fs";
import { AxiError } from "axi-sdk-js";
import { baseUrl, resolveCredential } from "../config.js";
import { resolveAnonKey } from "./keys.js";

/**
 * Storage uploads — specs/api/instances.md § banner photos.
 *
 * The app always RE-HOSTS: given a remote URL it downloads the bytes and
 * uploads them, so an event's banner never depends on someone else's server
 * staying up or continuing to serve hotlinks. We do the same.
 */

const BUCKET = "event-banners";

/** Same ceiling as `events draft --flyer`, for the same reason. */
const MAX_BYTES = 5 * 1024 * 1024;

const MEDIA_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
};

export interface ImageBytes {
  bytes: Buffer;
  contentType: string;
}

function tooBig(size: number): AxiError {
  return new AxiError(
    `that image is ${(size / 1024 / 1024).toFixed(1)}MB, over the ${MAX_BYTES / 1024 / 1024}MB limit`,
    "USAGE",
    ["Scale the image down and try again"],
  );
}

/**
 * Read a banner from a local path or a remote URL. Runs BEFORE the event is
 * written, so a bad banner never leaves a half-made event behind.
 */
export async function readImage(source: string): Promise<ImageBytes> {
  if (/^https?:\/\//i.test(source)) {
    let response: Response;
    try {
      response = await fetch(source);
    } catch {
      throw new AxiError(`could not fetch "${source}"`, "USAGE", [
        "Check the URL, or pass a local file path instead",
      ]);
    }
    if (!response.ok) {
      throw new AxiError(`"${source}" returned ${response.status}`, "USAGE", [
        "Check the URL, or pass a local file path instead",
      ]);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) {
      throw new AxiError(`"${source}" is not an image (${contentType || "unknown type"})`, "USAGE", [
        "Pass a direct link to an image file",
      ]);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_BYTES) throw tooBig(bytes.length);
    return { bytes, contentType };
  }

  let size: number;
  try {
    const stat = statSync(source);
    if (!stat.isFile()) throw new Error("not a file");
    size = stat.size;
  } catch {
    throw new AxiError(`cannot read "${source}"`, "USAGE", [
      "Pass a path to an image file, or an https:// URL",
    ]);
  }

  const extension = source.split(".").pop()?.toLowerCase() ?? "";
  const contentType = MEDIA_TYPES[extension];
  if (!contentType) {
    throw new AxiError(`"${source}" is not an image this can read`, "USAGE", [
      `Supported: ${[...new Set(Object.keys(MEDIA_TYPES))].join(", ")}`,
    ]);
  }
  if (size > MAX_BYTES) throw tooBig(size);

  return { bytes: readFileSync(source), contentType };
}

async function headers(contentType?: string): Promise<Record<string, string>> {
  const { key } = await resolveAnonKey(async (candidate) => {
    const probe = await fetch(`${baseUrl()}/rest/v1/app_versions?select=*&limit=1`, {
      headers: { apikey: candidate, Authorization: `Bearer ${candidate}` },
    });
    return probe.ok;
  });
  const credential = resolveCredential();
  if (!credential) {
    throw new AxiError("not signed in", "NO_SESSION", [
      "Run `squadquest-axi auth login --phone <number>` to sign in",
    ]);
  }
  return {
    apikey: key,
    Authorization: `Bearer ${credential.token}`,
    ...(contentType ? { "Content-Type": contentType } : {}),
  };
}

export async function uploadBanner(objectPath: string, image: ImageBytes): Promise<void> {
  const response = await fetch(`${baseUrl()}/storage/v1/object/${BUCKET}/${objectPath}`, {
    method: "POST",
    headers: { ...(await headers(image.contentType)), "x-upsert": "true" },
    body: new Uint8Array(image.bytes),
  });
  if (!response.ok) {
    throw new AxiError(`could not upload the banner (${response.status})`, "UPLOAD_FAILED", [
      "Run `squadquest-axi doctor` to check credentials and connectivity",
    ]);
  }
}

export async function moveBanner(from: string, to: string): Promise<void> {
  const response = await fetch(`${baseUrl()}/storage/v1/object/move`, {
    method: "POST",
    headers: await headers("application/json"),
    body: JSON.stringify({ bucketId: BUCKET, sourceKey: from, destinationKey: to }),
  });
  if (!response.ok) {
    throw new AxiError(`could not finalize the banner (${response.status})`, "UPLOAD_FAILED", [
      "The event was created; re-run `events edit <id> --banner <path>` to attach it",
    ]);
  }
}

/**
 * The stored value. The `&v=` cache-buster is load-bearing: the object path
 * never changes, so without it a replaced banner keeps serving the old image.
 */
export function bannerUrl(eventId: string): string {
  return `${baseUrl()}/storage/v1/render/image/public/${BUCKET}/${eventId}?width=1024&v=${Date.now()}`;
}

/** Where a banner lives before its event exists (matches the v1 client). */
export function pendingPath(userId: string): string {
  return `_pending/${userId}`;
}
