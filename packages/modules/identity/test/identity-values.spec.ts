import {
  IDENTITY_ACCOUNT_STATUSES,
  InvalidIdentityAccountIdError,
  InvalidIdentityAccountStatusError,
  InvalidIdentityLoginNameError,
  parseIdentityAccountId,
  parseIdentityAccountStatus,
  parseIdentityLoginName,
  type IdentityAccountId,
} from '../src/domain/identity-account.values';
import {
  IdentityAggregateVersionExhaustedError,
  InvalidIdentityAggregateVersionError,
  InvalidIdentityIntervalSecondsError,
  InvalidIdentityInstantError,
  MAX_IDENTITY_AGGREGATE_VERSION,
  MAX_IDENTITY_INTERVAL_SECONDS,
  compareIdentityInstants,
  nextIdentityAggregateVersion,
  parseIdentityAggregateVersion,
  parseIdentityInstant,
  tryAddIdentitySeconds,
  type IdentityAggregateVersion,
  type IdentityInstant,
} from '../src/domain/identity-values';

type ErrorClass = abstract new (...arguments_: never[]) => Error;

function captureError(operation: () => unknown): Error {
  try {
    operation();
  } catch (error: unknown) {
    if (error instanceof Error) {
      return error;
    }
  }

  throw new Error('Expected the operation to throw an Error');
}

function expectFixedSafeError(
  operation: () => unknown,
  expectedClass: ErrorClass,
  rejectedValue: string,
): void {
  const error = captureError(operation);

  expect(error).toBeInstanceOf(expectedClass);
  expect(String(error)).not.toContain(rejectedValue);
  expect(JSON.stringify(error)).not.toContain(rejectedValue);
  expect((error as { cause?: unknown }).cause).toBeUndefined();
}

describe('Identity Account identifiers', (): void => {
  it.each([
    '00000000-0000-7000-8000-000000000000',
    '01890f3a-8bcd-7def-8abc-0123456789ab',
    'ffffffff-ffff-7fff-bfff-ffffffffffff',
  ])('retains a canonical lowercase UUIDv7 Account id: %s', (accountId): void => {
    expect(parseIdentityAccountId(accountId)).toBe(accountId);
  });

  it.each([
    ['uppercase hexadecimal', '01890F3A-8BCD-7DEF-8ABC-0123456789AB'],
    ['UUIDv4', '01890f3a-8bcd-4def-8abc-0123456789ab'],
    ['UUIDv6', '01890f3a-8bcd-6def-8abc-0123456789ab'],
    ['UUIDv8', '01890f3a-8bcd-8def-8abc-0123456789ab'],
    ['non-RFC variant', '01890f3a-8bcd-7def-7abc-0123456789ab'],
    ['missing separators', '01890f3a8bcd7def8abc0123456789ab'],
    ['invalid hexadecimal', '01890f3a-8bcd-7def-8abc-0123456789az'],
    ['leading whitespace', ' 01890f3a-8bcd-7def-8abc-0123456789ab'],
    ['trailing whitespace', '01890f3a-8bcd-7def-8abc-0123456789ab '],
    ['empty input', ''],
  ])('rejects %s', (_scenario, accountId): void => {
    expect(() => parseIdentityAccountId(accountId)).toThrow(InvalidIdentityAccountIdError);
  });

  it.each([undefined, null, 7, {}, []])(
    'rejects a non-string runtime Account id: %p',
    (accountId): void => {
      expect(() => parseIdentityAccountId(accountId)).toThrow(InvalidIdentityAccountIdError);
    },
  );

  it('does not expose a rejected Account id', (): void => {
    const rejectedValue = 'customer-account-id';

    expectFixedSafeError(
      () => parseIdentityAccountId(rejectedValue),
      InvalidIdentityAccountIdError,
      rejectedValue,
    );
  });
});

