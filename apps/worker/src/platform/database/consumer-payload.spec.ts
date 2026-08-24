import { InvalidWorkerMessageError, parseOrderEventPayload } from './consumer-payload';

describe('parseOrderEventPayload', (): void => {
  it('accepts the minimal identifier-only payload', (): void => {
    expect(parseOrderEventPayload({ orderId: '018f3a9a-6c41-7abc-8def-1234567890ab' })).toEqual({
      orderId: '018f3a9a-6c41-7abc-8def-1234567890ab',
    });
  });

  it.each([
    null,
    [],
    {},
    { orderId: 'not-a-uuid' },
    { orderId: '018f3a9a-6c41-7abc-8def-1234567890ab', userId: 42 },
  ])('rejects malformed values with one safe error', (payload): void => {
    expect(() => parseOrderEventPayload(payload as never)).toThrow(InvalidWorkerMessageError);
  });
});
