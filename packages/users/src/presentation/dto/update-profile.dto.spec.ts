import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateProfileDto } from './update-profile.dto';

describe('UpdateProfileDto', () => {
  it('accepts the user time zone as an IANA name', async () => {
    const dto = plainToInstance(UpdateProfileDto, {
      timezone: 'America/La_Paz',
    });

    const errors = await validate(dto);

    expect(errors).toEqual([]);
  });

  it('rejects an unknown zone on the timezone field', async () => {
    const dto = plainToInstance(UpdateProfileDto, {
      timezone: 'Mars/Olympus',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
    expect(errors[0]?.property).toBe('timezone');
  });
});
