import { All, Controller, Req, Res } from "@nestjs/common";
import { ApiBearerAuth, ApiExcludeController } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { McpServerFactory } from "./mcp-server.factory";

/**
 * MCP over streamable HTTP, stateless: one server and transport per request.
 * Sessions are explicit tools, so no MCP-level session state is needed.
 */
@ApiExcludeController()
@ApiBearerAuth()
@Controller("mcp")
export class McpController {
  constructor(private readonly factory: McpServerFactory) {}

  @All()
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (req.method !== "POST") {
      res.status(405).json({ error: { code: 104, message: "stateless MCP endpoint: use POST" } });
      return;
    }
    const server = this.factory.build((req as any).principal);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }
}
