import ExcelJS from 'exceljs';
import { readFile } from 'node:fs/promises';

export const CASE_STATUS = {
  PENDING: 'Pendiente',
  PASSED: 'Pasa',
  FAILED: 'Falla',
  BLOCKED: 'Bloqueado',
} as const;

export const CASE_TYPE = {
  FUNCTIONAL: 'funcional',
  EDGE: 'borde',
  REGRESSION: 'regresion',
  PERMISSIONS: 'permisos',
} as const;

export const CASE_PRIORITY = {
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
} as const;

export const CASE_CATALOG_COLUMN = {
  ID: 'ID',
  PHASE: 'Fase',
  TITLE: 'Caso de prueba',
  TYPE: 'Tipo',
  PRIORITY: 'Prioridad',
  DEPENDENCIES: 'Depende de',
  PRECONDITION: 'Precondición',
  STEPS: 'Pasos',
  TEST_DATA: 'Datos de prueba',
  EXPECTED_RESULT: 'Resultado esperado',
  ACTUAL_RESULT: 'Resultado actual',
  STATUS: 'Estado',
} as const;

export const RUN_COLUMN = {
  DATE: 'Fecha',
  TESTER: 'Tester',
  BUILD_REFERENCE: 'Build/commit',
  EVIDENCE: 'Evidencia',
  ISSUE: 'Issue',
} as const;

export const RUN_SHEET = {
  CASES: 'Casos',
  PHASE_SUMMARY: 'Resumen por fase',
} as const;

export const CASE_CATALOG_HEADERS = [
  CASE_CATALOG_COLUMN.ID,
  CASE_CATALOG_COLUMN.PHASE,
  CASE_CATALOG_COLUMN.TITLE,
  CASE_CATALOG_COLUMN.TYPE,
  CASE_CATALOG_COLUMN.PRIORITY,
  CASE_CATALOG_COLUMN.DEPENDENCIES,
  CASE_CATALOG_COLUMN.PRECONDITION,
  CASE_CATALOG_COLUMN.STEPS,
  CASE_CATALOG_COLUMN.TEST_DATA,
  CASE_CATALOG_COLUMN.EXPECTED_RESULT,
  CASE_CATALOG_COLUMN.ACTUAL_RESULT,
  CASE_CATALOG_COLUMN.STATUS,
] as const;

export const RUN_HEADERS = [
  ...CASE_CATALOG_HEADERS,
  RUN_COLUMN.DATE,
  RUN_COLUMN.TESTER,
  RUN_COLUMN.BUILD_REFERENCE,
  RUN_COLUMN.EVIDENCE,
  RUN_COLUMN.ISSUE,
] as const;

export type CaseStatus = (typeof CASE_STATUS)[keyof typeof CASE_STATUS];
export type CaseType = (typeof CASE_TYPE)[keyof typeof CASE_TYPE];
export type CasePriority = (typeof CASE_PRIORITY)[keyof typeof CASE_PRIORITY];

type RunStatusValidation = {
  type: 'list';
  formulae: string[];
  allowBlank: boolean;
  showErrorMessage: boolean;
  errorTitle: string;
  error: string;
};

type WorksheetWithDataValidations = ExcelJS.Worksheet & {
  dataValidations: {
    add: (range: string, validation: RunStatusValidation) => void;
  };
};

export type TestCase = {
  id: string;
  phase: string;
  title: string;
  type: CaseType;
  priority: CasePriority;
  dependencies: readonly string[];
  precondition: string;
  steps: string;
  testData: string;
  expectedResult: string;
};

