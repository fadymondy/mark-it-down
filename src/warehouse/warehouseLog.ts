import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

export function getLogChannel(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel('Mark It Down: Warehouse');
  }
  return channel;
}

export function disposeLogChannel(): void {
  channel?.dispose();
  channel = undefined;
}

export function log(level: 'info' | 'warn' | 'error', ...parts: unknown[]): void {
  const ch = getLogChannel();
  const ts = new Date().toISOString();
  const tag = level.toUpperCase().padEnd(5);
  ch.appendLine(`${ts}  ${tag}  ${parts.map(stringify).join(' ')}`);
  if (level === 'error') {
    ch.show(true);
  }
}

function stringify(value: unknown): string {
  if (value instanceof Error) {
    return value.stack ?? value.message;
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
