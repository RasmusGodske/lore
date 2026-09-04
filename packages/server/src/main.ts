import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { NestExpressApplication } from "@nestjs/platform-express";
import { SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { ConfigService } from "./modules/config";
import { buildOpenApiDocument } from "./modules/api";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: true, rawBody: false });
  app.set("trust proxy", true);
  app.disable("x-powered-by");
  app.enableShutdownHooks();

  const doc = buildOpenApiDocument(app);
  SwaggerModule.setup("docs", app, doc, { jsonDocumentUrl: "/docs/openapi.json" });

  const config = app.get(ConfigService);
  await app.listen(config.env.LORE_PORT, "0.0.0.0");
  new Logger("bootstrap").log(`lore-server listening on ${config.env.LORE_PORT} (runtime ${config.env.LORE_SANDBOX_RUNTIME}, data ${config.dataDir})`);
}
bootstrap().catch((e) => { console.error(e); process.exit(1); });