const CSV_UTF8_BOM = '\uFEFF';
const CSV_QUOTE = '"';
const CSV_SEPARATOR = ',';
const CASE_ID_PATTERN = /^AI(\d+)-(\d{2})$/;
const PHASE_PATTERN = /^AI-(\d+) — /;
const LAST_CASE_ID = 'AI4-13';
const DEPENDENCY_VISIT_STATE = {
  VISITING: 'visiting',
  VISITED: 'visited',
} as const;
const CASES_SHEET_NAME = RUN_SHEET.CASES;
const PHASE_SUMMARY_SHEET_NAME = RUN_SHEET.PHASE_SUMMARY;
const CASE_STATUS_VALUES = Object.values(CASE_STATUS) as CaseStatus[];
const CASE_TYPE_VALUES = Object.values(CASE_TYPE) as CaseType[];
const CASE_PRIORITY_VALUES = Object.values(CASE_PRIORITY) as CasePriority[];
const STATUS_COLUMN_INDEX = RUN_HEADERS.indexOf(CASE_CATALOG_COLUMN.STATUS) + 1;
const PHASE_COLUMN_INDEX = RUN_HEADERS.indexOf(CASE_CATALOG_COLUMN.PHASE) + 1;

const COLUMN_WIDTHS: Readonly<Record<string, number>> = {
  [CASE_CATALOG_COLUMN.ID]: 13,
  [CASE_CATALOG_COLUMN.PHASE]: 36,
  [CASE_CATALOG_COLUMN.TITLE]: 44,
  [CASE_CATALOG_COLUMN.TYPE]: 16,
  [CASE_CATALOG_COLUMN.PRIORITY]: 14,
  [CASE_CATALOG_COLUMN.DEPENDENCIES]: 24,
  [CASE_CATALOG_COLUMN.PRECONDITION]: 45,
  [CASE_CATALOG_COLUMN.STEPS]: 64,
  [CASE_CATALOG_COLUMN.TEST_DATA]: 48,
  [CASE_CATALOG_COLUMN.EXPECTED_RESULT]: 60,
  [CASE_CATALOG_COLUMN.ACTUAL_RESULT]: 48,
  [CASE_CATALOG_COLUMN.STATUS]: 16,
  [RUN_COLUMN.DATE]: 16,
  [RUN_COLUMN.TESTER]: 20,
  [RUN_COLUMN.BUILD_REFERENCE]: 24,
  [RUN_COLUMN.EVIDENCE]: 36,
  [RUN_COLUMN.ISSUE]: 24,
};

const STATUS_STYLES: Readonly<
  Record<CaseStatus, { fill: string; font: string }>
> = {
  [CASE_STATUS.PENDING]: { fill: 'FFE7E6E6', font: 'FF595959' },
  [CASE_STATUS.PASSED]: { fill: 'FFC6EFCE', font: 'FF006100' },
  [CASE_STATUS.FAILED]: { fill: 'FFFCE4D6', font: 'FF9C0006' },
  [CASE_STATUS.BLOCKED]: { fill: 'FFFFEB9C', font: 'FF9C6500' },
};

export function parseCsv(content: string): string[][] {
  let source = content;
  if (source.startsWith(CSV_UTF8_BOM)) {
    source = source.slice(CSV_UTF8_BOM.length);
  }

  const rows: string[][] = [];
  let fields: string[] = [];
  let field = '';
  let insideQuotedField = false;
  let closedQuotedField = false;

  const appendRow = (): void => {
    fields.push(field);
    if (fields.some((value) => value.length > 0)) {
      rows.push(fields);
    }
    fields = [];
    field = '';
    closedQuotedField = false;
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (insideQuotedField) {
      if (character === CSV_QUOTE) {
        if (source[index + 1] === CSV_QUOTE) {
          field += CSV_QUOTE;
          index += 1;
          continue;
        }
        insideQuotedField = false;
        closedQuotedField = true;
        continue;
      }
      field += character;
      continue;
    }

    const invalidCharacterAfterQuote =
      closedQuotedField &&
      character !== CSV_SEPARATOR &&
      character !== '\r' &&
      character !== '\n';
    if (invalidCharacterAfterQuote) {
      throw new Error(
        'El CSV contiene texto después de cerrar un campo entre comillas.',
      );
    }
    if (character === CSV_QUOTE) {
      if (field.length > 0) {
        throw new Error('El CSV abre comillas en medio de un campo.');
      }
      insideQuotedField = true;
      continue;
    }
    if (character === CSV_SEPARATOR) {
      fields.push(field);
      field = '';
      closedQuotedField = false;
      continue;
    }
    if (character === '\r' || character === '\n') {
      appendRow();
      if (character === '\r' && source[index + 1] === '\n') {
        index += 1;
      }
      continue;
    }
    field += character;
    closedQuotedField = false;
  }

  if (insideQuotedField) {
    throw new Error('El CSV termina con un campo entre comillas sin cerrar.');
  }
  if (field.length > 0 || fields.length > 0 || closedQuotedField) {
    appendRow();
  }
  return rows;
}

