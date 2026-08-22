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
  InvalidIdentityInstantError,
  MAX_IDENTITY_AGGREGATE_VERSION,
  compareIdentityInstants,
  nextIdentityAggregateVersion,
  parseIdentityAggregateVersion,
  parseIdentityInstant,
  type IdentityAggregateVersion,
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
