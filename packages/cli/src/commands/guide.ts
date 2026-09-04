import { makeContext } from "../context.js";

/** `lore guide`: prints how lore works, fetched from the server so there is one copy of the text. */
export async function guide(args: string[]) {
  const { client } = makeContext();
  if (args[0] === "okf") { process.stdout.write(await client.okfSpec()); return; }
  if (args.length) { process.stderr.write("usage: lore guide [okf]\n"); process.exitCode = 104; return; }
  process.stdout.write(await client.guide());
}
