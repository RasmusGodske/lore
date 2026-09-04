import { Module } from "@nestjs/common";
import { GitRepoService } from "./git-repo.service";
import { PushLockService } from "./push-lock.service";
import { MirrorService } from "./mirror.service";

@Module({ providers: [GitRepoService, PushLockService, MirrorService], exports: [GitRepoService, PushLockService, MirrorService] })
export class GitModule {}
