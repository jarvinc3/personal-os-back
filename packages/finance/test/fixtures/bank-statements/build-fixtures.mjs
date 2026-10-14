// Minimal PDF writer used to build synthetic bank-statement fixtures.
// Text-only, Helvetica/WinAnsi, one page per statement period.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function escapeText(value) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

export function buildPdf(lines) {
  const content = [
    'BT',
    '/F1 9 Tf',
    '14 TL',
    '40 750 Td',
    ...lines.map((line) => `(${escapeText(line)}) Tj T*`),
    'ET',
  ].join('\n');
  const contentLength = Buffer.byteLength(content, 'latin1');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${contentLength} >>\nstream\n${content}\nendstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (const offset of offsets) {
    pdf += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

const BHD_SAVINGS = [
  'Banco BHD - Estado de cuenta de Ahorros',
  'Cuenta: 000-1234567-3447   Moneda: DOP',
  'Periodo: 01/09/2026 al 30/09/2026',
  'Balance anterior: 145,320.55',
  '',
  'Fecha       Descripcion                              Referencia        Debito       Credito',
  '02/09/2026  SUPERMERCADO NACIONAL SRL               REF-992001         4,512.30',
  '05/09/2026  PAGO NOMINA SEPTIEMBRE                  NOM-000145                    85,000.00',
  '09/09/2026  FARMACIA LOS HIDALGOS                   REF-992044         1,240.00',
  '14/09/2026  TRANSFERENCIA A ALTICE MOVIL            REF-992117         2,899.00',
  '21/09/2026  COLEGIO SANTO TOMAS                     REF-992233        18,500.00',
  '',
  'Balance al corte: 203,169.25',
];

const BHD_VISA = [
  'Banco BHD - Estado de cuenta Visa 6506',
  'Tarjeta: **** **** **** 6506   Moneda: DOP',
  'Periodo: 25/08/2026 al 24/09/2026',
  'Balance anterior: 32,450.00',
  '',
  'Fecha       Descripcion                              Referencia        Monto',
  '27/08/2026  AMAZON MARKETPLACE                       REF-778120         1,845.99',
  '30/08/2026  NETFLIX.COM                              REF-778210           649.00',
  '04/09/2026  LA SIRENA SUPERMERCADO                   REF-778455         6,320.75',
  '11/09/2026  UBER TRIP                                REF-778611           420.00',
  '18/09/2026  PAGO TARJETA BHD                         REF-778902        10,000.00',
  '',
  'Balance al corte: 31,685.74',
  'Pago minimo: 1,584.29',
  'Fecha limite de pago: 15/10/2026',
];

const POPULAR = [
  'Banco Popular Dominicano - Estado de cuenta',
  'Cuenta de Ahorros: ****5089   Moneda: DOP',
  'Desde 01/09/2026 hasta 30/09/2026',
  'Saldo anterior: 58,900.10',
  '',
  'Fecha       Concepto                        Documento      Debito      Credito',
  '03/09/2026  COMPRA POS JUMBO               DOC-551209      3,220.40',
  '07/09/2026  PAGO PRESTAMO PERSONAL         DOC-551244      9,800.00',
  '12/09/2026  DEPOSITO EFECTIVO SUCURSAL     DOC-551301                  6,500.00',
  '19/09/2026  PLANILLA SERVICIOS CLARO       DOC-551388      1,890.55',
  '26/09/2026  TRANSFERENCIA RECIBIDA         DOC-551420                 22,000.00',
  '',
  'Saldo al corte: 72,489.15',
];

const QIK = [
  'Qik Banco Digital - Estado de cuenta',
  'Cuenta: ****3695   Moneda: DOP',
  'Periodo 01/09/2026 - 30/09/2026',
  'Balance inicial: 12,300.00',
  '',
  'Fecha       Detalle                         Referencia        Monto',
  '05/09/2026  Pago de servicios EDESUR        QK-441200        2,150.35',
  '10/09/2026  Retiro cajero automatico        QK-441255        3,000.00',
  '15/09/2026  Transferencia recibida          QK-441301       15,000.00',
  '23/09/2026  Compra supermercado Bravo       QK-441400        4,780.90',
  '28/09/2026  Suscripcion Spotify             QK-441455          349.00',
  '',
  'Balance final: 17,019.75',
];

const fixtures = {
  'bhd/estado-cuenta-ahorro.pdf': BHD_SAVINGS,
  'bhd/estado-cuenta-visa-6506.pdf': BHD_VISA,
  'popular/estado-cuenta-ahorro-5089.pdf': POPULAR,
  'qik/estado-cuenta-3695.pdf': QIK,
};

for (const [relativePath, lines] of Object.entries(fixtures)) {
  const target = join(here, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, buildPdf(lines));
  console.log(`wrote ${relativePath}`);
}
