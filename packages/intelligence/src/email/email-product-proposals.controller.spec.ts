import { NotFoundException } from '@nestjs/common';
import { EmailProductProposalsController } from './email-product-proposals.controller';
import type { EmailProductProposalsService } from './email-product-proposals.service';

function makeController(nodeEnv: string) {
  const proposals = {
    discover: jest.fn().mockResolvedValue({ created: 0 }),
    list: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue({ id: 'proposal-1' }),
    approve: jest.fn().mockResolvedValue({ id: 'proposal-1' }),
    discard: jest.fn().mockResolvedValue({ id: 'proposal-1' }),
  };
  const config = {
    get: jest.fn((key: string) => (key === 'NODE_ENV' ? nodeEnv : undefined)),
  };
  const controller = new EmailProductProposalsController(
    proposals as unknown as EmailProductProposalsService,
    config as never,
  );
  return { controller, proposals };
}

describe('EmailProductProposalsController', () => {
  it('hides all proposal routes in production', () => {
    const { controller, proposals } = makeController('production');

    expect(() => controller.discover({ sub: 'user-1' }, {})).toThrow(
      NotFoundException,
    );
    expect(() => controller.list({ sub: 'user-1' }, {})).toThrow(
      NotFoundException,
    );
    expect(proposals.discover).not.toHaveBeenCalled();
    expect(proposals.list).not.toHaveBeenCalled();
  });

  it('scopes discovery to the authenticated user', async () => {
    const { controller, proposals } = makeController('development');

    await controller.discover(
      { sub: 'user-1' },
      { messageIds: ['message-1'], limit: 20 },
    );

    expect(proposals.discover).toHaveBeenCalledWith({
      userId: 'user-1',
      messageIds: ['message-1'],
      limit: 20,
    });
  });
});
