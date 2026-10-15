#!/usr/bin/env node
/**
 * Fails when a finance read path turns money into a JavaScript number.
 * Amounts stay decimal through the helpers in
 * packages/finance/src/shared/domain/money.ts (ADR-002, pendiente 13).
 * Numbers are allowed only for ratios and chart scales, through those helpers.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

const TARGET_DIRS = [
  'packages/finance/src/analytics/application',
  'packages/finance/src/balance-sheet/application',
  'packages/finance/src/fx/application',
  'packages/finance/src/subscriptions/application',
];

const TARGET_FILES = ['packages/finance/src/subscriptions/domain/billing.ts'];

const FORBIDDEN = [/\.toNumber\s*\(/, /\bNumber\s*\(/];

function collectTypeScriptFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTypeScriptFiles(fullPath));
      continue;
    }
    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

function targetFiles() {
  const files = [];
  for (const dir of TARGET_DIRS) {
    files.push(...collectTypeScriptFiles(join(ROOT, dir)));
  }
  for (const file of TARGET_FILES) {
    files.push(join(ROOT, file));
  }
  return files;
}

function offendersIn(file) {
  const found = [];
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    if (FORBIDDEN.some((pattern) => pattern.test(line))) {
      found.push(`${relative(ROOT, file)}:${index + 1}: ${line.trim()}`);
    }
  });
  return found;
}

function findOffenders(files) {
  return files.flatMap(offendersIn);
}

const offenders = findOffenders(targetFiles());
if (offenders.length > 0) {
  console.error(
    'Money must stay decimal (see shared/domain/money.ts and ADR-002):',
  );
  for (const offender of offenders) {
    console.error(`  ${offender}`);
  }
  process.exit(1);
}
