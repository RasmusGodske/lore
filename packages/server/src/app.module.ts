import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { ApiModule } from "./modules/api";
import { ConfigModule } from "./modules/config";
import { DatabaseModule } from "./modules/database";
import { AuthModule } from "./modules/auth";
import { AuditModule } from "./modules/audit";
import { SessionsModule } from "./modules/sessions";
import { McpModule } from "./modules/mcp";
import { GuideModule } from "./modules/guide";
import { AdminModule } from "./modules/admin";

@Module({
  imports: [ConfigModule, DatabaseModule, AuthModule, AuditModule, ApiModule, ScheduleModule.forRoot(), SessionsModule, McpModule, GuideModule, AdminModule],
})
export class AppModule {}
