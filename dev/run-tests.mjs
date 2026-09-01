#!/usr/bin/env node
/**
 * Runs the browser test suite from the command line.
 *
 * tests.html is the primary way to run these. This just gives the same suite a
 * terminal exit code. It builds a minimal `window`, loads the same three scripts the
 * page loads, and prints the results.
 *
 *   node dev/run-tests.mjs
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const DEV = dirname(fileURLToPath(import.meta.url));
const ROOT = join(DEV, '..');
const SCRIPTS = [
  join(ROOT, 'data.generated.js'),
  join(ROOT, 'calculations.js'),
  join(DEV, 'tests.js')
];

const sandbox = { console, Intl, Date, Math, JSON, Number, Object, Array, String, Error };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const file of SCRIPTS) {
  const source = await readFile(file, 'utf8');
  new vm.Script(source, { filename: file }).runInContext(sandbox);
}

const results = sandbox.window.SuperCapTests.runAll();

const GREEN = '\u001b[32m';
const RED = '\u001b[31m';
const DIM = '\u001b[2m';
const RESET = '\u001b[0m';

for (const suite of results.suites) {
  const suiteFailed = suite.cases.filter((testCase) => !testCase.passed).length;
  console.log(`\n${suiteFailed ? RED : GREEN}${suite.name}${RESET}`);
  for (const testCase of suite.cases) {
    if (testCase.passed) {
      console.log(`  ${GREEN}✓${RESET} ${DIM}${testCase.name}${RESET}`);
    } else {
      console.log(`  ${RED}✗ ${testCase.name}${RESET}`);
      console.log(`    ${RED}${testCase.message}${RESET}`);
    }
  }
}

const summary = `${results.passed} passed, ${results.failed} failed, ${results.total} total`;
console.log(`\n${results.failed ? RED : GREEN}${summary}${RESET}\n`);

process.exit(results.failed > 0 ? 1 : 0);