export async function readCaseCatalogs({
  catalogPaths,
}: {
  catalogPaths: readonly string[];
}): Promise<TestCase[]> {
  if (catalogPaths.length === 0) {
    throw new Error('Indica al menos un catálogo de casos.');
  }

  const catalogs = await Promise.all(
    catalogPaths.map(async (sourcePath) => ({
      sourcePath,
      content: await readFile(sourcePath, 'utf8'),
    })),
  );
  const cases = catalogs.flatMap(({ sourcePath, content }) =>
    parseCaseCatalog({ content, sourcePath }),
  );
  assertUniqueCaseIds(cases);
  assertDependenciesExist(cases);
  assertNoDependencyCycles(cases);
  return sortCasesForRun(cases);
}

function parseCaseCatalog({
  content,
  sourcePath,
}: {
  content: string;
  sourcePath: string;
}): TestCase[] {
  const [headers, ...rows] = parseCsv(content);
  if (!headers || !areHeadersEqual(headers, CASE_CATALOG_HEADERS)) {
    throw new Error(
      `Las columnas del catálogo ${sourcePath} no coinciden con el formato esperado.`,
    );
  }

  return rows.map((row, index) => {
    const lineNumber = index + 2;
    if (row.length !== CASE_CATALOG_HEADERS.length) {
      throw new Error(
        `La fila ${lineNumber} de ${sourcePath} tiene una cantidad de columnas incorrecta.`,
      );
    }
    const [
      id,
      phase,
      title,
      rawType,
      rawPriority,
      rawDependencies,
      precondition,
      steps,
      testData,
      expectedResult,
      actualResult,
      status,
    ] = row;
    if (!id || !phase || !title || !steps || !testData || !expectedResult) {
      throw new Error(
        `La fila ${lineNumber} de ${sourcePath} no tiene los campos obligatorios completos.`,
      );
    }

    const idMatch = CASE_ID_PATTERN.exec(id);
    if (!idMatch) {
      throw new Error(
        `El ID ${id} de ${sourcePath} debe tener el formato AI<n>-<nn>.`,
      );
    }
    const phaseNumber = Number(idMatch[1]);
    if (!phase.startsWith(`AI-${phaseNumber} — `)) {
      throw new Error(`La fase de ${id} no coincide con su ID.`);
    }
    if (!CASE_TYPE_VALUES.includes(rawType as CaseType)) {
      throw new Error(`El tipo ${rawType} de ${id} no está permitido.`);
    }
    if (!CASE_PRIORITY_VALUES.includes(rawPriority as CasePriority)) {
      throw new Error(
        `La prioridad ${rawPriority} de ${id} no está permitida.`,
      );
    }
    if (actualResult !== '') {
      throw new Error(
        `Resultado actual debe estar vacío en el catálogo para ${id}.`,
      );
    }
    if (status !== CASE_STATUS.PENDING) {
      throw new Error(
        `Estado debe ser ${CASE_STATUS.PENDING} en el catálogo para ${id}.`,
      );
    }

    return {
      id,
      phase,
      title,
      type: rawType as CaseType,
      priority: rawPriority as CasePriority,
      dependencies: parseDependencies({ value: rawDependencies, caseId: id }),
      precondition,
      steps,
      testData,
      expectedResult,
    };
  });
}

function parseDependencies({
  value,
  caseId,
}: {
  value: string;
  caseId: string;
}): string[] {
  if (value.trim().length === 0) {
    return [];
  }
  const dependencies = value
    .split(CSV_SEPARATOR)
    .map((dependency) => dependency.trim());
  if (dependencies.some((dependency) => !CASE_ID_PATTERN.test(dependency))) {
    throw new Error(
      `La lista de dependencias de ${caseId} contiene un ID inválido.`,
    );
  }
  if (new Set(dependencies).size !== dependencies.length) {
    throw new Error(`La lista de dependencias de ${caseId} repite un ID.`);
  }
  if (dependencies.includes(caseId)) {
    throw new Error(`${caseId} no puede depender de sí mismo.`);
  }
  return dependencies;
}

