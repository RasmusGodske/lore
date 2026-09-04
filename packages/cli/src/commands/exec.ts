import { makeContext, resolveSessionId } from "../context.js";
import { joinCommand, parse, splitDoubleDash } from "../args.js";
import { printJson } from "../output.js";
import { usage } from "../errors.js";

const HELP = `usage: lore exec [ID] [--cwd DIR] [--timeout MS] [--json] -- <command...>

Runs the command with sh -c in the session's sandbox. The command's stdout, stderr and exit
code pass through untouched. When stdin is not a terminal it is streamed to the command:

  lore exec -- 'cat > topics/nightly-import.md' < nightly-import.md
  tar -C docs -c . | lore exec -- 'tar -x -C talks'`;

export async function exec(args: string[]) {
  const { own, rest } = splitDoubleDash(args);
  const { values, positionals } = parse(own, { cwd: { type: "string" }, timeout: { type: "string" }, json: { type: "boolean" }, "no-stdin": { type: "boolean" } });
  if (rest.length === 0) throw usage(HELP);
  const id = resolveSessionId(positionals[0]);
  const command = joinCommand(rest);
  const timeout_ms = values.timeout ? Number(values.timeout) : undefined;
  if (timeout_ms !== undefined && !Number.isFinite(timeout_ms)) throw usage("--timeout must be a number of milliseconds");

  const { client } = makeContext();
  const useStdin = !process.stdin.isTTY && !values["no-stdin"];
  const r = useStdin
    ? await client.execStdin(id, command, process.stdin, { cwd: values.cwd, timeout_ms })
    : await client.exec(id, { command, cwd: values.cwd, timeout_ms });

  if (values.json) { printJson(r); process.exitCode = r.exit_code; return; }
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  if (r.truncated) process.stderr.write("lore-note: output truncated at the server's cap\n");
  process.exitCode = r.exit_code;
}
