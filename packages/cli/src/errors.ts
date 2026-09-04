/** Transport failures, mirroring the server's codes; also the CLI's exit codes. */
export class CliError extends Error {
  constructor(public readonly code: 100 | 101 | 102 | 103 | 104, message: string) {
    super(message);
    this.name = "CliError";
  }
}
export const usage = (msg: string) => new CliError(104, msg);

/** Thrown to print a command's usage on stdout and exit 0 (`lore session --help`). */
export class HelpRequested extends Error {
  constructor(public readonly text: string) { super("help"); this.name = "HelpRequested"; }
}
export const wantsHelp = (args: string[]) => args.includes("--help") || args.includes("-h") || args[0] === "help";
