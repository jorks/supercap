#!/usr/bin/env node
/**
 * Regenerates data.generated.js from data.json.
 *
 * SuperCap runs from file://, where fetch() is blocked, so the rules data has to
 * reach the browser as a classic script rather than a JSON request. data.json stays
 * the file humans edit; data.generated.js is the committed build artefact.
 *
 *   node dev/sync-data.mjs [--check]
 *
 * --check verifies the artefact is up to date without writing, for use in review.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DEV = dirname(fileURLToPath(import.meta.url));
const ROOT = join(DEV, '..');
const SOURCE = join(DEV, 'data.json');
const TARGET = join(ROOT, 'data.generated.js');

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Collects every problem rather than throwing on the first, so one run reports all of them. */
function validate(data) {
  const errors = [];
  const warnings = [];

  const require = (condition, message) => {
    if (!condition) errors.push(message);
  };

  require(data.schemaVersion === 1, 'schemaVersion must be 1');
  require(typeof data.rulesVersion === 'string', 'rulesVersion must be a string');
  require(data.country === 'AU', 'country must be "AU". SuperCap is Australia-only');
  require(data.currency === 'AUD', 'currency must be "AUD"');
  require(ISO_DATE.test(data.lastVerified ?? ''), 'lastVerified must be a YYYY-MM-DD date');

  const payroll = data.payrollDefaults ?? {};
  require(ISO_DATE.test(payroll.anchorDate ?? ''), 'payrollDefaults.anchorDate must be a YYYY-MM-DD date');
  require(
    Number.isInteger(payroll.daysBetweenPays) && payroll.daysBetweenPays > 0,
    'payrollDefaults.daysBetweenPays must be a positive integer'
  );

  const years = Object.entries(data.financialYears ?? {});
  require(years.length > 0, 'financialYears must contain at least one entry');

  for (const [key, year] of years) {
    const where = `financialYears["${key}"]`;

    if (!/^\d{4}-\d{2}$/.test(key)) {
      errors.push(`${where}: key must look like "2026-27"`);
      continue;
    }

    const startYear = Number(key.slice(0, 4));
    require(year.start === `${startYear}-07-01`, `${where}.start must be ${startYear}-07-01`);
    require(year.end === `${startYear + 1}-06-30`, `${where}.end must be ${startYear + 1}-06-30`);
    require(typeof year.label === 'string', `${where}.label is required`);

    const sup = year.super ?? {};
    require(
      typeof sup.sgRate === 'number' && sup.sgRate > 0 && sup.sgRate < 1,
      `${where}.super.sgRate must be a decimal fraction such as 0.12`
    );

    for (const field of ['concessionalCap', 'maximumSgEarningsBase', 'division293Threshold']) {
      const value = sup[field];
      const nullable = value === null;
      require(
        nullable || (typeof value === 'number' && value > 0),
        `${where}.super.${field} must be a positive number, or null when the amount is not yet published`
      );
    }

    // The ATO derives the maximum contribution base from the cap, so a mismatch is a
    // strong hint that one of the two was updated without the other.
    if (typeof sup.concessionalCap === 'number' && typeof sup.maximumSgEarningsBase === 'number') {
      const derived = Math.floor((sup.concessionalCap * 100) / (sup.sgRate * 100) / 10) * 10;
      if (derived !== sup.maximumSgEarningsBase) {
        warnings.push(
          `${where}: maximumSgEarningsBase is ${sup.maximumSgEarningsBase} but cap ÷ SG rate implies ${derived}`
        );
      }
    }

    const status = year.metadata?.status;
    const allowed = ['verified', 'legislated', 'current-law-continuing', 'not-yet-published'];
    require(allowed.includes(status), `${where}.metadata.status must be one of ${allowed.join(', ')}`);

    const brackets = year.tax?.residentRates;
    if (!Array.isArray(brackets) || brackets.length === 0) {
      errors.push(`${where}.tax.residentRates must be a non-empty array`);
    } else {
      brackets.forEach((bracket, index) => {
        const at = `${where}.tax.residentRates[${index}]`;
        require(typeof bracket.from === 'number', `${at}.from must be a number`);
        require(bracket.to === null || typeof bracket.to === 'number', `${at}.to must be a number or null`);
        require(typeof bracket.rate === 'number', `${at}.rate must be a number`);
        const previous = brackets[index - 1];
        if (previous && previous.to !== bracket.from) {
          errors.push(`${at}.from must continue from the previous bracket's "to"`);
        }
      });
      require(brackets[brackets.length - 1].to === null, `${where}.tax.residentRates must end with an open bracket`);
    }
  }

  return { errors, warnings };
}

function render(data) {
  return `/**
 * GENERATED FILE. Do not edit.
 *
 * Produced from dev/data.json by dev/sync-data.mjs.
 * Edit data.json, re-run the script, and commit both files.
 *
 * Rules version: ${data.rulesVersion}
 * Last verified: ${data.lastVerified}
 */
window.SUPERCAP_DATA = ${JSON.stringify(data, null, 2)};
`;
}

const raw = await readFile(SOURCE, 'utf8');

let data;
try {
  data = JSON.parse(raw);
} catch (error) {
  console.error(`data.json is not valid JSON: ${error.message}`);
  process.exit(1);
}

const { errors, warnings } = validate(data);

for (const warning of warnings) console.warn(`warning  ${warning}`);

if (errors.length > 0) {
  console.error(`data.json failed validation (${errors.length} problem${errors.length === 1 ? '' : 's'}):`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

const output = render(data);
const checkOnly = process.argv.includes('--check');
const existing = await readFile(TARGET, 'utf8').catch(() => null);

if (existing === output) {
  console.log('data.generated.js is already up to date.');
  process.exit(0);
}

if (checkOnly) {
  console.error('data.generated.js is out of date. Run: node dev/sync-data.mjs');
  process.exit(1);
}

await writeFile(TARGET, output, 'utf8');

const yearCount = Object.keys(data.financialYears).length;
console.log(`Wrote data.generated.js. Rules ${data.rulesVersion}, ${yearCount} financial years.`);