function assertUniqueCaseIds(cases: readonly TestCase[]): void {
  const caseIds = cases.map((testCase) => testCase.id);
  if (new Set(caseIds).size !== caseIds.length) {
    throw new Error('Los catálogos repiten al menos un ID de caso.');
  }
}

function assertDependenciesExist(cases: readonly TestCase[]): void {
  const knownCaseIds = new Set(cases.map((testCase) => testCase.id));
  for (const testCase of cases) {
    const missingDependency = testCase.dependencies.find(
      (dependency) => !knownCaseIds.has(dependency),
    );
    if (missingDependency) {
      throw new Error(
        `${testCase.id} depende de un caso que no existe: ${missingDependency}.`,
      );
    }
  }
}

function assertNoDependencyCycles(cases: readonly TestCase[]): void {
  type VisitState =
    (typeof DEPENDENCY_VISIT_STATE)[keyof typeof DEPENDENCY_VISIT_STATE];
  const casesById = new Map(cases.map((testCase) => [testCase.id, testCase]));
  const visitStates = new Map<string, VisitState>();

  const visitCase = (caseId: string): void => {
    const state = visitStates.get(caseId);
    if (state === DEPENDENCY_VISIT_STATE.VISITED) {
      return;
    }
    if (state === DEPENDENCY_VISIT_STATE.VISITING) {
      throw new Error(`Las dependencias forman un ciclo en ${caseId}.`);
    }

    const testCase = casesById.get(caseId);
    if (!testCase) {
      throw new Error(`La dependencia ${caseId} no existe en los catálogos.`);
    }
    visitStates.set(caseId, DEPENDENCY_VISIT_STATE.VISITING);
    for (const dependency of testCase.dependencies) {
      visitCase(dependency);
    }
    visitStates.set(caseId, DEPENDENCY_VISIT_STATE.VISITED);
  };

  for (const testCase of cases) {
    visitCase(testCase.id);
  }
}

function sortCasesForRun(cases: readonly TestCase[]): TestCase[] {
  return [...cases].sort((leftCase, rightCase) => {
    if (leftCase.id === LAST_CASE_ID) {
      if (rightCase.id === LAST_CASE_ID) {
        return 0;
      }
      return 1;
    }
    if (rightCase.id === LAST_CASE_ID) {
      return -1;
    }
    const leftIdMatch = CASE_ID_PATTERN.exec(leftCase.id);
    const rightIdMatch = CASE_ID_PATTERN.exec(rightCase.id);
    if (!leftIdMatch || !rightIdMatch) {
      throw new Error('No se puede ordenar un caso con un ID inválido.');
    }
    const phaseDifference = Number(leftIdMatch[1]) - Number(rightIdMatch[1]);
    if (phaseDifference !== 0) {
      return phaseDifference;
    }
    return Number(leftIdMatch[2]) - Number(rightIdMatch[2]);
  });
}

function getPhaseNumber(phase: string): number {
  const match = PHASE_PATTERN.exec(phase);
  if (!match) {
    throw new Error(`No se puede ordenar la fase ${phase}.`);
  }
  return Number(match[1]);
}

function areHeadersEqual(
  actualHeaders: readonly string[],
  expectedHeaders: readonly string[],
): boolean {
  return (
    actualHeaders.length === expectedHeaders.length &&
    actualHeaders.every((header, index) => header === expectedHeaders[index])
  );
}

