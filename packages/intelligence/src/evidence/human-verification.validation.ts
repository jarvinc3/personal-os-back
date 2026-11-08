import { BadRequestException } from '@nestjs/common';
import type { HumanVerificationLabelsDto } from './dto/human-verification-labels.dto';
import type { HumanVerificationVerdict } from './human-verification.constants';

export type HumanVerificationLabelInput = HumanVerificationLabelsDto & {
  verdict: HumanVerificationVerdict;
};

export function assertHumanVerificationLabels(
  input: HumanVerificationLabelInput,
): void {
  if (input.verdict === 'REJECTED' && !input.notes?.trim()) {
    throw new BadRequestException('Indica por qué se rechaza este mensaje');
  }
  if (
    input.verdict === 'CORRECTED' &&
    input.relevance === undefined &&
    input.semanticType === undefined &&
    input.routes === undefined &&
    input.transaction === undefined
  ) {
    throw new BadRequestException('Incluye al menos una etiqueta corregida');
  }
  if (input.semanticType === 'OTHER' && !input.notes?.trim()) {
    throw new BadRequestException('El tipo Otro requiere una nota');
  }
  assertTransactionMatchesSemanticType(input);
  assertSecurityRelevance(input);
}

export function humanVerificationPayload(
  input: HumanVerificationLabelsDto,
): Record<string, unknown> | undefined {
  const labels: Record<string, unknown> = {
    relevance: input.relevance,
    semanticType: input.semanticType,
    routes: input.routes,
    transaction: input.transaction,
  };
  const definedLabels = Object.fromEntries(
    Object.entries(labels).filter(([, value]) => value !== undefined),
  );
  if (!Object.keys(definedLabels).length) {
    return undefined;
  }
  // ValidationPipe entrega transaction como instancia del DTO; JSONB devuelve
  // un objeto plano. Normalizar evita comparar prototipos distintos en el retry.
  return JSON.parse(JSON.stringify(definedLabels)) as Record<string, unknown>;
}

function assertTransactionMatchesSemanticType(
  input: HumanVerificationLabelsDto,
): void {
  if (input.semanticType === 'FIN_TRANSACTION') {
    if (!input.transaction?.kind) {
      throw new BadRequestException('Indica el tipo de transacción');
    }
    return;
  }
  if (
    input.semanticType === 'PURCHASE_RECEIPT' ||
    input.semanticType === 'SUBSCRIPTION_BILLING'
  ) {
    if (input.transaction?.kind !== undefined) {
      throw new BadRequestException('El recibo o cobro no admite kind');
    }
    return;
  }
  if (input.transaction !== undefined) {
    throw new BadRequestException('Este tipo no admite transacción');
  }
}

function assertSecurityRelevance(input: HumanVerificationLabelsDto): void {
  if (input.semanticType === 'SECURITY_ALERT' && input.relevance === false) {
    throw new BadRequestException('Relevancia incompatible con el tipo');
  }
  if (input.semanticType === 'SECURITY_OTP' && input.relevance === true) {
    throw new BadRequestException('Relevancia incompatible con el tipo');
  }
}
