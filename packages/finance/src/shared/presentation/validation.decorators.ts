import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { normalizeCurrencyCode as normalizeDomainCurrencyCode } from '../domain/money';

export const ISO_CURRENCY_REGEX = /^[A-Z]{3}$/;
export const LAST_FOUR_REGEX = /^[0-9]{4}$/;

export function normalizeCurrencyCode(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  return normalizeDomainCurrencyCode(value);
}

export function normalizeLastFour(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  return value.trim();
}

/** Optional ISO 4217 alpha-3 currency (uppercase). */
export function CurrencyField() {
  return function (target: object, propertyKey: string | symbol) {
    Transform(({ value }) => normalizeCurrencyCode(value))(target, propertyKey);
    IsOptional()(target, propertyKey);
    IsString()(target, propertyKey);
    Matches(ISO_CURRENCY_REGEX, {
      message: 'currency must be a 3-letter ISO 4217 code',
    })(target, propertyKey);
  };
}

/** Required ISO 4217 alpha-3 currency (uppercase). */
export function RequiredCurrencyField() {
  return function (target: object, propertyKey: string | symbol) {
    Transform(({ value }) => normalizeCurrencyCode(value))(target, propertyKey);
    IsString()(target, propertyKey);
    Matches(ISO_CURRENCY_REGEX, {
      message: 'currency must be a 3-letter ISO 4217 code',
    })(target, propertyKey);
  };
}

export function OptionalLastFourField() {
  return function (target: object, propertyKey: string | symbol) {
    Transform(({ value }) => normalizeLastFour(value))(target, propertyKey);
    IsOptional()(target, propertyKey);
    IsString()(target, propertyKey);
    Matches(LAST_FOUR_REGEX, {
      message: 'lastFour must be exactly 4 digits',
    })(target, propertyKey);
  };
}

export function RequiredLastFourField() {
  return function (target: object, propertyKey: string | symbol) {
    Transform(({ value }) => normalizeLastFour(value))(target, propertyKey);
    IsString()(target, propertyKey);
    Matches(LAST_FOUR_REGEX, {
      message: 'lastFour must be exactly 4 digits',
    })(target, propertyKey);
  };
}

const ACCOUNT_NUMBER_DIGITS_REGEX = /^[0-9]{4,34}$/;

export function normalizeAccountNumberInput(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const digits = value.replace(/\D/g, '');
  return digits.length ? digits : value.trim();
}

export function OptionalAccountNumberField() {
  return function (target: object, propertyKey: string | symbol) {
    Transform(({ value }) => normalizeAccountNumberInput(value))(
      target,
      propertyKey,
    );
    IsOptional()(target, propertyKey);
    IsString()(target, propertyKey);
    Matches(ACCOUNT_NUMBER_DIGITS_REGEX, {
      message: 'accountNumber must be 4 to 34 digits',
    })(target, propertyKey);
  };
}

export function OptionalCalendarDayField() {
  return function (target: object, propertyKey: string | symbol) {
    Type(() => Number)(target, propertyKey);
    IsOptional()(target, propertyKey);
    IsInt()(target, propertyKey);
    Min(1)(target, propertyKey);
    Max(31)(target, propertyKey);
  };
}

export function OptionalColorField() {
  return function (target: object, propertyKey: string | symbol) {
    IsOptional()(target, propertyKey);
    IsString()(target, propertyKey);
    MaxLength(32)(target, propertyKey);
  };
}
