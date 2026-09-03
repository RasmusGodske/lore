import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { ApiModule } from "./modules/api";
import { ConfigModule } from "./modules/config";
import { DatabaseModule } from "./modules/database";
import { AuthModule } from "./modules/auth";
import { AuditModule } from "./modules/audit";
import { SessionsModule } from "./modules/sessions";
import { McpModule } from "./modules/mcp";

@Module({
  imports: [ConfigModule, DatabaseModule, AuthModule, AuditModule, ApiModule, ScheduleModule.forRoot(), SessionsModule, McpModule],
})
export class AppModule {}
