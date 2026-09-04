import { Module } from "@nestjs/common";
import { GitRepoService } from "./git-repo.service";
import { PushLockService } from "./push-lock.service";
import { RemoteService } from "./remote.service";

@Module({ providers: [GitRepoService, PushLockService, RemoteService], exports: [GitRepoService, PushLockService, RemoteService] })
export class GitModule {}
