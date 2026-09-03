/** Prints the OpenAPI document without starting the server or touching Docker. */
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { buildOpenApiDocument } from "./modules/api";

async function main() {
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  process.stdout.write(JSON.stringify(buildOpenApiDocument(app), null, 2) + "\n");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
