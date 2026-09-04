import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC = "lore:public";
/** Marks a route as reachable without a bearer token (health, git smart HTTP, OpenAPI). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
