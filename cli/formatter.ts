/**
 * Output formatting for CLI commands.
 * Supports human-readable text and structured JSON output.
 * These two modes are never mixed.
 */

export interface OutputOptions {
  json?: boolean;
}

// ── Human-readable output helpers ───────────────────────────────────────────

export function header(text: string): string {
  return `\n${text}\n${'─'.repeat(Math.min(text.length + 4, 60))}`;
}

export function success(text: string): string {
  return `✓ ${text}`;
}

export function failure(text: string): string {
  return `✗ ${text}`;
}

export function warn(text: string): string {
  return `⚠ ${text}`;
}

export function info(text: string): string {
  return `ℹ ${text}`;
}

export function bullet(text: string, indent = 0): string {
  return `${' '.repeat(indent)}• ${text}`;
}

export function dimText(text: string): string {
  return `\x1b[2m${text}\x1b[0m`;
}

export function boldText(text: string): string {
  return `\x1b[1m${text}\x1b[0m`;
}

export function greenText(text: string): string {
  return `\x1b[32m${text}\x1b[0m`;
}

export function redText(text: string): string {
  return `\x1b[31m${text}\x1b[0m`;
}

export function yellowText(text: string): string {
  return `\x1b[33m${text}\x1b[0m`;
}

export function cyanText(text: string): string {
  return `\x1b[36m${text}\x1b[0m`;
}

// ── JSON output ─────────────────────────────────────────────────────────────

export function jsonOutput(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

// ── Unified output ──────────────────────────────────────────────────────────

export function output(text: string, opts?: OutputOptions): void {
  if (opts?.json) return; // JSON mode: text output is suppressed
  process.stdout.write(text + '\n');
}

export function outputJson(data: unknown, opts?: OutputOptions): void {
  if (opts?.json) {
    process.stdout.write(jsonOutput(data) + '\n');
  }
}

/** Output either human text or JSON, never both */
export function outputResult(
  textFn: () => string,
  jsonData: unknown,
  opts?: OutputOptions
): void {
  if (opts?.json) {
    process.stdout.write(jsonOutput(jsonData) + '\n');
  } else {
    process.stdout.write(textFn() + '\n');
  }
}
