import * as vscode from 'vscode';
import { PublishManager } from './publishManager';

export function registerPublishCommands(manager: PublishManager): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('markItDown.publish.deploy', async () => {
      try {
        await manager.publishAll();
      } catch (err) {
        vscode.window.showErrorMessage(`Mark It Down publish: ${(err as Error).message}`);
      }
    }),
    vscode.commands.registerCommand('markItDown.publish.deployCurrent', async () => {
      try {
        await manager.publishCurrent();
      } catch (err) {
        vscode.window.showErrorMessage(`Mark It Down publish: ${(err as Error).message}`);
      }
    }),
    vscode.commands.registerCommand('markItDown.publish.copyUrl', (uri?: vscode.Uri) =>
      manager.copyShareUrl(uri),
    ),
    vscode.commands.registerCommand('markItDown.publish.openSite', () => manager.openSite()),
  ];
}
