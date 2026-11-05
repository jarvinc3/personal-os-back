import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  CASE_CATALOG_COLUMN,
  CASE_CATALOG_HEADERS,
  CASE_PRIORITY,
  CASE_STATUS,
  CASE_TYPE,
  RUN_COLUMN,
  RUN_HEADERS,
  RUN_SHEET,
  createRunWorkbook,
  exportRunWorkbookCsv,
  parseCsv,
  readCaseCatalogs,
  type TestCase,
} from './testing-runs';

const SAMPLE_CASE: TestCase = {
  id: 'AI1-01',
  phase: 'AI-1 — Puerta única de modelos',
  title: 'Caso con coma, comillas y líneas',
  type: 'funcional',
  priority: 'Medium',
  dependencies: [],
  precondition: '',
  steps: 'Abrir la sección',
  testData: 'texto de prueba',
  expectedResult: 'Se muestra el resultado esperado',
};

const TESTING_DIRECTORY = resolve(__dirname, '../../docs/testing');
const CATALOG_PATHS = [
  resolve(TESTING_DIRECTORY, 'finance/cases.csv'),
  resolve(TESTING_DIRECTORY, 'intelligence/cases.csv'),
];
const BUILD_RUN_SCRIPT = resolve(__dirname, '../testing/build-run.ts');

function runBuildRunCli(argumentsList: readonly string[]) {
  return spawnSync(
    process.execPath,
    ['-r', 'ts-node/register', BUILD_RUN_SCRIPT, ...argumentsList],
    {
      cwd: resolve(__dirname, '../..'),
      encoding: 'utf8',
    },
  );
}