export function createRunWorkbook({
  cases,
  buildReference,
}: {
  cases: readonly TestCase[];
  buildReference: string;
}): ExcelJS.Workbook {
  if (cases.length === 0) {
    throw new Error('No hay casos para generar la ronda.');
  }
  if (buildReference.trim().length === 0) {
    throw new Error('Indica el build o commit que se va a probar.');
  }
  assertUniqueCaseIds(cases);

  const orderedCases = sortCasesForRun(cases);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Personal OS';
  workbook.subject = 'Ronda de pruebas manuales AI-0 a AI-11';
  workbook.title = 'Pruebas manuales de Personal OS';
  workbook.calcProperties.fullCalcOnLoad = true;

  const casesSheet = workbook.addWorksheet(CASES_SHEET_NAME);
  casesSheet.columns = RUN_HEADERS.map((header) => {
    let width = 20;
    if (COLUMN_WIDTHS[header] !== undefined) {
      width = COLUMN_WIDTHS[header];
    }
    return { header, key: header, width };
  });
  casesSheet.views = [
    {
      state: 'frozen',
      xSplit: 3,
      ySplit: 1,
      topLeftCell: 'D2',
      activeCell: 'D2',
    },
  ];

  for (const testCase of orderedCases) {
    casesSheet.addRow([
      testCase.id,
      testCase.phase,
      testCase.title,
      testCase.type,
      testCase.priority,
      testCase.dependencies.join(', '),
      testCase.precondition,
      testCase.steps,
      testCase.testData,
      testCase.expectedResult,
      '',
      CASE_STATUS.PENDING,
      '',
      '',
      buildReference,
      '',
      '',
    ]);
  }

  const lastCaseRow = orderedCases.length + 1;
  const statusColumnLetter = casesSheet.getColumn(STATUS_COLUMN_INDEX).letter;
  casesSheet.autoFilter = {
    from: 'A1',
    to: `${casesSheet.getColumn(RUN_HEADERS.length).letter}${lastCaseRow}`,
  };
  casesSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  casesSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1F4E78' },
  };
  casesSheet.getRow(1).alignment = { vertical: 'middle', wrapText: true };
  casesSheet.getRow(1).height = 34;
  casesSheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) {
      row.alignment = { vertical: 'top', wrapText: true };
      row.height = 54;
    }
  });
  casesSheet.getColumn(RUN_HEADERS.indexOf(RUN_COLUMN.DATE) + 1).numFmt = '@';
  const casesSheetWithValidations = casesSheet as WorksheetWithDataValidations;
  casesSheetWithValidations.dataValidations.add(
    `${statusColumnLetter}2:${statusColumnLetter}${lastCaseRow}`,
    {
      type: 'list',
      allowBlank: false,
      formulae: [`"${CASE_STATUS_VALUES.join(',')}"`],
      showErrorMessage: true,
      errorTitle: 'Estado no válido',
      error: `Elige uno de estos estados: ${CASE_STATUS_VALUES.join(', ')}.`,
    },
  );
  casesSheet.addConditionalFormatting({
    ref: `${statusColumnLetter}2:${statusColumnLetter}${lastCaseRow}`,
    rules: CASE_STATUS_VALUES.map((status, index) => {
      const style = STATUS_STYLES[status];
      return {
        priority: index + 1,
        type: 'expression' as const,
        formulae: [`$${statusColumnLetter}2="${status}"`],
        style: {
          fill: {
            type: 'pattern' as const,
            pattern: 'solid' as const,
            fgColor: { argb: style.fill },
          },
          font: { color: { argb: style.font }, bold: true },
        },
      };
    }),
  });

  addPhaseSummary({ cases: orderedCases, workbook });
  return workbook;
}

