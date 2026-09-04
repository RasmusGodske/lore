import { makeContext } from "../context.js";

/** `lore guide`: prints how lore works, fetched from the server so there is one copy of the text. */
export async function guide(_args: string[]) {
  const { client } = makeContext();
  process.stdout.write(await client.guide());
}
