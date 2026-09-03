import { Module } from "@nestjs/common";
import { McpController } from "./mcp.controller";
import { McpServerFactory } from "./mcp-server.factory";
import { SessionsModule } from "../sessions";

@Module({ imports: [SessionsModule], providers: [McpServerFactory], controllers: [McpController] })
export class McpModule {}
