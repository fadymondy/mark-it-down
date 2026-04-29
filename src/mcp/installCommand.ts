import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ipcEndpoint } from './ipcProtocol';

interface ClientTarget {
  id: 'claude-desktop' | 'claude-code';
  label: string;
  configPath: string;
  description: string;
}

const SERVER_KEY = 'mark-it-down';

export function registerMcpInstallCommands(context: vscode.ExtensionContext): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('markItDown.mcp.install', () => installToClient(context)),
    vscode.commands.registerCommand('markItDown.mcp.revealServer', async () => {
      const serverPath = mcpServerPath(context);
      const exists = await pathExists(serverPath);
      if (!exists) {
        vscode.window.showWarningMessage(
          `Mark It Down MCP server not found at ${serverPath}. Run \`npm run compile\` first.`,
        );
        return;
      }
      await vscode.env.clipboard.writeText(serverPath);
      vscode.window.showInformationMessage(
        `Mark It Down: copied MCP server path to clipboard — ${serverPath}`,
      );
    }),
  ];
}

async function installToClient(context: vscode.ExtensionContext): Promise<void> {
  const targets = candidateTargets();
  if (targets.length === 0) {
    vscode.window.showErrorMessage(
      'Mark It Down: no Claude Desktop / Claude Code config locations were detected on this OS.',
    );
    return;
  }
  const choice = await vscode.window.showQuickPick(
    targets.map(t => ({
      label: t.label,
      description: t.description,
      detail: t.configPath,
      target: t,
    })),
    { placeHolder: 'Where should we install the Mark It Down MCP?' },
  );
  if (!choice) return;
  await applyInstall(context, (choice as { target: ClientTarget }).target);
}

async function applyInstall(
  context: vscode.ExtensionContext,
  target: ClientTarget,
): Promise<void> {
  const serverPath = mcpServerPath(context);
  if (!(await pathExists(serverPath))) {
    vscode.window.showErrorMessage(
      `Mark It Down: MCP server not built (${serverPath}). Run "npm run compile" first.`,
    );
    return;
  }
  const notesDir = path.join(context.globalStorageUri.fsPath, 'notes');
  const ipcSock = ipcEndpoint(context.globalStorageUri.fsPath);
  const entry = {
    command: process.execPath,
    args: [serverPath, '--notes-dir', notesDir, '--ipc-sock', ipcSock],
  };
  let raw = '{}';
  try {
    raw = await fs.readFile(target.configPath, 'utf8');
  } catch {
    await fs.mkdir(path.dirname(target.configPath), { recursive: true });
  }
  let json: { mcpServers?: Record<string, unknown> } = {};
  try {
    json = raw.trim().length > 0 ? JSON.parse(raw) : {};
  } catch {
    const ok = await vscode.window.showWarningMessage(
      `${target.label} config at ${target.configPath} is not valid JSON. Overwrite?`,
      { modal: true },
      'Overwrite',
    );
    if (ok !== 'Overwrite') return;
  }
  json.mcpServers = json.mcpServers ?? {};
  json.mcpServers[SERVER_KEY] = entry;
  await fs.writeFile(target.configPath, JSON.stringify(json, null, 2) + '\n', 'utf8');
  const action = await vscode.window.showInformationMessage(
    `Mark It Down MCP installed to ${target.label}. Restart ${target.label} to pick it up.`,
    'Reveal Config',
    'OK',
  );
  if (action === 'Reveal Config') {
    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(target.configPath));
  }
}

function candidateTargets(): ClientTarget[] {
  const home = os.homedir();
  const platform = process.platform;
  const targets: ClientTarget[] = [];

  if (platform === 'darwin') {
    targets.push({
      id: 'claude-desktop',
      label: 'Claude Desktop',
      description: 'macOS — ~/Library/Application Support/Claude',
      configPath: path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
    });
    targets.push({
      id: 'claude-code',
      label: 'Claude Code (project-level)',
      description: 'Current workspace — ./.mcp.json',
      configPath: workspaceMcpPath() ?? path.join(home, '.mcp.json'),
    });
  } else if (platform === 'win32') {
    targets.push({
      id: 'claude-desktop',
      label: 'Claude Desktop',
      description: 'Windows — %APPDATA%/Claude',
      configPath: path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json'),
    });
    targets.push({
      id: 'claude-code',
      label: 'Claude Code (project-level)',
      description: 'Current workspace — ./.mcp.json',
      configPath: workspaceMcpPath() ?? path.join(home, '.mcp.json'),
    });
  } else {
    // linux
    targets.push({
      id: 'claude-desktop',
      label: 'Claude Desktop',
      description: 'Linux — ~/.config/Claude',
      configPath: path.join(home, '.config', 'Claude', 'claude_desktop_config.json'),
    });
    targets.push({
      id: 'claude-code',
      label: 'Claude Code (project-level)',
      description: 'Current workspace — ./.mcp.json',
      configPath: workspaceMcpPath() ?? path.join(home, '.mcp.json'),
    });
  }
  return targets;
}

function workspaceMcpPath(): string | undefined {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return undefined;
  return path.join(folder.uri.fsPath, '.mcp.json');
}

function mcpServerPath(context: vscode.ExtensionContext): string {
  return path.join(context.extensionUri.fsPath, 'out', 'mcp', 'server.js');
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}
