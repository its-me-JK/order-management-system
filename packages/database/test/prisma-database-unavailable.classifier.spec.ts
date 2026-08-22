import { isPrismaDatabaseUnavailableError, Prisma } from '@oms/database/prisma';

const PRISMA_CLIENT_VERSION = '7.9.1';
const TOP_LEVEL_UNAVAILABLE_CODES = ['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2037'];
const TRANSIENT_DRIVER_CODES = [45001, 45009, 45012, 45013, 45019, 45026, 45028, 45039, 45042];

function knownPrismaError(
  code: string,
  meta?: Readonly<Record<string, unknown>>,
): InstanceType<typeof Prisma.PrismaClientKnownRequestError> {
  return new Prisma.PrismaClientKnownRequestError('database vendor details', {
    clientVersion: PRISMA_CLIENT_VERSION,
    code,
    ...(meta === undefined ? {} : { meta }),
  });
}

function driverWrappedError(
  prismaCode: 'P2010' | 'P2039',
  cause: unknown,
): InstanceType<typeof Prisma.PrismaClientKnownRequestError> {
  return knownPrismaError(prismaCode, {
    driverAdapterError: {
      cause,
    },
  });
}

function mySqlCause(
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    code: 1064,
    kind: 'mysql',
    originalCode: '1064',
    state: '42000',
    ...overrides,
  };
}

