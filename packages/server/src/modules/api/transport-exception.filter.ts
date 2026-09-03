import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { Response } from "express";
import { ZodValidationException } from "nestjs-zod";
import { TransportError } from "./errors";

/** Every error leaves the server as `{ error: { code, message } }` with a transport code. */
@Catch()
export class TransportExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger("http");

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) return;

    if (exception instanceof TransportError) {
      res.status(exception.getStatus()).json(exception.getResponse());
      return;
    }
    if (exception instanceof ZodValidationException) {
      const zodError = exception.getZodError() as { issues: { path: PropertyKey[]; message: string }[] };
      const issues = zodError.issues.map((i) => `${i.path.map(String).join(".") || "body"}: ${i.message}`).join("; ");
      res.status(400).json({ error: { code: 104, message: `invalid request: ${issues}` } });
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = status === 401 || status === 403 ? 101 : status === 404 ? 102 : status < 500 ? 104 : 100;
      res.status(status).json({ error: { code, message: exception.message } });
      return;
    }
    const msg = exception instanceof Error ? exception.message : String(exception);
    this.log.error(`unhandled: ${msg}`, exception instanceof Error ? exception.stack : undefined);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: { code: 100, message: `orchestrator error: ${msg}` } });
  }
}
