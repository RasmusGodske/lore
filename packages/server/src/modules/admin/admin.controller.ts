import { Controller, Get, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ZodResponse } from "nestjs-zod";
import { AdminGuard } from "../auth";
import { RemoteService } from "../git";
import { SessionsService } from "../sessions";
import { ConfigService } from "../config";
import { RemoteAttemptDto, RemoteStatusDto, StatusDto } from "./dto";

/** Everything an operator looks at and an agent never needs. All routes are admin-only. */
@ApiTags("admin")
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller("admin")
export class AdminController {
  private readonly startedAt = Date.now();

  constructor(private readonly remote: RemoteService, private readonly sessions: SessionsService, private readonly config: ConfigService) {}

  @Get("status")
  @ApiOperation({ summary: "Server status: version, uptime, sandbox runtime, session counts, remote state" })
  @ZodResponse({ status: 200, type: StatusDto })
  status(): StatusDto {
    return {
      version: this.config.env.LORE_VERSION,
      uptime_s: Math.round((Date.now() - this.startedAt) / 1000),
      sandbox_runtime: this.config.env.LORE_SANDBOX_RUNTIME,
      sessions: this.sessions.counts(),
      remote: this.remote.getStatus(),
    };
  }

  @Get("remote")
  @ApiOperation({ summary: "Whether a remote repository is the source of truth, and how following it is going" })
  @ZodResponse({ status: 200, type: RemoteStatusDto })
  remoteStatus() { return this.remote.getStatus(); }

  @Get("remote/log")
  @ApiOperation({ summary: "The most recent remote fetches and landings, newest first" })
  @ZodResponse({ status: 200, type: [RemoteAttemptDto] })
  remoteLog() { return this.remote.getLog(); }

  @Post("remote/sync")
  @ApiOperation({ summary: "Fetch the remote now and bring local main in step with it" })
  @ZodResponse({ status: 200, type: RemoteStatusDto })
  async remoteSync() { await this.remote.refresh("manual"); return this.remote.getStatus(); }
}
