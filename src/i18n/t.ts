import * as vscode from 'vscode';

/**
 * Thin wrapper over `vscode.l10n.t()` so call sites have a stable
 * import path regardless of how the runtime evolves. The bundle
 * resolution itself is wired by VSCode via the `l10n` field in
 * package.json (`./l10n`).
 *
 * Usage:
 *   t('warehouse.statusBar.idle.multi', n)  // → "{N} warehouses" (or localised)
 *
 * Positional `{0}`, `{1}` … placeholders in the bundle string are
 * filled from the variadic args.
 */
export function t(key: string, ...args: (string | number)[]): string {
  if (args.length === 0) return vscode.l10n.t(key);
  return vscode.l10n.t(key, ...args);
}