describe('Identity login names', (): void => {
  it.each([
    ['minimum length', 'abc'],
    ['allowed punctuation', 'catalog.admin_1-prod'],
    ['digit prefix', '7.admin'],
    ['maximum length', `a${'z'.repeat(63)}`],
  ])('retains a canonical %s login without transformation', (_scenario, login): void => {
    expect(parseIdentityLoginName(login)).toBe(login);
  });

  it.each([
    ['empty value', ''],
    ['one character', 'a'],
    ['two characters', 'ab'],
    ['more than 64 characters', `a${'z'.repeat(64)}`],
    ['period prefix', '.admin'],
    ['underscore prefix', '_admin'],
    ['hyphen prefix', '-admin'],
    ['uppercase ASCII', 'Admin'],
    ['leading whitespace', ' admin'],
    ['trailing whitespace', 'admin '],
    ['interior whitespace', 'catalog admin'],
    ['slash', 'catalog/admin'],
    ['at sign', 'admin@example'],
    ['non-ASCII', 'café.admin'],
    ['full-width confusable', 'ａdmin'],
    ['control character', 'admin\nname'],
    ['zero-width character', 'admin\u200bname'],
  ])('rejects a login with %s instead of normalizing it', (_scenario, login): void => {
    expect(() => parseIdentityLoginName(login)).toThrow(InvalidIdentityLoginNameError);
  });

  it.each([undefined, null, 7, {}, []])('rejects a non-string runtime login: %p', (login): void => {
    expect(() => parseIdentityLoginName(login)).toThrow(InvalidIdentityLoginNameError);
  });

  it('does not trim, case-fold, or expose a rejected login', (): void => {
    const rejectedValue = ' Sensitive.Admin ';

    expectFixedSafeError(
      () => parseIdentityLoginName(rejectedValue),
      InvalidIdentityLoginNameError,
      rejectedValue,
    );
  });
});

describe('Identity Account statuses', (): void => {
  it.each(IDENTITY_ACCOUNT_STATUSES)('retains supported Account status %s', (status): void => {
    expect(parseIdentityAccountStatus(status)).toBe(status);
  });

  it.each(['active', 'RETIRED', ' ACTIVE', 'ACTIVE ', '', undefined, null, 7, {}, []])(
    'rejects unsupported Account status %p',
    (status): void => {
      expect(() => parseIdentityAccountStatus(status)).toThrow(InvalidIdentityAccountStatusError);
    },
  );

  it('publishes a frozen status registry and a fixed safe rejection', (): void => {
    const rejectedValue = 'persistence-account-status';

    expect(Object.isFrozen(IDENTITY_ACCOUNT_STATUSES)).toBe(true);
    expectFixedSafeError(
      () => parseIdentityAccountStatus(rejectedValue),
      InvalidIdentityAccountStatusError,
      rejectedValue,
    );
  });
});

