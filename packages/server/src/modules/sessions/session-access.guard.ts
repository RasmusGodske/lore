import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { SessionsRepository } from "./sessions.repository";
import { forbidden, sessionNotFound } from "../api";

/**
 * Mutating a session (exec, close) is allowed for its owner or an admin.
 * Reading any session is allowed for everyone; this guard is only on mutating routes.
 */
@Injectable()
export class SessionAccessGuard implements CanActivate {
  constructor(private readonly sessions: SessionsRepository) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const id = req.params.id as string;
    const s = this.sessions.get(id);
    if (!s) throw sessionNotFound(id);
    if (s.user_id !== req.principal.user.id && !req.principal.user.is_admin) {
      throw forbidden(`session '${id}' belongs to ${s.user_name}; only its owner or an admin may operate it`);
    }
    return true;
  }
}
