import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import {
  basename,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';
import {
  createRunWorkbook,
  exportRunWorkbookCsv,
  readCaseCatalogs,
} from '../lib/testing-runs';

const REPOSITORY_ROOT = resolve(__dirname, '../..');
const RUNS_DIRECTORY = resolve(REPOSITORY_ROOT, 'docs/testing/runs');
const CATALOG_PATHS = [
  resolve(REPOSITORY_ROOT, 'docs/testing/finance/cases.csv'),
  resolve(REPOSITORY_ROOT, 'docs/testing/intelligence/cases.csv'),
] as const;
const BUILD_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ROUND_NAME_PATTERN = /^\d{4}-\d{2}-\d{2}-[A-Za-z0-9][A-Za-z0-9._-]*$/;
const XLSX_EXTENSION = '.xlsx';
const CLI_USAGE = [
  'Uso:',
  '  pnpm testing:build-run build [--date=AAAA-MM-DD] [--build=commit]',
  '  pnpm testing:build-run export docs/testing/runs/<ronda>.xlsx',
].join('\n');

async function main(): Promise<void> {
  const [command, ...argumentsList] = process.argv.slice(2);
  if (command === undefined || command === '--help' || command === 'help') {
    process.stdout.write(`${CLI_USAGE}\n`);
    return;
  }
  if (command === 'build') {
    await buildRun({ argumentsList });
    return;
  }
  if (command === 'export') {
    await exportRun({ argumentsList });
    return;
  }
  throw new Error(`Comando no reconocido: ${command}\n\n${CLI_USAGE}`);
}

async function buildRun({
  argumentsList,
}: {
  argumentsList: readonly string[];
}): Promise<void> {
  const options = parseNamedOptions({
    argumentsList,
    allowedOptions: ['date', 'build'],
  });
  const runDate = options.date ?? new Date().toISOString().slice(0, 10);
  assertValidRunDate(runDate);
  const buildReference = options.build ?? getCurrentBuildReference();
  if (!BUILD_REFERENCE_PATTERN.test(buildReference)) {
    throw new Error(
      'El build debe contener solo letras, números, punto, guion o guion bajo.',
    );
  }

  const cases = await readCaseCatalogs({ catalogPaths: CATALOG_PATHS });
  const workbook = createRunWorkbook({ cases, buildReference });
  await mkdir(RUNS_DIRECTORY, { recursive: true });

  const outputPath = resolve(
    RUNS_DIRECTORY,
    `${runDate}-${buildReference}${XLSX_EXTENSION}`,
  );
  const workbookBuffer = new Uint8Array(await workbook.xlsx.writeBuffer());
  await writeFile(outputPath, workbookBuffer, { flag: 'wx' });
  process.stdout.write(
    `Ronda creada: ${relative(REPOSITORY_ROOT, outputPath)}\n`,
  );
}

async function exportRun({
  argumentsList,
}: {
  argumentsList: readonly string[];
}): Promise<void> {
  if (argumentsList.length !== 1) {
    throw new Error(
      `Indica un único archivo XLSX de docs/testing/runs/.\n\n${CLI_USAGE}`,
    );
  }

  const workbookPath = resolve(process.cwd(), argumentsList[0]);
  assertWorkbookInRunsDirectory(workbookPath);
  if (extname(workbookPath).toLowerCase() !== XLSX_EXTENSION) {
    throw new Error('El archivo de entrada debe tener extensión .xlsx.');
  }

  const roundName = basename(workbookPath, extname(workbookPath));
  if (!ROUND_NAME_PATTERN.test(roundName)) {
    throw new Error(
      'El nombre de la ronda debe tener el formato AAAA-MM-DD-<build>.',
    );
  }
  assertValidRunDate(roundName.slice(0, 10));

  const cases = await readCaseCatalogs({ catalogPaths: CATALOG_PATHS });
  const workbookBuffer = new Uint8Array(await readFile(workbookPath));
  const csvContent = await exportRunWorkbookCsv({
    workbookBuffer,
    expectedCaseIds: cases.map((testCase) => testCase.id),
  });
  await mkdir(RUNS_DIRECTORY, { recursive: true });

  const outputPath = resolve(RUNS_DIRECTORY, `${roundName}.csv`);
  await writeFile(outputPath, csvContent, { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(
    `Resultados exportados: ${relative(REPOSITORY_ROOT, outputPath)}\n`,
  );
}

function parseNamedOptions({
  argumentsList,
  allowedOptions,
}: {
  argumentsList: readonly string[];
  allowedOptions: readonly string[];
}): Record<string, string> {
  const options: Record<string, string> = {};
  for (const argument of argumentsList) {
    if (!argument.startsWith('--')) {
      throw new Error(`Opción no válida: ${argument}`);
    }
    const separatorIndex = argument.indexOf('=');
    if (separatorIndex < 0) {
      throw new Error(`Usa el formato --nombre=valor: ${argument}`);
    }

    const name = argument.slice(2, separatorIndex);
    const value = argument.slice(separatorIndex + 1);
    if (!allowedOptions.includes(name)) {
      throw new Error(`Opción no reconocida: --${name}`);
    }
    if (Object.hasOwn(options, name)) {
      throw new Error(`La opción --${name} no puede repetirse.`);
    }
    if (value.length === 0) {
      throw new Error(`La opción --${name} requiere un valor.`);
    }
    options[name] = value;
  }
  return options;
}

function assertValidRunDate(runDate: string): void {
  if (!DATE_PATTERN.test(runDate)) {
    throw new Error('La fecha debe tener el formato AAAA-MM-DD.');
  }
  const parsedDate = new Date(`${runDate}T00:00:00.000Z`);
  if (Number.isNaN(parsedDate.getTime())) {
    throw new Error(`La fecha de la ronda no existe: ${runDate}.`);
  }
  if (parsedDate.toISOString().slice(0, 10) !== runDate) {
    throw new Error(`La fecha de la ronda no existe: ${runDate}.`);
  }
}

function getCurrentBuildReference(): string {
  try {
    const reference = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
      cwd: REPOSITORY_ROOT,
      encoding: 'utf8',
    }).trim();
    if (reference.length === 0) {
      throw new Error('Git no devolvió un commit para identificar el build.');
    }
    return reference;
  } catch (error) {
    throw new Error('No se pudo leer el commit actual de Git.', {
      cause: error,
    });
  }
}

function assertWorkbookInRunsDirectory(workbookPath: string): void {
  const pathFromRunsDirectory = relative(RUNS_DIRECTORY, workbookPath);
  const outsideRunsDirectory =
    pathFromRunsDirectory === '..' ||
    pathFromRunsDirectory.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRunsDirectory);
  if (outsideRunsDirectory) {
    throw new Error('El archivo XLSX debe estar dentro de docs/testing/runs/.');
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
