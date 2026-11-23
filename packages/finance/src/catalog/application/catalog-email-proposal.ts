import { BadRequestException, Injectable } from '@nestjs/common';
import type { EmailProductProposalDraft } from '@personal-os/contracts';
import type { ProposalAccountNumberInput } from './catalog-account-numbers.service';
import { CatalogAccountNumbersService } from './catalog-account-numbers.service';

const LAST_FOUR_PATTERN = /^\d{4}$/;

export type ProposalProduct =
  | {
      kind: 'ACCOUNT';
      accountType: NonNullable<EmailProductProposalDraft['accountType']>;
      plaintextAccountNumber: string | null;
    }
  | {
      kind: 'CARD';
      cardType: NonNullable<EmailProductProposalDraft['cardType']>;
    };

/** Validates an email product proposal before it becomes an account or card. */
@Injectable()
export class CatalogEmailProposal {
  constructor(private readonly numbers: CatalogAccountNumbersService) {}

  prepareAccountNumber(input: ProposalAccountNumberInput) {
    return this.numbers.prepareProposalAccountNumber(input);
  }

  product(draft: EmailProductProposalDraft): ProposalProduct {
    if (draft.productType === 'ACCOUNT') {
      return {
        kind: 'ACCOUNT',
        accountType: this.validatedAccountType(draft.accountType),
        plaintextAccountNumber: this.validatedProposalNumber(draft),
      };
    }
    return { kind: 'CARD', cardType: this.validatedCardType(draft) };
  }

  private validatedAccountType(
    accountType: EmailProductProposalDraft['accountType'],
  ): NonNullable<EmailProductProposalDraft['accountType']> {
    if (!accountType) {
      throw new BadRequestException(
        'Elige CHECKING, SAVINGS o INVESTMENT antes de aprobar la cuenta',
      );
    }
    return accountType;
  }

  private validatedCardType(
    draft: EmailProductProposalDraft,
  ): NonNullable<EmailProductProposalDraft['cardType']> {
    if (!draft.cardType) {
      throw new BadRequestException(
        'Elige CREDIT o DEBIT antes de aprobar la tarjeta',
      );
    }
    if (draft.cardType === 'DEBIT' && !draft.accountId) {
      throw new BadRequestException(
        'Asocia la cuenta antes de aprobar una tarjeta DEBIT',
      );
    }
    this.assertLastFour(draft.lastFour);
    return draft.cardType;
  }

  private validatedProposalNumber(
    draft: EmailProductProposalDraft,
  ): string | null {
    this.assertLastFour(draft.lastFour);
    if (draft.accountNumberCiphertext && !draft.accountNumberHash) {
      throw new BadRequestException('El número de cuenta cifrado no es válido');
    }
    if (!draft.accountNumberCiphertext && draft.accountNumberHash) {
      throw new BadRequestException(
        'El índice del número de cuenta no es válido',
      );
    }
    if (!draft.accountNumberCiphertext) {
      return null;
    }
    return this.numbers.decryptProposalNumber({
      ciphertext: draft.accountNumberCiphertext,
      hash: draft.accountNumberHash,
      lastFour: draft.lastFour,
    });
  }

  private assertLastFour(lastFour: string) {
    if (!LAST_FOUR_PATTERN.test(lastFour)) {
      throw new BadRequestException('lastFour debe tener 4 dígitos');
    }
  }
}
