#!/usr/bin/env node
/**
 * lore-admin: bootstrap administration with direct database access.
 * Run inside the orchestrator container; needs LORE_DATA_DIR, nothing else.
 *
 *   lore-admin user create <name> [--admin]
 *   lore-admin user list
 *   lore-admin user admin <name> [--off]   grant (or remove) the admin flag
 *   lore-admin token create <user> <label>
 *   lore-admin token restore <id>         lift a revocation, e.g. of a proxy credential
 */
import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { parseArgs } from "node:util";
import { ConfigModule } from "./modules/config";
import { DatabaseModule } from "./modules/database";
import { UsersService } from "./modules/auth";
import { TokensService } from "./modules/auth";

@Module({ imports: [ConfigModule, DatabaseModule], providers: [UsersService, TokensService] })
class AdminModule {}

function usage(): never {
  process.stderr.write("usage: lore-admin (user create <name> [--admin] | user list | user admin <name> [--off] | token create <user> <label> | token restore <id>)\n");
  process.exit(104);
}

async function main() {
  const [group, sub, ...rest] = process.argv.slice(2);
  const ctx = await NestFactory.createApplicationContext(AdminModule, { logger: false });
  const users = ctx.get(UsersService);
  const tokens = ctx.get(TokensService);
  try {
    if (group === "user" && sub === "create") {
      const { values, positionals } = parseArgs({ args: rest, options: { admin: { type: "boolean" } }, allowPositionals: true });
      if (!positionals[0]) usage();
      const u = users.create(positionals[0], !!values.admin);
      console.log(`${u.id}  ${u.name}${u.is_admin ? "  admin" : ""}`);
    } else if (group === "user" && sub === "list") {
      for (const u of users.list()) console.log(`${u.id}  ${u.name}${u.is_admin ? "  admin" : ""}`);
    } else if (group === "user" && sub === "admin") {
      const { values, positionals } = parseArgs({ args: rest, options: { off: { type: "boolean" } }, allowPositionals: true });
      if (!positionals[0]) usage();
      const u = users.byName(positionals[0]);
      if (!u) { process.stderr.write(`lore-admin: no user '${positionals[0]}'\n`); process.exit(104); }
      users.setAdmin(u.id, !values.off);
      console.log(`${u.id}  ${u.name}${values.off ? "" : "  admin"}`);
    } else if (group === "token" && sub === "restore") {
      if (!rest[0]) usage();
      if (!tokens.restore(rest[0])) { process.stderr.write(`lore-admin: no revoked token '${rest[0]}'\n`); process.exit(104); }
      console.log(`${rest[0]}  restored`);
    } else if (group === "token" && sub === "create") {
      const [userName, label] = rest;
      if (!userName || !label) usage();
      const u = users.byName(userName);
      if (!u) { process.stderr.write(`lore-admin: no user '${userName}'\n`); process.exit(104); }
      console.log(tokens.create(u.id, label).token);
    } else usage();
  } catch (e: any) {
    process.stderr.write(`lore-admin: ${e?.response?.error?.message ?? e?.message ?? String(e)}\n`);
    process.exit(1);
  } finally {
    await ctx.close();
  }
}
main();
