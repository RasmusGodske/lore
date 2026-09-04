import type { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { cleanupOpenApiDoc } from "nestjs-zod";

export function buildOpenApiDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle("lore orchestrator")
    .setDescription("Sessions, exec and administration for the shared agent knowledge base. Every route except /health needs a bearer token.")
    .setVersion("0.1.0")
    .addBearerAuth()
    .setOpenAPIVersion("3.1.0")
    .build();
  return cleanupOpenApiDoc(SwaggerModule.createDocument(app, config));
}
