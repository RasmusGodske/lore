import { z } from "zod";
import { zodDto } from "../api";

export const SessionStateSchema = z.enum(["created", "active", "closed", "expired", "failed"]);

export const SessionSchema = z.object({
  id: z.string(),
  state: SessionStateSchema,
  branch: z.string(),
  user: z.string().describe("Name of the user who created the session"),
  user_id: z.string(),
  token_label: z.string(),
  purpose: z.string().nullable(),
  base_commit: z.string().nullable(),
  created_at: z.string(),
  last_activity_at: z.string(),
  closed_at: z.string().nullable(),
  close_reason: z.string().nullable(),
});
export class SessionDto extends zodDto(SessionSchema) {}

export class CreateSessionDto extends zodDto(z.object({
  purpose: z.string().max(500).optional().describe("What this session is for, one line"),
})) {}

export class ListSessionsQueryDto extends zodDto(z.object({
  all: z.coerce.boolean().default(false).describe("Include closed, expired and failed sessions"),
  user: z.string().optional().describe("Only sessions created by this user id"),
})) {}

export const ExecOptionsSchema = z.object({
  cwd: z.string().optional().describe("Working directory relative to /workspace"),
  timeout_ms: z.number().int().min(1000).max(600_000).optional().describe("Default 60000"),
});
export class ExecDto extends zodDto(ExecOptionsSchema.extend({
  command: z.string().min(1).describe("Shell command, run with sh -c"),
})) {}

export const ExecResultSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exit_code: z.number().int(),
  duration_ms: z.number().int(),
  stdin_bytes: z.number().int(),
  truncated: z.boolean().describe("Output exceeded the cap and was cut"),
});
export class ExecResultDto extends zodDto(ExecResultSchema) {}

export const AuditEventSchema = z.object({
  ts: z.string(),
  session: z.string(),
  op: z.enum(["create", "exec", "push", "close", "reap", "fail"]),
}).catchall(z.unknown());
export class AuditEventDto extends zodDto(AuditEventSchema) {}
