import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

const EXTENSION_ID = 'fadymondy.mark-it-down';

suite('Mark It Down — extension activation', () => {
  test('extension is present', () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `extension ${EXTENSION_ID} should be loaded`);
  });

  test('extension activates without errors', async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext);
    await ext!.activate();
    assert.strictEqual(ext!.isActive, true);
  });
});

suite('Mark It Down — commands', () => {
  test('every contributed command is registered after activation', async () => {
    await vscode.extensions.getExtension(EXTENSION_ID)!.activate();
    const commands = await vscode.commands.getCommands(true);
    const expected = [
      'markItDown.toggleMode',
      'markItDown.notes.create',
      'markItDown.notes.open',
      'markItDown.warehouse.syncNow',
      'markItDown.publish.deploy',
      'markItDown.slideshow.previewLocal',
      'markItDown.pickTheme',
      'markItDown.mcp.install',
      'markItDown.updates.checkNow',
      'markItDown.exportPdf',
      'markItDown.exportDocx',
      'markItDown.exportTxt',
    ];
    for (const cmd of expected) {
      assert.ok(commands.includes(cmd), `command "${cmd}" should be registered`);
    }
  });

  test('Pick Theme command exists and is callable', async () => {
    await vscode.extensions.getExtension(EXTENSION_ID)!.activate();
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('markItDown.pickTheme'));
    // We don't actually invoke it (would open a Quick Pick that hangs the test runner);
    // command-existence is sufficient smoke for v0.x.
  });
});

suite('Mark It Down — custom editor', () => {
  test('opens a markdown file with the markItDown.editor view type', async () => {
    await vscode.extensions.getExtension(EXTENSION_ID)!.activate();

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mid-int-'));
    const tmpFile = path.join(tmpDir, 'sample.md');
    await fs.writeFile(tmpFile, '# Hello\n\nIntegration test sample.\n', 'utf8');

    const uri = vscode.Uri.file(tmpFile);
    await vscode.commands.executeCommand('vscode.openWith', uri, 'markItDown.editor');

    // Give the webview a moment to initialize; just verify the command didn't throw.
    await new Promise(r => setTimeout(r, 250));
    // Custom editor doesn't surface as activeTextEditor (it's a webview); the assertion
    // is that openWith resolved without rejecting.
    assert.ok(true);

    // Cleanup
    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});

suite('Mark It Down — settings', () => {
  test('contributes the expected configuration namespaces', () => {
    const cfg = vscode.workspace.getConfiguration('markItDown');
    // Reading any registered setting succeeds; absence would throw or undefined-out unexpectedly.
    assert.notStrictEqual(cfg.get('theme'), undefined);
    assert.notStrictEqual(cfg.get('startMode'), undefined);
    assert.strictEqual(typeof cfg.get('mermaid.enabled'), 'boolean');
    assert.ok(Array.isArray(cfg.get('notes.categories')));
  });
});
