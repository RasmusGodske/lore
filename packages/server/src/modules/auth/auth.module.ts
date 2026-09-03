import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthService } from "./auth.service";
import { TokensService } from "./tokens.service";
import { UsersService } from "./users.service";
import { BearerAuthGuard } from "./bearer-auth.guard";
import { UsersController } from "./users.controller";
import { TokensController } from "./tokens.controller";

@Global()
@Module({
  providers: [AuthService, TokensService, UsersService, { provide: APP_GUARD, useClass: BearerAuthGuard }],
  controllers: [UsersController, TokensController],
  exports: [AuthService, TokensService, UsersService],
})
export class AuthModule {}
