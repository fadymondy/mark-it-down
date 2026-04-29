import * as vscode from 'vscode';
import { WarehouseManager } from './warehouseManager';

export function registerWarehouseCommands(manager: WarehouseManager): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('markItDown.warehouse.syncNow', () => manager.syncNow()),
    vscode.commands.registerCommand('markItDown.warehouse.pull', () => manager.pullCommand()),
    vscode.commands.registerCommand('markItDown.warehouse.openOnGitHub', () => manager.openOnGitHub()),
    vscode.commands.registerCommand('markItDown.warehouse.openLog', () => manager.openLog()),
    vscode.commands.registerCommand('markItDown.warehouse.openConflicts', () =>
      manager.conflictPanel.reveal(),
    ),
  ];
}
