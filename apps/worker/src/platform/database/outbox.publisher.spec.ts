import { outboxBackoffMilliseconds } from './outbox.publisher';

describe('outboxBackoffMilliseconds', (): void => {
  it('applies capped exponential backoff', (): void => {
    expect(outboxBackoffMilliseconds(1, 1_000, 60_000)).toBe(1_000);
    expect(outboxBackoffMilliseconds(2, 1_000, 60_000)).toBe(2_000);
    expect(outboxBackoffMilliseconds(7, 1_000, 60_000)).toBe(60_000);
    expect(outboxBackoffMilliseconds(100, 1_000, 60_000)).toBe(60_000);
  });
});
