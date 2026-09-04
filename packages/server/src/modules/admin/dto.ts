import { z } from "zod";
import { zodDto } from "../api";

export const RemoteStatusSchema = z.object({
  configured: z.boolean(),
  url: z.string().nullable().describe("The mirror remote, credentials removed"),
  last_attempt_at: z.string().nullable(),
  last_success_at: z.string().nullable(),
  last_error: z.string().nullable(),
  consecutive_failures: z.number().int(),
  diverged: z.boolean().describe("Local main and remote main moved independently; an operator must reconcile"),
});
export class RemoteStatusDto extends zodDto(RemoteStatusSchema) {}

export class RemoteAttemptDto extends zodDto(z.object({
  at: z.string(),
  ok: z.boolean(),
  duration_ms: z.number().int(),
  outcome: z.string(),
  error: z.string().nullable(),
  reason: z.enum(["boot", "session", "fetch", "sweep", "manual", "landing"]),
})) {}

export class StatusDto extends zodDto(z.object({
  version: z.string(),
  uptime_s: z.number().int(),
  sandbox_runtime: z.string(),
  sessions: z.object({ active: z.number().int(), total: z.number().int() }),
  remote: RemoteStatusSchema,
})) {}