function addPhaseSummary({
  cases,
  workbook,
}: {
  cases: readonly TestCase[];
  workbook: ExcelJS.Workbook;
}): void {
  const phaseCounts = new Map<string, number>();
  for (const testCase of cases) {
    const count = phaseCounts.get(testCase.phase);
    if (count === undefined) {
      phaseCounts.set(testCase.phase, 1);
    } else {
      phaseCounts.set(testCase.phase, count + 1);
    }
  }
  const phases = [...phaseCounts.entries()].sort(
    ([leftPhase], [rightPhase]) => {
      return getPhaseNumber(leftPhase) - getPhaseNumber(rightPhase);
    },
  );

  const summarySheet = workbook.addWorksheet(PHASE_SUMMARY_SHEET_NAME);
  summarySheet.columns = [
    { header: CASE_CATALOG_COLUMN.PHASE, key: 'phase', width: 38 },
    { header: 'Total', key: 'total', width: 14 },
    { header: 'Ejecutados', key: 'executed', width: 16 },
    { header: 'Pasa', key: 'passed', width: 14 },
    { header: 'Falla', key: 'failed', width: 14 },
    { header: 'Bloqueado', key: 'blocked', width: 16 },
    { header: 'Pendiente', key: 'pending', width: 16 },
    { header: '% ejecutado', key: 'executionRate', width: 18 },
    { header: '% pasa', key: 'passRate', width: 16 },
  ];
  summarySheet.views = [{ state: 'frozen', ySplit: 1, topLeftCell: 'A2' }];
  summarySheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  summarySheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1F4E78' },
  };
  summarySheet.getRow(1).alignment = { vertical: 'middle', wrapText: true };

  const casesSheet = workbook.getWorksheet(CASES_SHEET_NAME);
  if (!casesSheet) {
    throw new Error('No se pudo preparar el resumen por fase.');
  }
  const phaseColumnLetter = casesSheet.getColumn(PHASE_COLUMN_INDEX).letter;
  const stateColumnLetter = casesSheet.getColumn(STATUS_COLUMN_INDEX).letter;
  const phaseRange = `'${CASES_SHEET_NAME}'!$${phaseColumnLetter}$2:$${phaseColumnLetter}$${cases.length + 1}`;
  const stateRange = `'${CASES_SHEET_NAME}'!$${stateColumnLetter}$2:$${stateColumnLetter}$${cases.length + 1}`;

  for (const [phase, total] of phases) {
    const summaryRow = summarySheet.rowCount + 1;
    summarySheet.addRow([
      phase,
      { formula: `COUNTIF(${phaseRange},A${summaryRow})`, result: total },
      {
        formula: `COUNTIFS(${phaseRange},A${summaryRow},${stateRange},"${CASE_STATUS.PASSED}")+COUNTIFS(${phaseRange},A${summaryRow},${stateRange},"${CASE_STATUS.FAILED}")`,
        result: 0,
      },
      {
        formula: `COUNTIFS(${phaseRange},A${summaryRow},${stateRange},"${CASE_STATUS.PASSED}")`,
        result: 0,
      },
      {
        formula: `COUNTIFS(${phaseRange},A${summaryRow},${stateRange},"${CASE_STATUS.FAILED}")`,
        result: 0,
      },
      {
        formula: `COUNTIFS(${phaseRange},A${summaryRow},${stateRange},"${CASE_STATUS.BLOCKED}")`,
        result: 0,
      },
      {
        formula: `COUNTIFS(${phaseRange},A${summaryRow},${stateRange},"${CASE_STATUS.PENDING}")`,
        result: total,
      },
      { formula: `C${summaryRow}/B${summaryRow}`, result: 0 },
      {
        formula: `D${summaryRow}/MAX(1,D${summaryRow}+E${summaryRow})`,
        result: 0,
      },
    ]);
  }

  const firstPhaseRow = 2;
  const lastPhaseRow = summarySheet.rowCount;
  const totalRow = lastPhaseRow + 1;
  const grandTotal = cases.length;
  summarySheet.addRow([
    'TOTAL',
    { formula: `SUM(B${firstPhaseRow}:B${lastPhaseRow})`, result: grandTotal },
    { formula: `SUM(C${firstPhaseRow}:C${lastPhaseRow})`, result: 0 },
    { formula: `SUM(D${firstPhaseRow}:D${lastPhaseRow})`, result: 0 },
    { formula: `SUM(E${firstPhaseRow}:E${lastPhaseRow})`, result: 0 },
    { formula: `SUM(F${firstPhaseRow}:F${lastPhaseRow})`, result: 0 },
    { formula: `SUM(G${firstPhaseRow}:G${lastPhaseRow})`, result: grandTotal },
    { formula: `C${totalRow}/B${totalRow}`, result: 0 },
    {
      formula: `D${totalRow}/MAX(1,D${totalRow}+E${totalRow})`,
      result: 0,
    },
  ]);

  summarySheet.getRow(totalRow).font = { bold: true };
  summarySheet.getColumn(8).numFmt = '0.0%';
  summarySheet.getColumn(9).numFmt = '0.0%';
  summarySheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) {
      row.alignment = { vertical: 'top', wrapText: true };
    }
  });
}

