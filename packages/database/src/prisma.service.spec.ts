import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  let service: PrismaService;

  const mockConnect = jest.fn().mockResolvedValue(undefined);
  const mockDisconnect = jest.fn().mockResolvedValue(undefined);

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrismaService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (key: string) => {
              if (key === 'DATABASE_URL') {
                return 'postgresql://user:pass@localhost:5432/db';
              }
              throw new Error(`unexpected key ${key}`);
            },
            get: (key: string) => {
              if (key === 'NODE_ENV') return 'test';
              if (key === 'DATABASE_SSL_REJECT_UNAUTHORIZED') return undefined;
              return undefined;
            },
          },
        },
      ],
    }).compile();

    service = module.get(PrismaService);
    jest.spyOn(service, '$connect').mockImplementation(mockConnect);
    jest.spyOn(service, '$disconnect').mockImplementation(mockDisconnect);
  });

  it('connects on module init', async () => {
    await service.onModuleInit();
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it('disconnects on module destroy', async () => {
    await service.onModuleDestroy();
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });
});
