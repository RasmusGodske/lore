import { z } from "zod";
import { zodDto } from "../api";

export const MirrorStatusSchema = z.object({
  configured: z.boolean(),
  url: z.string().nullable().describe("The mirror remote, credentials removed"),
  last_attempt_at: z.string().nullable(),
  last_success_at: z.string().nullable(),
  last_error: z.string().nullable(),
  consecutive_failures: z.number().int(),
  pending: z.boolean().describe("A push is scheduled or running"),
});
export class MirrorStatusDto extends zodDto(MirrorStatusSchema) {}

export class MirrorAttemptDto extends zodDto(z.object({
  at: z.string(),
  ok: z.boolean(),
  duration_ms: z.number().int(),
  error: z.string().nullable(),
  reason: z.enum(["landing", "boot", "sweep", "retry", "manual"]),
})) {}

export class StatusDto extends zodDto(z.object({
  version: z.string(),
  uptime_s: z.number().int(),
  sandbox_runtime: z.string(),
  sessions: z.object({ active: z.number().int(), total: z.number().int() }),
  mirror: MirrorStatusSchema,
})) {}
