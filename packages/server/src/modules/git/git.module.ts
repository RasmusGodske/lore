import { Module } from "@nestjs/common";
import { GitRepoService } from "./git-repo.service";
import { PushLockService } from "./push-lock.service";

@Module({ providers: [GitRepoService, PushLockService], exports: [GitRepoService, PushLockService] })
export class GitModule {}
