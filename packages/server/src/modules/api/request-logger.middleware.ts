import { Injectable, Logger, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly log = new Logger("http");
  use(req: Request, res: Response, next: NextFunction) {
    const started = Date.now();
    res.on("finish", () => {
      const line = `${req.method} ${req.originalUrl.replace(/\/git\/[^/]+\//, "/git/<token>/")} ${res.statusCode} ${Date.now() - started}ms`;
      if (res.statusCode >= 500) this.log.error(line); else this.log.log(line);
    });
    next();
  }
}
