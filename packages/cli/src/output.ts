/** Output conventions: results on stdout, diagnostics on stderr, JSON when piped. */
export interface OutputOptions { json: boolean }

export const wantsJson = (flag: boolean | undefined): boolean => flag ?? !process.stdout.isTTY;

export function printJson(value: unknown) { process.stdout.write(JSON.stringify(value) + "\n"); }

export function printTable(rows: string[][], header?: string[]) {
  const all = header ? [header, ...rows] : rows;
  if (!all.length) return;
  const widths = all[0].map((_, i) => Math.max(...all.map((r) => (r[i] ?? "").length)));
  for (const r of all) process.stdout.write(r.map((c, i) => (i === r.length - 1 ? c : (c ?? "").padEnd(widths[i]))).join("  ").trimEnd() + "\n");
}

/** Renders one audit event as a person would want to read it. */
export function formatAuditEvent(e: Record<string, unknown>): string {
  const t = String(e.ts).replace("T", " ").replace(/\.\d+Z$/, "Z");
  const who = e.ip ? ` [${e.ip}]` : "";
  switch (e.op) {
    case "exec": {
      const head = `${t}${who} $ ${e.cmd}${e.cwd ? `   (cwd ${e.cwd})` : ""}`;
      const meta = `exit ${e.exit ?? "?"}  ${e.ms ?? "?"}ms` + (e.stdin_bytes ? `  stdin ${e.stdin_bytes}B` : "") + (e.truncated ? "  (truncated)" : "") + (e.transport_error ? `  TRANSPORT ERROR: ${e.transport_error}` : "");
      const body = [e.stdout ? indent(String(e.stdout)) : "", e.stderr ? indent(String(e.stderr), "  ! ") : ""].filter(Boolean).join("\n");
      return `${head}\n  ${meta}${body ? "\n" + body : ""}`;
    }
    case "push":
      return `${t}${who} push ${e.branch}: ${e.result}${e.main_after ? `  main ${String(e.main_before ?? "").slice(0, 7)} -> ${String(e.main_after).slice(0, 7)}` : ""}`;
    case "create":
      return `${t}${who} session created${e.purpose ? `: ${e.purpose}` : ""}  base ${String(e.base_commit ?? "").slice(0, 7)}`;
    case "close":
    case "reap": {
      const lost = [e.git_status ? `uncommitted:\n${indent(String(e.git_status))}` : "", e.unpushed ? `unpushed commits:\n${indent(String(e.unpushed))}` : ""].filter(Boolean).join("\n");
      return `${t}${who} session ${e.op === "close" ? "closed" : "reaped"}: ${e.reason}${lost ? "\n" + lost : ""}`;
    }
    case "fail":
      return `${t}${who} session FAILED: ${e.error}`;
    default:
      return `${t}${who} ${e.op} ${JSON.stringify(e)}`;
  }
}

const indent = (s: string, prefix = "    ") => s.replace(/\n$/, "").split("\n").map((l) => prefix + l).join("\n");
