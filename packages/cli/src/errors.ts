/** Transport failures, mirroring the server's codes; also the CLI's exit codes. */
export class CliError extends Error {
  constructor(public readonly code: 100 | 101 | 102 | 103 | 104, message: string) {
    super(message);
    this.name = "CliError";
  }
}
export const usage = (msg: string) => new CliError(104, msg);
