import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  AI_EMAIL_MESSAGE_STATUS_FILTERS,
  ListEmailMessagesQueryDto,
} from './list-email-messages-query.dto';

async function validateQuery(input: Record<string, unknown>) {
  return validate(plainToInstance(ListEmailMessagesQueryDto, input));
}

describe('ListEmailMessagesQueryDto', () => {
  it('acepta cada estado permitido', async () => {
    for (const status of AI_EMAIL_MESSAGE_STATUS_FILTERS) {
      await expect(validateQuery({ status })).resolves.toHaveLength(0);
    }
  });

  it('rechaza un estado desconocido', async () => {
    const errors = await validateQuery({ status: 'UNKNOWN' });

    expect(errors.map((error) => error.property)).toEqual(['status']);
  });

  it('recorta la búsqueda y descarta la que queda vacía', async () => {
    expect(plainToInstance(ListEmailMessagesQueryDto, { q: '  BHD ' }).q).toBe(
      'BHD',
    );

    await expect(validateQuery({ q: '   ' })).resolves.toHaveLength(0);
    expect(plainToInstance(ListEmailMessagesQueryDto, { q: '   ' }).q).toBe(
      undefined,
    );
  });
});
