import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@personal-os/config';
import {
  ACCOUNT_NUMBER_MAX_DIGITS,
  ACCOUNT_NUMBER_MIN_DIGITS,
  isBankAccountType,
  normalizeAccountNumber,
} from '../../shared/domain/account-number';
import { CASH_ACCOUNT_TYPE } from '../../shared/domain/cash';
import {
  accountNumberLast4,
  decryptAccountNumber,
  encryptAccountNumber,
  fingerprintAccountNumber,
} from '../../shared/infrastructure/account-number-encryption.util';
import type { AccountNumberColumns } from '../infrastructure/catalog.repository';

const LAST_FOUR_PATTERN = /^\d{4}$/;
const PROPOSAL_ACCOUNT_NUMBER_PATTERN = /^[0-9\s-]{4,48}$/;

export type ProposalAccountNumberInput = {
  accountNumber?: string | null;
  lastFour?: string;
};

export type ProposalAccountNumberColumns = {
  ciphertext: string | null;
  hash: string | null;
  lastFour: string;
};

export type NumberColumnsResolution = {
  type: string;
  clearAccountNumber: boolean;
  requested: string | null | undefined;
  requestedLastFour: string | undefined;
  existingAccountNumber: string | null;
  existingLastFour: string | null;
  existingType: string;
};

/**
 * Validates, encrypts and fingerprints account numbers. The plaintext never
 * reaches storage and the key lives only here.
 */
@Injectable()
export class CatalogAccountNumbersService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  private get dataEncryptionKey(): string {
    return this.config.get('DATA_ENCRYPTION_KEY', { infer: true });
  }

  prepareProposalAccountNumber(
    input: ProposalAccountNumberInput,
  ): ProposalAccountNumberColumns {
    const full = this.validatedProposalNumber(input.accountNumber);
    const lastFour = input.lastFour ?? (full ? accountNumberLast4(full) : null);
    this.assertLastFour(lastFour, full);
    return {
      ciphertext: full
        ? encryptAccountNumber(full, this.dataEncryptionKey)
        : null,
      hash: full
        ? fingerprintAccountNumber(full, this.dataEncryptionKey)
        : null,
      lastFour,
    };
  }

  decryptProposalNumber(input: {
    ciphertext: string;
    hash: string | null;
    lastFour: string;
  }): string {
    const plaintext = decryptAccountNumber(
      input.ciphertext,
      this.dataEncryptionKey,
    );
    if (
      fingerprintAccountNumber(plaintext, this.dataEncryptionKey) !==
        input.hash ||
      accountNumberLast4(plaintext) !== input.lastFour
    ) {
      throw new BadRequestException('El número de cuenta cifrado no coincide');
    }
    return plaintext;
  }

  resolveColumns(
    params: NumberColumnsResolution,
  ): AccountNumberColumns | Partial<AccountNumberColumns> {
    if (params.clearAccountNumber) {
      if (params.requestedLastFour) {
        throw new BadRequestException(
          'CASH accounts must not set accountNumberLast4',
        );
      }
      return this.buildColumns(params.type, params.requested, null);
    }
    if (params.requested !== undefined) {
      return this.buildColumns(
        params.type,
        params.requested,
        params.requested === null
          ? (params.requestedLastFour ?? params.existingLastFour)
          : params.requestedLastFour,
      );
    }
    if (params.requestedLastFour !== undefined) {
      const currentFullNumber = params.existingAccountNumber
        ? decryptAccountNumber(
            params.existingAccountNumber,
            this.dataEncryptionKey,
          )
        : null;
      return this.buildColumns(
        params.type,
        currentFullNumber,
        params.requestedLastFour,
      );
    }
    if (
      params.existingType === CASH_ACCOUNT_TYPE &&
      params.type !== CASH_ACCOUNT_TYPE
    ) {
      return this.buildColumns(params.type, null, params.existingLastFour);
    }
    return {};
  }

  buildColumns(
    type: string,
    raw: string | null | undefined,
    requestedLastFour: string | null | undefined,
  ): AccountNumberColumns {
    const accountNumber = normalizeAccountNumber(raw);
    if (!isBankAccountType(type)) {
      if (accountNumber || requestedLastFour) {
        throw new BadRequestException(
          'CASH accounts must not set accountNumber or accountNumberLast4',
        );
      }
      return {
        accountNumber: null,
        accountNumberLast4: null,
        accountNumberHash: null,
      };
    }
    this.assertAccountNumberRange(accountNumber);
    const lastFour = this.resolveLastFour(accountNumber, requestedLastFour);
    return {
      accountNumber: accountNumber
        ? encryptAccountNumber(accountNumber, this.dataEncryptionKey)
        : null,
      accountNumberLast4: lastFour,
      accountNumberHash: accountNumber
        ? fingerprintAccountNumber(accountNumber, this.dataEncryptionKey)
        : null,
    };
  }

  private validatedProposalNumber(
    accountNumber: string | null | undefined,
  ): string | null {
    if (
      accountNumber != null &&
      !PROPOSAL_ACCOUNT_NUMBER_PATTERN.test(accountNumber)
    ) {
      throw new BadRequestException(
        'accountNumber solo puede contener dígitos, espacios y guiones',
      );
    }
    const full = normalizeAccountNumber(accountNumber);
    if (
      full &&
      (full.length < ACCOUNT_NUMBER_MIN_DIGITS ||
        full.length > ACCOUNT_NUMBER_MAX_DIGITS)
    ) {
      throw new BadRequestException(
        'accountNumber debe tener de 4 a 34 dígitos',
      );
    }
    return full;
  }

  private assertLastFour(
    lastFour: string | null,
    full: string | null,
  ): asserts lastFour is string {
    if (!lastFour || !LAST_FOUR_PATTERN.test(lastFour)) {
      throw new BadRequestException('lastFour debe tener 4 dígitos');
    }
    if (full && accountNumberLast4(full) !== lastFour) {
      throw new BadRequestException(
        'lastFour debe coincidir con el final del número de cuenta',
      );
    }
  }

  private assertAccountNumberRange(accountNumber: string | null): void {
    if (
      accountNumber &&
      (accountNumber.length < ACCOUNT_NUMBER_MIN_DIGITS ||
        accountNumber.length > ACCOUNT_NUMBER_MAX_DIGITS)
    ) {
      throw new BadRequestException(
        'CHECKING, SAVINGS, and INVESTMENT accounts require an account number of 4 to 34 digits',
      );
    }
  }

  private resolveLastFour(
    accountNumber: string | null,
    requestedLastFour: string | null | undefined,
  ): string {
    const derivedLastFour = accountNumber ? accountNumber.slice(-4) : null;
    if (requestedLastFour && !LAST_FOUR_PATTERN.test(requestedLastFour)) {
      throw new BadRequestException('accountNumberLast4 debe tener 4 dígitos');
    }
    if (
      derivedLastFour &&
      requestedLastFour &&
      derivedLastFour !== requestedLastFour
    ) {
      throw new BadRequestException(
        'accountNumberLast4 debe coincidir con el final de accountNumber',
      );
    }
    const lastFour = derivedLastFour ?? requestedLastFour ?? null;
    if (!lastFour) {
      throw new BadRequestException(
        'CHECKING, SAVINGS, and INVESTMENT accounts require accountNumberLast4 or a full account number',
      );
    }
    return lastFour;
  }
}
