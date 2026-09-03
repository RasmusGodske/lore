import { Module } from "@nestjs/common";
import { SessionsService } from "./sessions.service";
import { SessionsController } from "./sessions.controller";
import { GitHttpController } from "./git-http.controller";
import { SessionsRepository } from "./sessions.repository";
import { SessionAccessGuard } from "./session-access.guard";
import { ReaperService } from "./reaper.service";
import { DockerModule } from "../docker";
import { GitModule } from "../git";

@Module({
  imports: [DockerModule, GitModule],
  providers: [SessionsService, SessionsRepository, SessionAccessGuard, ReaperService],
  controllers: [SessionsController, GitHttpController],
  exports: [SessionsService],
})
export class SessionsModule {}