describe('Identity instants', (): void => {
  it.each([
    '1000-01-01T00:00:00.000000Z',
    '2000-02-29T23:59:59.000001Z',
    '2024-02-29T12:34:56.123456Z',
    '2026-08-23T12:34:56.999999Z',
    '9999-12-31T23:59:59.999999Z',
  ])('retains a valid lossless MySQL-range instant: %s', (instant): void => {
    expect(parseIdentityInstant(instant)).toBe(instant);
  });

  it.each([
    ['below the MySQL range', '0999-12-31T23:59:59.999999Z'],
    ['non-leap century day', '1900-02-29T12:00:00.000000Z'],
    ['non-leap year day', '2023-02-29T12:00:00.000000Z'],
    ['invalid day for month', '2026-04-31T12:00:00.000000Z'],
    ['zero month', '2026-00-01T12:00:00.000000Z'],
    ['month above twelve', '2026-13-01T12:00:00.000000Z'],
    ['zero day', '2026-08-00T12:00:00.000000Z'],
    ['hour above twenty-three', '2026-08-23T24:00:00.000000Z'],
    ['minute above fifty-nine', '2026-08-23T23:60:00.000000Z'],
    ['unsupported leap second', '2026-08-23T23:59:60.000000Z'],
    ['three fractional digits', '2026-08-23T12:34:56.123Z'],
    ['seven fractional digits', '2026-08-23T12:34:56.1234567Z'],
    ['numeric UTC offset', '2026-08-23T12:34:56.123456+00:00'],
    ['lowercase separators', '2026-08-23t12:34:56.123456z'],
    ['leading whitespace', ' 2026-08-23T12:34:56.123456Z'],
    ['trailing whitespace', '2026-08-23T12:34:56.123456Z '],
  ])('rejects an instant with %s', (_scenario, instant): void => {
    expect(() => parseIdentityInstant(instant)).toThrow(InvalidIdentityInstantError);
  });

  it.each([undefined, null, 7, {}, []])(
    'rejects a non-string runtime instant: %p',
    (instant): void => {
      expect(() => parseIdentityInstant(instant)).toThrow(InvalidIdentityInstantError);
    },
  );

  it('compares fixed-width instants without losing microseconds', (): void => {
    const earlier = parseIdentityInstant('2026-08-23T12:34:56.123456Z');
    const later = parseIdentityInstant('2026-08-23T12:34:56.123457Z');

    expect(compareIdentityInstants(earlier, later)).toBe(-1);
    expect(compareIdentityInstants(later, earlier)).toBe(1);
    expect(compareIdentityInstants(earlier, earlier)).toBe(0);
  });

  it('orders instants across calendar boundaries', (): void => {
    const endOfDay = parseIdentityInstant('2026-08-23T23:59:59.999999Z');
    const nextDay = parseIdentityInstant('2026-08-24T00:00:00.000000Z');

    expect(compareIdentityInstants(endOfDay, nextDay)).toBe(-1);
  });

  it('does not expose a rejected instant', (): void => {
    const rejectedValue = 'customer-controlled-timestamp';

    expectFixedSafeError(
      () => parseIdentityInstant(rejectedValue),
      InvalidIdentityInstantError,
      rejectedValue,
    );
  });
});

describe('Identity whole-second interval arithmetic', (): void => {
  it('publishes the exact unsigned interval bound', (): void => {
    expect(MAX_IDENTITY_INTERVAL_SECONDS).toBe(4_294_967_295);
  });

  it.each([
    ['zero interval', '2026-08-23T12:34:56.123456Z', 0, '2026-08-23T12:34:56.123456Z'],
    ['second-to-minute carry', '2026-08-23T12:34:59.999999Z', 1, '2026-08-23T12:35:00.999999Z'],
    ['minute-to-hour carry', '2026-08-23T12:59:59.000001Z', 1, '2026-08-23T13:00:00.000001Z'],
    ['day carry', '2026-08-23T23:59:59.654321Z', 1, '2026-08-24T00:00:00.654321Z'],
    ['thirty-day month carry', '2026-04-30T23:59:59.111111Z', 1, '2026-05-01T00:00:00.111111Z'],
    ['ordinary February carry', '2023-02-28T23:59:59.222222Z', 1, '2023-03-01T00:00:00.222222Z'],
    ['leap-day entry', '2024-02-28T23:59:59.333333Z', 1, '2024-02-29T00:00:00.333333Z'],
    ['leap-day exit', '2024-02-29T23:59:59.444444Z', 1, '2024-03-01T00:00:00.444444Z'],
    [
      'divisible-by-400 leap century',
      '2000-02-28T23:59:59.555555Z',
      1,
      '2000-02-29T00:00:00.555555Z',
    ],
    ['non-leap century', '2100-02-28T23:59:59.666666Z', 1, '2100-03-01T00:00:00.666666Z'],
    ['year carry', '2026-12-31T23:59:59.777777Z', 1, '2027-01-01T00:00:00.777777Z'],
    [
      'maximum supported interval',
      '1000-01-01T00:00:00.654321Z',
      MAX_IDENTITY_INTERVAL_SECONDS,
      '1136-02-08T06:28:15.654321Z',
    ],
  ] as const)(
    'adds a %s with exact Gregorian and microsecond behavior',
    (_scenario, initialValue, seconds, expected): void => {
      const initial = parseIdentityInstant(initialValue);

      expect(tryAddIdentitySeconds(initial, seconds)).toBe(expected);
    },
  );

  it('returns the greatest representable instant without truncating its fraction', (): void => {
    const penultimateSecond = parseIdentityInstant('9999-12-31T23:59:58.999999Z');

    expect(tryAddIdentitySeconds(penultimateSecond, 1)).toBe('9999-12-31T23:59:59.999999Z');
  });

  it.each([
    ['one second beyond the range', '9999-12-31T23:59:59.999999Z', 1],
    ['a two-second carry beyond the range', '9999-12-31T23:59:58.000001Z', 2],
  ] as const)('returns null only for %s', (_scenario, initialValue, seconds): void => {
    const initial = parseIdentityInstant(initialValue);

    expect(tryAddIdentitySeconds(initial, seconds)).toBeNull();
  });

  it.each([
    -1,
    0.5,
    Number.NaN,
    Number.NEGATIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    MAX_IDENTITY_INTERVAL_SECONDS + 1,
    '1',
    true,
    null,
    undefined,
    {},
    [],
  ])('rejects an unsupported whole-second interval: %p', (seconds): void => {
    const initial = parseIdentityInstant('2026-08-23T12:34:56.123456Z');

    expect(() => tryAddIdentitySeconds(initial, seconds)).toThrow(
      InvalidIdentityIntervalSecondsError,
    );
  });

  it('defensively validates the branded instant at runtime', (): void => {
    const malformedInstant = 'sensitive-invalid-session-instant' as IdentityInstant;

    expectFixedSafeError(
      () => tryAddIdentitySeconds(malformedInstant, 0),
      InvalidIdentityInstantError,
      malformedInstant,
    );
  });

  it('uses a fixed cause-free error that does not expose an invalid interval', (): void => {
    const initial = parseIdentityInstant('2026-08-23T12:34:56.123456Z');
    const rejectedValue = 'sensitive-session-interval';

    expectFixedSafeError(
      () => tryAddIdentitySeconds(initial, rejectedValue),
      InvalidIdentityIntervalSecondsError,
      rejectedValue,
    );
  });
});