describe('herramientas para rondas de pruebas', () => {
  it('lee los dos catálogos, valida sus dependencias y deja AI4-13 al final', async () => {
    const cases = await readCaseCatalogs({ catalogPaths: CATALOG_PATHS });

    expect(cases).toHaveLength(104);
    expect(cases.at(-1)?.id).toBe('AI4-13');
    expect(
      cases.find((testCase) => testCase.id === 'AI1-05')?.dependencies,
    ).toEqual(['AI1-01', 'AI1-02', 'AI1-03', 'AI1-04']);
  });

  it('rechaza catálogos con ciclos entre dependencias', async () => {
    const temporaryDirectory = await mkdtemp(
      resolve(tmpdir(), 'testing-runs-'),
    );
    const catalogPath = resolve(temporaryDirectory, 'cases.csv');
    const cycleCatalog = [
      CASE_CATALOG_HEADERS.join(','),
      [
        'AI1-01',
        'AI-1 — Puerta única de modelos',
        'Caso cíclico uno',
        CASE_TYPE.FUNCTIONAL,
        CASE_PRIORITY.MEDIUM,
        'AI1-02',
        '',
        'Ejecutar el caso uno.',
        'Datos de prueba',
        'Resultado esperado',
        '',
        CASE_STATUS.PENDING,
      ].join(','),
      [
        'AI1-02',
        'AI-1 — Puerta única de modelos',
        'Caso cíclico dos',
        CASE_TYPE.FUNCTIONAL,
        CASE_PRIORITY.MEDIUM,
        'AI1-01',
        '',
        'Ejecutar el caso dos.',
        'Datos de prueba',
        'Resultado esperado',
        '',
        CASE_STATUS.PENDING,
      ].join(','),
    ].join('\n');

    try {
      await writeFile(catalogPath, cycleCatalog, 'utf8');
      await expect(
        readCaseCatalogs({ catalogPaths: [catalogPath] }),
      ).rejects.toThrow('ciclo');
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('interpreta comas, comillas escapadas y saltos de línea en CSV', () => {
    const rows = parseCsv(
      'ID,Detalle\r\nAI1-01,"línea uno,\r\nlínea dos; ""cita"""',
    );

    expect(rows).toEqual([
      ['ID', 'Detalle'],
      ['AI1-01', 'línea uno,\r\nlínea dos; "cita"'],
    ]);
  });

  it('crea el desplegable de estado y el resumen dinámico por fase', () => {
    const workbook = createRunWorkbook({
      cases: [SAMPLE_CASE],
      buildReference: 'abc123',
    });
    const casesSheet = workbook.getWorksheet(RUN_SHEET.CASES);
    const summarySheet = workbook.getWorksheet(RUN_SHEET.PHASE_SUMMARY);
    if (!casesSheet) {
      throw new Error('No se creó la hoja Casos.');
    }
    const validationSheet = casesSheet as unknown as {
      dataValidations: {
        model: Record<string, { type: string; formulae: string[] }>;
      };
    };

    expect(casesSheet.getCell('L2').value).toBe(CASE_STATUS.PENDING);
    expect(casesSheet.getCell('O2').value).toBe('abc123');
    expect(validationSheet.dataValidations.model).toMatchObject({
      'L2:L2': {
        type: 'list',
        formulae: ['"Pendiente,Pasa,Falla,Bloqueado"'],
      },
    });
    expect(summarySheet?.getCell('B2').value).toMatchObject({
      formula: expect.stringContaining('COUNTIF'),
    });
    expect(summarySheet?.getCell('G2').value).toMatchObject({
      formula: expect.stringContaining('COUNTIFS'),
    });
  });

  it('exporta las columnas de ejecución y conserva el texto entre comillas', async () => {
    const workbook = createRunWorkbook({
      cases: [SAMPLE_CASE],
      buildReference: 'abc123',
    });
    const casesSheet = workbook.getWorksheet(RUN_SHEET.CASES);
    if (!casesSheet) {
      throw new Error('No se creó la hoja Casos.');
    }
    casesSheet.getCell('K2').value = 'Captura, revisada\npor QA';
    casesSheet.getCell('L2').value = CASE_STATUS.PASSED;
    casesSheet.getCell('M2').value = '2026-11-04';

    const workbookBuffer = new Uint8Array(await workbook.xlsx.writeBuffer());
    const csvContent = await exportRunWorkbookCsv({
      workbookBuffer,
      expectedCaseIds: [SAMPLE_CASE.id],
    });
    const rows = parseCsv(csvContent);

    expect(rows[0]).toEqual([...RUN_HEADERS]);
    expect(rows[1][0]).toBe(SAMPLE_CASE.id);
    expect(rows[1][10]).toBe('Captura, revisada\npor QA');
    expect(rows[1][11]).toBe(CASE_STATUS.PASSED);
    expect(rows[1][12]).toBe('2026-11-04');
  });

  it('neutraliza texto que una hoja de cálculo podría interpretar como fórmula', async () => {
    const workbook = createRunWorkbook({
      cases: [SAMPLE_CASE],
      buildReference: 'abc123',
    });
    const casesSheet = workbook.getWorksheet(RUN_SHEET.CASES);
    if (!casesSheet) {
      throw new Error('No se creó la hoja Casos.');
    }
    casesSheet.getCell('K2').value = '=SUM(1,1)';
    casesSheet.getCell('N2').value = '\t+SUM(1,1)';
    casesSheet.getCell('O2').value = '-2+3';
    casesSheet.getCell('P2').value = '@SUM(1,1)';
    casesSheet.getCell('J2').value = -7;

    const workbookBuffer = new Uint8Array(await workbook.xlsx.writeBuffer());
    const csvContent = await exportRunWorkbookCsv({
      workbookBuffer,
      expectedCaseIds: [SAMPLE_CASE.id],
    });
    const rows = parseCsv(csvContent);

    expect(rows[1][10]).toBe("'=SUM(1,1)");
    expect(rows[1][13]).toBe("'\t+SUM(1,1)");
    expect(rows[1][14]).toBe("'-2+3");
    expect(rows[1][15]).toBe("'@SUM(1,1)");
    expect(rows[1][9]).toBe('-7');
    expect(rows[1][11]).toBe(CASE_STATUS.PENDING);
  });

  it('rechaza las celdas con fórmula de la hoja Casos', async () => {
    const workbook = createRunWorkbook({
      cases: [SAMPLE_CASE],
      buildReference: 'abc123',
    });
    const casesSheet = workbook.getWorksheet(RUN_SHEET.CASES);
    if (!casesSheet) {
      throw new Error('No se creó la hoja Casos.');
    }
    casesSheet.getCell('K2').value = { formula: '1+1', result: 2 };
    const workbookBuffer = new Uint8Array(await workbook.xlsx.writeBuffer());

    await expect(
      exportRunWorkbookCsv({
        workbookBuffer,
        expectedCaseIds: [SAMPLE_CASE.id],
      }),
    ).rejects.toThrow('celdas con fórmula');
  });

  it('rechaza exportar una hoja a la que le falta un ID del catálogo', async () => {
    const workbook = createRunWorkbook({
      cases: [SAMPLE_CASE],
      buildReference: 'abc123',
    });
    const workbookBuffer = new Uint8Array(await workbook.xlsx.writeBuffer());

    await expect(
      exportRunWorkbookCsv({
        workbookBuffer,
        expectedCaseIds: [SAMPLE_CASE.id, 'AI1-02'],
      }),
    ).rejects.toThrow('Faltan: AI1-02');
  });

  it('rechaza IDs ajenos a los catálogos actuales', async () => {
    const workbook = createRunWorkbook({
      cases: [
        SAMPLE_CASE,
        { ...SAMPLE_CASE, id: 'AI1-02', title: 'Otro caso' },
      ],
      buildReference: 'abc123',
    });
    const workbookBuffer = new Uint8Array(await workbook.xlsx.writeBuffer());

    await expect(
      exportRunWorkbookCsv({
        workbookBuffer,
        expectedCaseIds: [SAMPLE_CASE.id],
      }),
    ).rejects.toThrow('no pertenece a los catálogos actuales');
  });

  it('rechaza fechas de calendario imposibles en los comandos de build y export', () => {
    const invalidDate = '2026-02-30';
    const commandArguments = [
      ['build', `--date=${invalidDate}`, '--build=test-build'],
      ['export', `docs/testing/runs/${invalidDate}-test-build.xlsx`],
    ];

    for (const argumentsList of commandArguments) {
      const execution = runBuildRunCli(argumentsList);

      expect(execution.error).toBeUndefined();
      expect(execution.status).toBe(1);
      expect(execution.stderr).toContain(
        `La fecha de la ronda no existe: ${invalidDate}.`,
      );
      expect(execution.stderr).not.toContain('ENOENT');
    }
  });

  it('rechaza exportar una hoja con un estado fuera de la lista', async () => {
    const workbook = createRunWorkbook({
      cases: [SAMPLE_CASE],
      buildReference: 'abc123',
    });
    const casesSheet = workbook.getWorksheet(RUN_SHEET.CASES);
    if (!casesSheet) {
      throw new Error('No se creó la hoja Casos.');
    }
    casesSheet.getCell('L2').value = 'In Progress';
    const workbookBuffer = new Uint8Array(await workbook.xlsx.writeBuffer());

    await expect(
      exportRunWorkbookCsv({
        workbookBuffer,
        expectedCaseIds: [SAMPLE_CASE.id],
      }),
    ).rejects.toThrow('Estado no válido');
  });

  it('usa las columnas previstas para el catálogo y la ronda', () => {
    expect(CASE_CATALOG_HEADERS).toContain(CASE_CATALOG_COLUMN.ACTUAL_RESULT);
    expect(RUN_HEADERS).toContain(RUN_COLUMN.BUILD_REFERENCE);
  });
});