export async function exportRunWorkbookCsv({
  workbookBuffer,
}: {
  workbookBuffer: Uint8Array;
}): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  // ExcelJS and the root Node typings differ on the buffer backing type.
  const excelBuffer = Buffer.from(workbookBuffer) as unknown as Parameters<
    typeof workbook.xlsx.load
  >[0];
  await workbook.xlsx.load(excelBuffer);

  const casesSheet = workbook.getWorksheet(CASES_SHEET_NAME);
  if (!casesSheet) {
    throw new Error(`El archivo no contiene la hoja ${CASES_SHEET_NAME}.`);
  }
  const actualHeaders = RUN_HEADERS.map((_, index) =>
    getCellCsvValue(casesSheet.getRow(1).getCell(index + 1)),
  );
  if (!areHeadersEqual(actualHeaders, RUN_HEADERS)) {
    throw new Error(
      'Las columnas de la hoja Casos no coinciden con el formato esperado.',
    );
  }

  const rows: string[][] = [[...RUN_HEADERS]];
  const seenCaseIds = new Set<string>();
  for (let rowNumber = 2; rowNumber <= casesSheet.rowCount; rowNumber += 1) {
    const row = casesSheet.getRow(rowNumber);
    const values = RUN_HEADERS.map((_, index) =>
      getCellCsvValue(row.getCell(index + 1)),
    );
    const caseId = values[0];
    if (caseId.length === 0 && values.every((value) => value.length === 0)) {
      continue;
    }
    if (caseId.length === 0) {
      throw new Error(`La fila ${rowNumber} de la hoja Casos no tiene ID.`);
    }
    if (!CASE_ID_PATTERN.test(caseId)) {
      throw new Error(`El ID ${caseId} de la hoja Casos no es válido.`);
    }
    if (seenCaseIds.has(caseId)) {
      throw new Error(`La hoja Casos repite el ID ${caseId}.`);
    }
    seenCaseIds.add(caseId);

    const state = values[STATUS_COLUMN_INDEX - 1];
    if (!CASE_STATUS_VALUES.includes(state as CaseStatus)) {
      let shownState = state;
      if (shownState.length === 0) {
        shownState = '(vacío)';
      }
      throw new Error(`Estado no válido en ${caseId}: ${shownState}.`);
    }
    rows.push(values);
  }
  if (rows.length === 1) {
    throw new Error('La hoja Casos no contiene resultados para exportar.');
  }
  return serializeCsv(rows);
}

function getCellCsvValue(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) {
    return '';
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') {
      return value.text;
    }
    if ('richText' in value) {
      return value.richText.map((segment) => segment.text).join('');
    }
    if ('result' in value) {
      const formulaResult = value.result;
      if (formulaResult === null || formulaResult === undefined) {
        return '';
      }
      if (
        typeof formulaResult === 'string' ||
        typeof formulaResult === 'number' ||
        typeof formulaResult === 'boolean'
      ) {
        return String(formulaResult);
      }
      if (formulaResult instanceof Date) {
        return formulaResult.toISOString().slice(0, 10);
      }
      throw new Error(
        'La hoja contiene un resultado de fórmula que no se puede convertir a CSV.',
      );
    }
    throw new Error(
      'La hoja contiene un valor que no se puede convertir a CSV.',
    );
  }
  return String(value);
}

function serializeCsv(rows: readonly (readonly string[])[]): string {
  const serializedRows = rows.map((row) =>
    row.map((value) => {
      if (/[",\r\n]/.test(value)) {
        const escaped = value.replaceAll(CSV_QUOTE, `${CSV_QUOTE}${CSV_QUOTE}`);
        return `${CSV_QUOTE}${escaped}${CSV_QUOTE}`;
      }
      return value;
    }),
  );
  return `${serializedRows.map((row) => row.join(CSV_SEPARATOR)).join('\n')}\n`;
}
