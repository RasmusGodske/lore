import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { forbidden } from "../api";

/** Only users with the admin flag pass. Runs after BearerAuthGuard. */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    if (!req.principal?.user.is_admin) throw forbidden("admin required");
    return true;
  }
}
