import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { Principal } from "./auth.service";

/** The authenticated user and token, set by BearerAuthGuard. */
export const CurrentPrincipal = createParamDecorator((_data: unknown, ctx: ExecutionContext): Principal => {
  return ctx.switchToHttp().getRequest().principal;
});

export const clientIp = (req: { ip?: string; headers: Record<string, unknown> }): string => {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length) return fwd.split(",")[0].trim();
  return req.ip ?? "";
};
