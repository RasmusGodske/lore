import { HttpException } from "@nestjs/common";

/**
 * Transport-level failures: the request did not reach or complete in the sandbox.
 * Distinct from a command that ran and exited non-zero, which is a successful call.
 * Codes double as CLI exit codes. See spec 04-interfaces.md "Errors: two vocabularies".
 */
export type TransportCode = 100 | 101 | 102 | 103 | 104;

export class TransportError extends HttpException {
  constructor(public readonly code: TransportCode, message: string, httpStatus: number) {
    super({ error: { code, message } }, httpStatus);
    this.name = "TransportError";
  }
}

export const connectionError = (msg: string) => new TransportError(100, msg, 502);
export const authError = (msg = "authentication failed") => new TransportError(101, msg, 401);
export const forbidden = (msg: string) => new TransportError(101, msg, 403);
export const sessionNotFound = (id: string) => new TransportError(102, `session '${id}' not found or not active`, 404);
export const timeoutError = (msg: string) => new TransportError(103, msg, 504);
export const badRequest = (msg: string) => new TransportError(104, msg, 400);
