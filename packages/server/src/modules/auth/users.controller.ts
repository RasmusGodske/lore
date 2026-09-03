import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ZodResponse } from "nestjs-zod";
import { UsersService, UserRow } from "./users.service";
import { AdminGuard } from "./admin.guard";
import { CreateTokenDto, CreatedTokenDto, CreateUserDto, UserDto } from "./dto";
import { TokensService } from "./tokens.service";
import { badRequest } from "../api";

export const toUserDto = (u: UserRow): UserDto => ({ id: u.id, name: u.name, admin: u.is_admin === 1, created_at: u.created_at });

@ApiTags("users")
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller("users")
export class UsersController {
  constructor(private readonly users: UsersService, private readonly tokens: TokensService) {}

  @Get()
  @ZodResponse({ status: 200, type: [UserDto], description: "All users (admin only)" })
  list() { return this.users.list().map(toUserDto); }

  @Post()
  @ZodResponse({ status: 201, type: UserDto, description: "Create a user (admin only)" })
  create(@Body() body: CreateUserDto) { return toUserDto(this.users.create(body.name, body.admin)); }

  @Post(":id/tokens")
  @ApiOperation({ summary: "Mint a token for a user (admin only). How a new user gets their first token; afterwards they mint their own" })
  @ZodResponse({ status: 201, type: CreatedTokenDto })
  mintToken(@Param("id") id: string, @Body() body: CreateTokenDto): CreatedTokenDto {
    const user = this.users.byId(id) ?? this.users.byName(id);
    if (!user) throw badRequest(`no user '${id}'`);
    const { token, row } = this.tokens.create(user.id, body.label);
    return { id: row.id, label: row.label, created_at: row.created_at, last_used_at: row.last_used_at, revoked_at: row.revoked_at, token };
  }
}
