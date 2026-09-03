import { createHash, randomBytes } from "node:crypto";

/** Unambiguous lowercase alphabet: no 0/o, 1/l/i. Safe in branch names and URLs. */
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function shortId(len = 6): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}
export const newSecret = (prefix: string) => `${prefix}_${randomBytes(24).toString("hex")}`;
export const hashSecret = (secret: string) => createHash("sha256").update(secret).digest("hex");