describe('Identity aggregate versions', (): void => {
  it.each([1, 2, MAX_IDENTITY_AGGREGATE_VERSION])(
    'retains supported version %d',
    (version): void => {
      expect(parseIdentityAggregateVersion(version)).toBe(version);
    },
  );

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    MAX_IDENTITY_AGGREGATE_VERSION + 1,
    '1',
    null,
  ])('rejects unsupported version %p', (version): void => {
    expect(() => parseIdentityAggregateVersion(version)).toThrow(
      InvalidIdentityAggregateVersionError,
    );
  });

  it('increments a validated version exactly once', (): void => {
    expect(nextIdentityAggregateVersion(parseIdentityAggregateVersion(41))).toBe(42);
  });

  it('defensively validates a branded version at runtime', (): void => {
    expect(() => nextIdentityAggregateVersion(0 as IdentityAggregateVersion)).toThrow(
      InvalidIdentityAggregateVersionError,
    );
  });

  it('rejects unsigned-version exhaustion', (): void => {
    expect(() =>
      nextIdentityAggregateVersion(parseIdentityAggregateVersion(MAX_IDENTITY_AGGREGATE_VERSION)),
    ).toThrow(IdentityAggregateVersionExhaustedError);
  });

  it('uses fixed safe errors for malformed and exhausted versions', (): void => {
    const rejectedValue = 'customer-version';

    expectFixedSafeError(
      () => parseIdentityAggregateVersion(rejectedValue),
      InvalidIdentityAggregateVersionError,
      rejectedValue,
    );

    const exhaustedError = captureError(() =>
      nextIdentityAggregateVersion(MAX_IDENTITY_AGGREGATE_VERSION as IdentityAggregateVersion),
    );
    expect(exhaustedError).toBeInstanceOf(IdentityAggregateVersionExhaustedError);
    expect((exhaustedError as { cause?: unknown }).cause).toBeUndefined();
  });
});

// Compile-time assertion: parsers return their branded domain types.
const _accountId: IdentityAccountId = parseIdentityAccountId(
  '01890f3a-8bcd-7def-8abc-0123456789ab',
);
void _accountId;
