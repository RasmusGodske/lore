import { Controller, Get, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ZodResponse } from "nestjs-zod";
import { AdminGuard } from "../auth";
import { MirrorService } from "../git";
import { SessionsService } from "../sessions";
import { ConfigService } from "../config";
import { MirrorAttemptDto, MirrorStatusDto, StatusDto } from "./dto";

/** Everything an operator looks at and an agent never needs. All routes are admin-only. */
@ApiTags("admin")
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller("admin")
export class AdminController {
  private readonly startedAt = Date.now();

  constructor(private readonly mirror: MirrorService, private readonly sessions: SessionsService, private readonly config: ConfigService) {}

  @Get("status")
  @ApiOperation({ summary: "Server status: version, uptime, sandbox runtime, session counts, mirror state" })
  @ZodResponse({ status: 200, type: StatusDto })
  status(): StatusDto {
    return {
      version: this.config.env.LORE_VERSION,
      uptime_s: Math.round((Date.now() - this.startedAt) / 1000),
      sandbox_runtime: this.config.env.LORE_SANDBOX_RUNTIME,
      sessions: this.sessions.counts(),
      mirror: this.mirror.getStatus(),
    };
  }

  @Get("mirror")
  @ApiOperation({ summary: "Whether main is mirrored to a remote git repository, and how that is going" })
  @ZodResponse({ status: 200, type: MirrorStatusDto })
  mirrorStatus() { return this.mirror.getStatus(); }

  @Get("mirror/log")
  @ApiOperation({ summary: "The most recent mirror attempts, newest first" })
  @ZodResponse({ status: 200, type: [MirrorAttemptDto] })
  mirrorLog() { return this.mirror.getLog(); }

  @Post("mirror/sync")
  @ApiOperation({ summary: "Push main to the mirror now" })
  @ZodResponse({ status: 200, type: MirrorStatusDto })
  mirrorSync() { return this.mirror.syncNow(); }
}
