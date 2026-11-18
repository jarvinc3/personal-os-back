import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ConnectGmailDto } from './connect-gmail.dto';

async function validateConnectGmail(input: Record<string, unknown>) {
  return validate(plainToInstance(ConnectGmailDto, input));
}

describe('ConnectGmailDto', () => {
  it('acepta un dominio en mayúsculas', async () => {
    await expect(
      validateConnectGmail({ senderFilter: 'BHD.COM.DO' }),
    ).resolves.toHaveLength(0);
  });

  it('acepta los tres períodos y el filtro en minúsculas', async () => {
    for (const period of ['TODAY', 'LAST_MONTH', 'LAST_3_MONTHS']) {
      await expect(
        validateConnectGmail({ period, senderFilter: 'bhd.com.do' }),
      ).resolves.toHaveLength(0);
    }
  });

  it('rechaza un período desconocido y un filtro con formato inválido', async () => {
    const errors = await validateConnectGmail({
      period: 'THIS_YEAR',
      senderFilter: 'from:bhd.com.do',
    });

    expect(errors.map((error) => error.property).sort()).toEqual([
      'period',
      'senderFilter',
    ]);
  });
});
