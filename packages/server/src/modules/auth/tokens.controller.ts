import { Body, Controller, Delete, Get, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ZodResponse } from "nestjs-zod";
import { TokensService, TokenRow } from "./tokens.service";
import { CurrentPrincipal } from "./decorators";
import type { Principal } from "./auth.service";
import { CreateTokenDto, CreatedTokenDto, MeDto, RevokedDto, TokenDto } from "./dto";
import { forbidden } from "../api";

const toTokenDto = (t: TokenRow): TokenDto => ({ id: t.id, label: t.label, created_at: t.created_at, last_used_at: t.last_used_at, revoked_at: t.revoked_at });

@ApiTags("tokens")
@ApiBearerAuth()
@Controller()
export class TokensController {
  constructor(private readonly tokens: TokensService) {}

  @Get("me")
  @ZodResponse({ status: 200, type: MeDto, description: "Who the bearer token belongs to" })
  me(@CurrentPrincipal() p: Principal): MeDto {
    return { user: p.user.name, user_id: p.user.id, admin: p.user.is_admin === 1, token: p.token.label };
  }

  @Get("tokens")
  @ZodResponse({ status: 200, type: [TokenDto], description: "The caller's own tokens" })
  list(@CurrentPrincipal() p: Principal) { return this.tokens.listForUser(p.user.id).map(toTokenDto); }

  @Post("tokens")
  @ZodResponse({ status: 201, type: CreatedTokenDto, description: "Mint a token for the caller" })
  create(@CurrentPrincipal() p: Principal, @Body() body: CreateTokenDto): CreatedTokenDto {
    const { token, row } = this.tokens.create(p.user.id, body.label);
    return { ...toTokenDto(row), token };
  }

  @Delete("tokens/:id")
  @ZodResponse({ status: 200, type: RevokedDto, description: "Revoke one of the caller's tokens, or any token as admin" })
  revoke(@CurrentPrincipal() p: Principal, @Param("id") id: string): RevokedDto {
    const t = this.tokens.byId(id);
    if (t && t.user_id !== p.user.id && !p.user.is_admin) throw forbidden("not your token");
    return { revoked: this.tokens.revoke(id) };
  }
}
