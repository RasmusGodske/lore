import { Controller, Get, Header } from "@nestjs/common";
import { ApiOperation, ApiProduces, ApiTags } from "@nestjs/swagger";
import { Public } from "../api";
import { GUIDE } from "./guide";
import { OKF_SPEC } from "./okf-spec";

@ApiTags("guide")
@Controller("guide")
export class GuideController {
  @Public()
  @Get()
  @Header("content-type", "text/markdown; charset=utf-8")
  @ApiOperation({ summary: "How lore works, as markdown. The same text the MCP server hands to clients on initialize" })
  @ApiProduces("text/markdown")
  guide(): string { return GUIDE; }

  @Public()
  @Get("okf")
  @Header("content-type", "text/markdown; charset=utf-8")
  @ApiOperation({ summary: "The Open Knowledge Format specification lore documents follow, vendored (Apache-2.0, Google LLC)" })
  @ApiProduces("text/markdown")
  okf(): string { return OKF_SPEC; }
}
