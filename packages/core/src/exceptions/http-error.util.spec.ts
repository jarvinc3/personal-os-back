import { httpExceptionDetails, toErrorField } from './http-error.util';

describe('httpExceptionDetails', () => {
  it('keeps actionable conflict fields outside message/error/statusCode', () => {
    expect(
      httpExceptionDetails({
        statusCode: 409,
        error: 'Conflict',
        message: 'Cannot archive institution',
        dependents: { accounts: 1, cards: 0, emailSources: 0, loans: 0 },
      }),
    ).toEqual({
      dependents: { accounts: 1, cards: 0, emailSources: 0, loans: 0 },
    });
  });

  it('returns undefined when there are no extra fields', () => {
    expect(
      httpExceptionDetails({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Account not found',
      }),
    ).toBeUndefined();
  });
});

describe('toErrorField', () => {
  it('falls back when the value is an object', () => {
    expect(toErrorField({ nested: true }, 'fallback')).toBe('fallback');
  });

  it('joins validation message arrays from ValidationPipe', () => {
    expect(
      toErrorField(
        [
          'categoryId must be a UUID',
          'periodStart must be a valid ISO 8601 date string',
        ],
        'Bad Request Exception',
      ),
    ).toBe(
      'categoryId must be a UUID; periodStart must be a valid ISO 8601 date string',
    );
  });
});
