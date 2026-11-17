import { existsSync, lstatSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

/**
 * The `--json-out[=path]` side channel (jarvus-axi machine-output rules).
 * Ported from the canonical export writer in gws-axi `src/util/export.ts`,
 * narrowed to JSON: a bare flag writes to a private per-user temp directory
 * with an exclusive create at 0600; `=path` writes where the caller says.
 * Never throws — a failed write must not discard a result already fetched.
 */

export type ExportTarget = string | true;

export function expandPath(path: string): string {
  const expanded =
    path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
  return isAbsolute(expanded) ? expanded : resolve(expanded);
}

export function autoExportDir(): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  return join(tmpdir(), uid === undefined ? "squadquest-axi" : `squadquest-axi-${uid}`);
}

function resolvePath(target: ExportTarget, kind: string, now: Date): { path: string; auto: boolean } {
  if (target !== true) return { path: expandPath(target), auto: false };
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return { path: join(autoExportDir(), `${stamp}-${kind}.json`), auto: true };
}

function quotePath(path: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(path) ? path : `'${path.replace(/'/g, `'\\''`)}'`;
}

class UnsafeDir extends Error {}

function ensurePrivateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = lstatSync(dir);
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  if (!st.isDirectory()) throw new UnsafeDir(`${dir} is not a directory (a symlink?)`);
  if (uid === undefined) return;
  if (st.uid !== uid) throw new UnsafeDir(`${dir} belongs to another user`);
  if ((st.mode & 0o077) !== 0) {
    throw new UnsafeDir(`${dir} is readable or writable by others (mode ${(st.mode & 0o777).toString(8)})`);
  }
}

function writeExclusive(path: string, data: string): string {
  const dot = path.lastIndexOf(".");
  for (let n = 1; n < 100; n++) {
    const candidate = n === 1 ? path : `${path.slice(0, dot)}-${n}${path.slice(dot)}`;
    try {
      writeFileSync(candidate, data, { mode: 0o600, flag: "wx" });
      return candidate;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
  throw new UnsafeDir(`no free name beside ${path}`);
}

export type ExportOutcome =
  | { ok: true; path: string; wrote: string; helpLine: string }
  | { ok: false; path: string; error: string; helpLine: string };

/**
 * Check an explicit `=path` can be written BEFORE any work happens: its
 * directory must exist. Returns a reason, or undefined when it looks fine.
 */
export function precheckExport(target: ExportTarget): string | undefined {
  if (target === true) return undefined;
  const path = expandPath(target);
  if (!existsSync(dirname(path))) return `the directory of ${path} does not exist`;
  if (existsSync(path) && statSync(path).isDirectory()) return `${path} is a directory`;
  return undefined;
}

export function writeJsonExport(
  target: ExportTarget,
  kind: string,
  payload: { rows: Array<Record<string, unknown>> },
  cols: number,
  now: Date = new Date(),
): ExportOutcome {
  const resolved = resolvePath(target, kind, now);
  let path = resolved.path;
  let overwrote = false;
  const data = `${JSON.stringify(payload, null, 2)}\n`;
  try {
    if (resolved.auto) {
      ensurePrivateDir(dirname(path));
      path = writeExclusive(path, data);
    } else {
      overwrote = existsSync(path) && statSync(path).isFile();
      writeFileSync(path, data, { mode: 0o600 });
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const reason =
      err instanceof UnsafeDir
        ? `refused: ${err.message}`
        : code === "ENOENT"
          ? "its directory does not exist"
          : code === "EACCES"
            ? "permission denied"
            : code === "EISDIR"
              ? "that path is a directory"
              : (code ?? (err as Error).message);
    return {
      ok: false,
      path,
      error: `could not write the --json-out file: ${reason}`,
      helpLine: resolved.auto
        ? "Nothing was written; pass a path you can write: --json-out=<path>"
        : "Nothing was written; create the directory first, or pass --json-out alone for a file in the temp dir",
    };
  }
  return {
    ok: true,
    path,
    wrote: `${path} (${payload.rows.length} rows, ${cols} cols${overwrote ? ", overwrote" : ""})`,
    helpLine: `Run \`jq '.rows[]' ${quotePath(path)}\` to process the full result (every row, uncapped)`,
  };
}
