import { Body, Controller, Delete, Get, Headers, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiConsumes, ApiHeader, ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from "@nestjs/swagger";
import { ZodResponse } from "nestjs-zod";
import type { Request, Response } from "express";
import { SessionsService } from "./sessions.service";
import { SessionAccessGuard } from "./session-access.guard";
import { AuditService } from "../audit";
import { CurrentPrincipal } from "../auth";
import type { Principal } from "../auth";
import { AuditEventDto, CreateSessionDto, ExecDto, ExecResultDto, ListSessionsQueryDto, SessionDto } from "./dto";
import { badRequest } from "../api";

@ApiTags("sessions")
@ApiBearerAuth()
@Controller("sessions")
export class SessionsController {
  constructor(private readonly sessions: SessionsService, private readonly audit: AuditService) {}

  @Post()
  @ApiOperation({ summary: "Create a session: a fresh sandbox with its own checkout and branch" })
  @ZodResponse({ status: 201, type: SessionDto })
  create(@CurrentPrincipal() p: Principal, @Body() body: CreateSessionDto) {
    return this.sessions.create(p, body);
  }

  @Get()
  @ApiOperation({ summary: "List sessions. Active ones by default; every user's sessions are visible" })
  @ZodResponse({ status: 200, type: [SessionDto] })
  list(@Query() q: ListSessionsQueryDto) {
    return this.sessions.list({ all: q.all, userId: q.user });
  }

  @Get(":id")
  @ApiOperation({ summary: "Show one session" })
  @ZodResponse({ status: 200, type: SessionDto })
  show(@Param("id") id: string) { return this.sessions.get(id); }

  @Delete(":id")
  @UseGuards(SessionAccessGuard)
  @ApiOperation({ summary: "Close a session: remove its sandbox and workspace. Unpushed work is discarded" })
  @ZodResponse({ status: 200, type: SessionDto })
  close(@CurrentPrincipal() p: Principal, @Param("id") id: string) { return this.sessions.close(p, id); }

  @Post(":id/exec")
  @UseGuards(SessionAccessGuard)
  @ApiOperation({ summary: "Run a shell command in the session's sandbox. A non-zero exit code is a successful call" })
  @ZodResponse({ status: 200, type: ExecResultDto })
  exec(@CurrentPrincipal() p: Principal, @Param("id") id: string, @Body() body: ExecDto) {
    return this.sessions.exec(p, id, body.command, { cwd: body.cwd, timeoutMs: body.timeout_ms });
  }

  @Post(":id/exec/stdin")
  @UseGuards(SessionAccessGuard)
  @ApiOperation({ summary: "Run a shell command with the request body streamed to its stdin. Command and options travel in headers" })
  @ApiConsumes("application/octet-stream")
  @ApiHeader({ name: "x-lore-command", required: true, description: "The command, percent-encoded (encodeURIComponent)" })
  @ApiHeader({ name: "x-lore-cwd", required: false, description: "Working directory relative to /workspace" })
  @ApiHeader({ name: "x-lore-timeout-ms", required: false, description: "Timeout in milliseconds" })
  @ZodResponse({ status: 200, type: ExecResultDto })
  execStdin(
    @CurrentPrincipal() p: Principal, @Param("id") id: string, @Req() req: Request,
    @Headers("x-lore-command") encoded?: string, @Headers("x-lore-cwd") cwd?: string, @Headers("x-lore-timeout-ms") timeout?: string,
  ) {
    if (!encoded) throw badRequest("x-lore-command header is required");
    let command: string;
    try { command = decodeURIComponent(encoded); } catch { throw badRequest("x-lore-command must be percent-encoded"); }
    const timeoutMs = timeout ? Number(timeout) : undefined;
    if (timeoutMs !== undefined && !Number.isFinite(timeoutMs)) throw badRequest("x-lore-timeout-ms must be a number");
    return this.sessions.exec(p, id, command, { cwd: cwd || undefined, timeoutMs, stdin: req });
  }

  @Get(":id/log")
  @ApiOperation({ summary: "The session's audit log, one JSON object per line (application/x-ndjson). Add ?format=json for an array" })
  @ApiProduces("application/x-ndjson", "application/json")
  @ApiOkResponse({ type: [AuditEventDto], description: "Audit events in order" })
  log(@Param("id") id: string, @Query("format") format: string | undefined, @Res({ passthrough: true }) res: Response) {
    this.sessions.get(id);
    const rows = this.audit.forSession(id);
    if (format === "json") return rows.map(AuditService.toEvent);
    res.type("application/x-ndjson");
    return AuditService.toJsonl(rows);
  }
}
