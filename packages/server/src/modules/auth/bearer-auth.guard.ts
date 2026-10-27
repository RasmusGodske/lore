import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthService } from "./auth.service";
import { IS_PUBLIC } from "../api";
import { clientIp } from "./decorators";

/** Global guard: every route needs a bearer token, or a trusted proxy's identity header, unless marked @Public(). */
@Injectable()
export class BearerAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService, private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest();
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "");
    const header = this.auth.trustedHeader;
    req.principal = this.auth.authenticate({
      bearer: m?.[1],
      identity: header ? req.headers[header] : undefined,
      peer: req.socket?.remoteAddress ?? "",
      ip: clientIp(req),
    });
    return true;
  }
}
