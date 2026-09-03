import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";
import { SessionsService } from "./sessions.service";
import { ConfigService } from "../config";
import { DockerService } from "../docker";

/** Reconciles state with Docker at boot and reaps idle sessions on an interval. */
@Injectable()
export class ReaperService implements OnModuleInit {
  private readonly log = new Logger(ReaperService.name);

  constructor(
    private readonly sessions: SessionsService,
    private readonly config: ConfigService,
    private readonly docker: DockerService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  async onModuleInit() {
    try { await this.docker.ping(); await this.sessions.reconcile(); }
    catch (e) { this.log.error(`docker unavailable at boot; sessions cannot be created until it is: ${String(e)}`); }
    const timer = setInterval(() => void this.tick(), this.config.reaperIntervalMs);
    timer.unref();
    this.scheduler.addInterval("reaper", timer);
  }

  async tick() {
    try {
      const n = await this.sessions.reapIdle();
      if (n) this.log.log(`reaped ${n} idle session(s)`);
    } catch (e) { this.log.error(`reaper failed: ${String(e)}`); }
  }
}