describe('isPrismaDatabaseUnavailableError', (): void => {
  it.each(TOP_LEVEL_UNAVAILABLE_CODES)('accepts nominal top-level Prisma code %s', (code): void => {
    expect(isPrismaDatabaseUnavailableError(knownPrismaError(code))).toBe(true);
  });

  it.each(TOP_LEVEL_UNAVAILABLE_CODES)(
    'accepts nominal Prisma initialization code %s',
    (code): void => {
      const error = new Prisma.PrismaClientInitializationError(
        'database vendor details',
        PRISMA_CLIENT_VERSION,
        code,
      );

      expect(isPrismaDatabaseUnavailableError(error)).toBe(true);
    },
  );

  it.each(TRANSIENT_DRIVER_CODES)(
    'accepts pinned MariaDB driver code %i through P2010',
    (code): void => {
      expect(
        isPrismaDatabaseUnavailableError(
          driverWrappedError('P2010', mySqlCause({ code, originalCode: String(code) })),
        ),
      ).toBe(true);
    },
  );

  it.each(TRANSIENT_DRIVER_CODES)(
    'accepts pinned MariaDB driver code %i through P2039',
    (code): void => {
      expect(
        isPrismaDatabaseUnavailableError(
          driverWrappedError('P2039', mySqlCause({ code, originalCode: String(code) })),
        ),
      ).toBe(true);
    },
  );

  it.each(TRANSIENT_DRIVER_CODES)(
    'accepts canonical originalCode fallback %i when numeric code is absent',
    (code): void => {
      const cause = mySqlCause({ code: undefined, originalCode: String(code) });

      expect(isPrismaDatabaseUnavailableError(driverWrappedError('P2010', cause))).toBe(true);
    },
  );

  it.each(['08000', '08001', '08003', '08004', '08006', '08007', '08S01'])(
    'accepts MySQL connection SQLSTATE %s',
    (state): void => {
      const error = driverWrappedError('P2039', mySqlCause({ code: 99999, state }));

      expect(isPrismaDatabaseUnavailableError(error)).toBe(true);
    },
  );

  it.each([
    ['raw SQL syntax failure', driverWrappedError('P2010', mySqlCause())],
    [
      'raw check-constraint failure',
      driverWrappedError('P2010', mySqlCause({ code: 3819, originalCode: '3819', state: 'HY000' })),
    ],
    ['generic nontransient driver failure', driverWrappedError('P2039', mySqlCause())],
    [
      'non-wrapper Prisma code carrying transient driver metadata',
      knownPrismaError('P2002', {
        driverAdapterError: {
          cause: mySqlCause({ code: 45028, originalCode: '45028' }),
        },
      }),
    ],
    [
      'missing initialization code',
      new Prisma.PrismaClientInitializationError('failure', PRISMA_CLIENT_VERSION),
    ],
    [
      'unknown Prisma error',
      new Prisma.PrismaClientUnknownRequestError('failure', {
        clientVersion: PRISMA_CLIENT_VERSION,
      }),
    ],
    ['ordinary Error', new Error('P1001 cannot reach database')],
    ['plain object', { code: 'P1001' }],
    [
      'lookalike nominal Error',
      Object.assign(new Error('lookalike'), {
        clientVersion: PRISMA_CLIENT_VERSION,
        code: 'P1001',
        name: 'PrismaClientKnownRequestError',
      }),
    ],
  ])('rejects %s', (_label, error): void => {
    expect(isPrismaDatabaseUnavailableError(error)).toBe(false);
  });

  it.each([45027, 45035, 45037])('rejects local pool lifecycle failure %i', (code): void => {
    const error = driverWrappedError(
      'P2039',
      mySqlCause({ code, originalCode: String(code), state: 'HY000' }),
    );

    expect(isPrismaDatabaseUnavailableError(error)).toBe(false);
  });

  it.each([
    ['missing meta', knownPrismaError('P2010')],
    ['null adapter error', knownPrismaError('P2010', { driverAdapterError: null })],
    [
      'missing adapter cause',
      knownPrismaError('P2010', { driverAdapterError: { name: 'DriverAdapterError' } }),
    ],
    ['nonrecord adapter cause', driverWrappedError('P2010', 'connection')],
    [
      'wrong driver kind',
      driverWrappedError('P2010', { kind: 'postgres', code: 45028, state: '08006' }),
    ],
    ['string primary code', driverWrappedError('P2010', mySqlCause({ code: '45028' }))],
    [
      'conflicting numeric primary code',
      driverWrappedError('P2010', mySqlCause({ code: 1064, originalCode: '45028' })),
    ],
    [
      'leading-zero original code',
      driverWrappedError('P2010', mySqlCause({ code: undefined, originalCode: '045028' })),
    ],
    [
      'signed original code',
      driverWrappedError('P2010', mySqlCause({ code: undefined, originalCode: '+45028' })),
    ],
    [
      'decimal original code',
      driverWrappedError('P2010', mySqlCause({ code: undefined, originalCode: '45028.0' })),
    ],
    [
      'spaced original code',
      driverWrappedError('P2010', mySqlCause({ code: undefined, originalCode: ' 45028 ' })),
    ],
    [
      'exponent original code',
      driverWrappedError('P2010', mySqlCause({ code: undefined, originalCode: '4.5028e4' })),
    ],
    [
      'numeric original code',
      driverWrappedError('P2010', mySqlCause({ code: undefined, originalCode: 45028 })),
    ],
    [
      'null primary code',
      driverWrappedError('P2010', mySqlCause({ code: null, originalCode: '45028' })),
    ],
    ['nonstring SQLSTATE', driverWrappedError('P2010', mySqlCause({ state: 8006 }))],
    ['short SQLSTATE', driverWrappedError('P2010', mySqlCause({ state: '08' }))],
    ['lowercase SQLSTATE', driverWrappedError('P2010', mySqlCause({ state: '08s01' }))],
    ['extended SQLSTATE', driverWrappedError('P2010', mySqlCause({ state: '080001' }))],
  ])('rejects malformed metadata: %s', (_label, error): void => {
    expect(isPrismaDatabaseUnavailableError(error)).toBe(false);
  });

  it('does not match driver error messages', (): void => {
    const error = driverWrappedError(
      'P2010',
      mySqlCause({ code: 1064, message: 'ECONNREFUSED connection timeout SQLSTATE 08006' }),
    );

    expect(isPrismaDatabaseUnavailableError(error)).toBe(false);
  });

  it('returns false instead of throwing for hostile metadata accessors', (): void => {
    const cause = Object.defineProperty({}, 'kind', {
      get: (): never => {
        throw new Error('hostile getter');
      },
    });

    expect(isPrismaDatabaseUnavailableError(driverWrappedError('P2010', cause))).toBe(false);
  });
});
