import { parseArgs, type ParseArgsConfig } from "node:util";
import { usage } from "./errors.js";

type Options = NonNullable<ParseArgsConfig["options"]>;

/** parseArgs with usage errors mapped to exit code 104. */
export function parse<O extends Options>(args: string[], options: O, allowPositionals = true) {
  try {
    return parseArgs({ args, options, allowPositionals, strict: true });
  } catch (e) {
    throw usage((e as Error).message);
  }
}

/** Splits `kb exec [opts] [id] -- cmd...` into the part before and after `--`. */
export function splitDoubleDash(args: string[]): { own: string[]; rest: string[] } {
  const i = args.indexOf("--");
  return i === -1 ? { own: args, rest: [] } : { own: args.slice(0, i), rest: args.slice(i + 1) };
}

/** Quote for sh when joining several argv words into one command string. */
export function shellQuote(s: string): string {
  return /^[A-Za-z0-9_\/.=:@%+,-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

export function joinCommand(parts: string[]): string {
  return parts.length === 1 ? parts[0] : parts.map(shellQuote).join(" ");
}
