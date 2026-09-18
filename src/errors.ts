import { AxiError } from "axi-sdk-js";

/**
 * An `AxiError` that carries extra structured blocks to render alongside the
 * error — a candidate list, a near-miss set, the names that failed to resolve.
 *
 * Per AXI §4 the expensive cost is the follow-up call, so an ambiguous name
 * should hand the agent everything it needs to correct in one turn rather than
 * making it run a search command first. `cli.ts` merges `details` into the
 * rendered error object.
 */
export class DetailedError extends AxiError {
  readonly details: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    details: Record<string, unknown>,
    suggestions: string[] = [],
  ) {
    super(message, code, suggestions);
    this.details = details;
  }
}

/** A flag the caller must supply — usage error, exit 2 (AXI §6). */
export function usage(message: string, ...suggestions: string[]): AxiError {
  return new AxiError(message, "USAGE", suggestions);
}
