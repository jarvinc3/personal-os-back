import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateReceivableDto } from './create-receivable.dto';
import { UpdateReceivableDto } from './update-receivable.dto';

type DtoClass<T extends object> = new () => T;

async function problems<T extends object>(
  type: DtoClass<T>,
  payload: object,
): Promise<string[]> {
  const instance = plainToInstance(type, payload);
  const errors = await validate(instance, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((error) => error.property);
}

function instanceOf<T extends object>(type: DtoClass<T>, payload: object): T {
  return plainToInstance(type, payload);
}

const BASE_CREATE = { debtorName: 'Ana', amount: 100 };

describe('CreateReceivableDto description', () => {
  it('requires the description', async () => {
    expect(await problems(CreateReceivableDto, BASE_CREATE)).toContain(
      'description',
    );
  });

  it('rejects a blank description', async () => {
    expect(
      await problems(CreateReceivableDto, {
        ...BASE_CREATE,
        description: '   ',
      }),
    ).toContain('description');
  });

  it('rejects a description longer than 120 characters', async () => {
    expect(
      await problems(CreateReceivableDto, {
        ...BASE_CREATE,
        description: 'x'.repeat(121),
      }),
    ).toContain('description');
  });

  it('trims the description', async () => {
    const payload = {
      ...BASE_CREATE,
      description: '  Préstamo celular  ',
    };

    expect(await problems(CreateReceivableDto, payload)).toEqual([]);
    expect(instanceOf(CreateReceivableDto, payload).description).toBe(
      'Préstamo celular',
    );
  });
});

describe('UpdateReceivableDto description', () => {
  it('accepts an absent description', async () => {
    expect(await problems(UpdateReceivableDto, {})).toEqual([]);
  });

  it('keeps allowing a null description from an existing row', async () => {
    expect(
      await problems(UpdateReceivableDto, { description: null }),
    ).not.toContain('description');
  });

  it('applies the same rules when the description comes', async () => {
    expect(
      await problems(UpdateReceivableDto, { description: '   ' }),
    ).toContain('description');
    expect(
      await problems(UpdateReceivableDto, { description: 'x'.repeat(121) }),
    ).toContain('description');
  });

  it('trims the incoming description', async () => {
    const payload = { description: '  Cena cumpleaños  ' };

    expect(await problems(UpdateReceivableDto, payload)).toEqual([]);
    expect(instanceOf(UpdateReceivableDto, payload).description).toBe(
      'Cena cumpleaños',
    );
  });
});
