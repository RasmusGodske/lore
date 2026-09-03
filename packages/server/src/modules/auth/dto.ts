import { z } from "zod";
import { zodDto } from "../api";

export const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  admin: z.boolean(),
  created_at: z.string(),
});
export class UserDto extends zodDto(UserSchema) {}

export class CreateUserDto extends zodDto(z.object({
  name: z.string().min(1).max(64).describe("Lowercase letters, digits, '.', '_' or '-'"),
  admin: z.boolean().default(false),
})) {}

export const TokenSchema = z.object({
  id: z.string(),
  label: z.string(),
  created_at: z.string(),
  last_used_at: z.string().nullable(),
  revoked_at: z.string().nullable(),
});
export class TokenDto extends zodDto(TokenSchema) {}

export class CreateTokenDto extends zodDto(z.object({
  label: z.string().min(1).max(64).describe("What this token is for, e.g. claude-code-laptop"),
})) {}

export class CreatedTokenDto extends zodDto(TokenSchema.extend({
  token: z.string().describe("The plaintext token. Shown once."),
})) {}

export class RevokedDto extends zodDto(z.object({ revoked: z.boolean() })) {}

export class MeDto extends zodDto(z.object({
  user: z.string(),
  user_id: z.string(),
  admin: z.boolean(),
  token: z.string().describe("Label of the token in use"),
})) {}
