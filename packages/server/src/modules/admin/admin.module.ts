import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { GitModule } from "../git";
import { SessionsModule } from "../sessions";

@Module({ imports: [GitModule, SessionsModule], controllers: [AdminController] })
export class AdminModule {}
