import {
  createEventEnvelope,
  InvalidEventEnvelopeError,
  parseEventEnvelope,
  serializeEventEnvelope,
} from '../src/event-envelope';

describe('event envelope', (): void => {
  const envelope = {
    id: '018f3a9a-6c41-7abc-8def-1234567890ab',
    occurredAt: '2026-08-24T12:34:56.789Z',
    payload: { orderId: '018f3a9a-6c41-7abc-8def-1234567890ac' },
    type: 'order.created',
  } as const;

  it('round-trips the fixed JSON contract', (): void => {
    const result = parseEventEnvelope(serializeEventEnvelope(createEventEnvelope(envelope)));

    expect(result).toEqual(envelope);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it.each([
    { ...envelope, extra: true },
    { ...envelope, id: 'not-an-id' },
    { ...envelope, occurredAt: '2026-08-24' },
    { ...envelope, type: 'OrderCreated' },
    { ...envelope, payload: { unsupported: Number.NaN } },
  ])('rejects malformed envelopes without exposing a cause', (value): void => {
    expect(() => createEventEnvelope(value)).toThrow(InvalidEventEnvelopeError);

    try {
      createEventEnvelope(value);
    } catch (error: unknown) {
      expect(error).toEqual(new InvalidEventEnvelopeError());
      expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
    }
  });

  it('rejects oversized content before parsing', (): void => {
    const content = Buffer.alloc(256 * 1_024 + 1, 0x20);

    expect(() => parseEventEnvelope(content)).toThrow(InvalidEventEnvelopeError);
  });
});
