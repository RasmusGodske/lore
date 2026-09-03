import { Injectable } from "@nestjs/common";
import { TokensService, TokenRow } from "./tokens.service";
import { UsersService, UserRow } from "./users.service";
import { authError } from "../api";

export interface Principal { user: UserRow; token: TokenRow; ip: string }

@Injectable()
export class AuthService {
  constructor(private readonly tokens: TokensService, private readonly users: UsersService) {}

  authenticate(bearer: string | undefined, ip: string): Principal {
    if (!bearer) throw authError("missing bearer token");
    const token = this.tokens.findLive(bearer);
    if (!token) throw authError("invalid or revoked token");
    const user = this.users.byId(token.user_id);
    if (!user) throw authError("token has no user");
    this.tokens.touch(token.id);
    return { user, token, ip };
  }
}
