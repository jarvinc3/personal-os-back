import { MODULE_CONTEXT, MODULE_CONTEXT_SLUGS } from './module-context';

describe('MODULE_CONTEXT', () => {
  it('no longer exposes subscriptions as its own module', () => {
    expect(MODULE_CONTEXT_SLUGS).not.toContain('subscriptions');
    expect(MODULE_CONTEXT).not.toHaveProperty('subscriptions');
  });

  it('moves the subscription tools into finance', () => {
    expect(MODULE_CONTEXT.finance.allowedTools).toEqual(
      expect.arrayContaining([
        'list_subscriptions',
        'create_subscription',
        'confirm_subscription_payment',
      ]),
    );
  });
});
