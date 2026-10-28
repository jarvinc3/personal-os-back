import { QA_PASSWORD_LENGTH, generateQaPassword } from './qa-password';

const ITERATIONS = 200;
const MINIMUM_LENGTH = 24;
const LOWERCASE_PATTERN = /[a-z]/;
const UPPERCASE_PATTERN = /[A-Z]/;
const DIGIT_PATTERN = /[0-9]/;
const SYMBOL_PATTERN = /[^a-zA-Z0-9]/;

const generatedPasswords = (amount: number): string[] =>
  Array.from({ length: amount }, () => generateQaPassword());

describe('generateQaPassword', () => {
  it('includes every character class Supabase requires on each call', () => {
    for (const password of generatedPasswords(ITERATIONS)) {
      expect(password).toMatch(LOWERCASE_PATTERN);
      expect(password).toMatch(UPPERCASE_PATTERN);
      expect(password).toMatch(DIGIT_PATTERN);
      expect(password).toMatch(SYMBOL_PATTERN);
    }
  });

  it('reaches the minimum length that keeps Supabase out of weak_password', () => {
    for (const password of generatedPasswords(ITERATIONS)) {
      expect(password).toHaveLength(QA_PASSWORD_LENGTH);
      expect(password.length).toBeGreaterThanOrEqual(MINIMUM_LENGTH);
    }
  });

  it('never repeats a password', () => {
    expect(new Set(generatedPasswords(ITERATIONS)).size).toBe(ITERATIONS);
  });
});
