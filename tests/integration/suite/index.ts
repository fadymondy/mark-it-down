import Mocha from 'mocha';
import { glob } from 'glob';
import * as path from 'path';

export async function run(): Promise<void> {
  // The .test.ts files use TDD globals (`suite()` / `test()`); the previous
  // BDD config left them throwing `ReferenceError: suite is not defined` on
  // every CI run since v0.2.4. Switching to TDD makes the existing suites
  // work without rewriting any tests (#323).
  const mocha = new Mocha({
    ui: 'tdd',
    color: true,
    timeout: 30_000,
  });
  const testsRoot = path.resolve(__dirname, '..');
  const files = await glob('**/*.test.js', { cwd: testsRoot });
  for (const f of files) {
    mocha.addFile(path.resolve(testsRoot, f));
  }
  return new Promise((resolve, reject) => {
    try {
      mocha.run(failures => {
        if (failures > 0) reject(new Error(`${failures} test(s) failed`));
        else resolve();
      });
    } catch (err) {
      reject(err);
    }
  });
}
