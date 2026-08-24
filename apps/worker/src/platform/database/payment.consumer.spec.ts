import { deterministicPaymentAuthorized } from './payment.consumer';

describe('deterministicPaymentAuthorized', (): void => {
  it('returns stable authorized and failed outcomes', (): void => {
    expect(deterministicPaymentAuthorized('00000000-0000-4000-8000-000000000000')).toBe(true);
    expect(deterministicPaymentAuthorized('00000000-0000-4000-8000-000000000004')).toBe(false);
    expect(deterministicPaymentAuthorized('00000000-0000-4000-8000-000000000004')).toBe(false);
  });
});
