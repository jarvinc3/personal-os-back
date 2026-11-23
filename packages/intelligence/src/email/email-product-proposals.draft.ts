import { BadRequestException } from '@nestjs/common';
import type { EmailProductProposalDraft } from '@personal-os/contracts';
import type { UpdateEmailProductProposalDto } from './dto/email-product-proposal.dto';

const LAST_FOUR_PATTERN = /^\d{4}$/;

export function parseDraft(value: unknown): EmailProductProposalDraft {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BadRequestException('El borrador de propuesta no es válido');
  }
  const draft = value as EmailProductProposalDraft;
  if (
    (draft.productType !== 'ACCOUNT' && draft.productType !== 'CARD') ||
    typeof draft.lastFour !== 'string' ||
    !LAST_FOUR_PATTERN.test(draft.lastFour)
  ) {
    throw new BadRequestException('El borrador de propuesta no es válido');
  }
  return draft;
}

export function assertPatchAllowed({
  draft,
  patch,
}: {
  draft: EmailProductProposalDraft;
  patch: UpdateEmailProductProposalDto;
}): void {
  assertNoCardFieldsOnAccount({ draft, patch });
  assertNoAccountFieldsOnCard({ draft, patch });
  assertNoCurrencyOnCard({ draft, patch });
  assertLastFourChangeHasNumber({ draft, patch });
}

function assertNoCardFieldsOnAccount({
  draft,
  patch,
}: {
  draft: EmailProductProposalDraft;
  patch: UpdateEmailProductProposalDto;
}): void {
  if (draft.productType !== 'ACCOUNT') {
    return;
  }
  if (!patch.cardType && !patch.network && !patch.accountId) {
    return;
  }
  throw new BadRequestException(
    'Los campos de tarjeta no aplican a esta propuesta',
  );
}

function assertNoAccountFieldsOnCard({
  draft,
  patch,
}: {
  draft: EmailProductProposalDraft;
  patch: UpdateEmailProductProposalDto;
}): void {
  if (draft.productType !== 'CARD') {
    return;
  }
  if (!patch.accountType && patch.accountNumber === undefined) {
    return;
  }
  throw new BadRequestException(
    'Los campos de cuenta no aplican a esta propuesta',
  );
}

function assertNoCurrencyOnCard({
  draft,
  patch,
}: {
  draft: EmailProductProposalDraft;
  patch: UpdateEmailProductProposalDto;
}): void {
  if (draft.productType !== 'CARD' || patch.currency === undefined) {
    return;
  }
  throw new BadRequestException(
    'La moneda se configura en el balance de la tarjeta',
  );
}

function assertLastFourChangeHasNumber({
  draft,
  patch,
}: {
  draft: EmailProductProposalDraft;
  patch: UpdateEmailProductProposalDto;
}): void {
  if (patch.lastFour === undefined || patch.lastFour === draft.lastFour) {
    return;
  }
  if (!draft.accountNumberCiphertext) {
    return;
  }
  if (patch.accountNumber !== undefined) {
    return;
  }
  throw new BadRequestException(
    'Envía el número completo junto con los últimos 4 al cambiarlos',
  );
}

export function buildUpdatedDraft({
  draft,
  patch,
}: {
  draft: EmailProductProposalDraft;
  patch: UpdateEmailProductProposalDto;
}): EmailProductProposalDraft {
  return {
    ...draft,
    name: patch.name ?? draft.name,
    lastFour: patch.lastFour ?? draft.lastFour,
    currency: updatedCurrency({ draft, patch }),
    accountType: patch.accountType ?? draft.accountType,
    cardType: patch.cardType ?? draft.cardType,
    network: patch.network ?? draft.network,
    accountId:
      patch.accountId === undefined ? draft.accountId : patch.accountId,
    institution: updatedInstitution({ draft, patch }),
  };
}

function updatedCurrency({
  draft,
  patch,
}: {
  draft: EmailProductProposalDraft;
  patch: UpdateEmailProductProposalDto;
}): string | null {
  if (draft.productType !== 'ACCOUNT') {
    return draft.currency;
  }
  return patch.currency ?? draft.currency;
}

function updatedInstitution({
  draft,
  patch,
}: {
  draft: EmailProductProposalDraft;
  patch: UpdateEmailProductProposalDto;
}): EmailProductProposalDraft['institution'] {
  return {
    name: patch.institutionName ?? draft.institution.name,
    type: patch.institutionType ?? draft.institution.type,
    domain:
      patch.institutionDomain === undefined
        ? draft.institution.domain
        : patch.institutionDomain,
    country: patch.institutionCountry ?? draft.institution.country,
  };
}

export function lastFourHintForNumber({
  draft,
  patch,
}: {
  draft: EmailProductProposalDraft;
  patch: UpdateEmailProductProposalDto;
}): { lastFour?: string } {
  if (patch.lastFour !== undefined) {
    return { lastFour: patch.lastFour };
  }
  if (patch.accountNumber === null) {
    return { lastFour: draft.lastFour };
  }
  return {};
}

export function withFinalLastFour(
  draft: EmailProductProposalDraft,
  lastFour: string,
): EmailProductProposalDraft {
  if (lastFour === draft.lastFour) {
    return draft;
  }
  return { ...draft, lastFour };
}
