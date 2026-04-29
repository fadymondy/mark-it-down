import * as vscode from 'vscode';
import { SlideshowManager } from './slideshowManager';

export function registerSlideshowCommands(manager: SlideshowManager): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('markItDown.slideshow.previewLocal', () => manager.previewLocal()),
    vscode.commands.registerCommand('markItDown.slideshow.publish', () => manager.publish()),
    vscode.commands.registerCommand('markItDown.slideshow.copyShareUrl', () => manager.copyShareUrl()),
    vscode.commands.registerCommand('markItDown.slideshow.exportPdf', () => manager.exportPdf()),
  ];
}
