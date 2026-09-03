import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthService } from "./auth.service";
import { IS_PUBLIC } from "../api";
import { clientIp } from "./decorators";

/** Global guard: every route needs a bearer token unless marked @Public(). */
@Injectable()
export class BearerAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService, private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest();
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "");
    req.principal = this.auth.authenticate(m?.[1], clientIp(req));
    return true;
  }
}
