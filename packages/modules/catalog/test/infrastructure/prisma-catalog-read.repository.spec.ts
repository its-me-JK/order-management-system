import { Prisma } from '@oms/database/prisma';

import {
  CatalogReadPersistenceError,
  CatalogReadUnavailableError,
  InvalidCatalogCursorTimestampError,
  parseCatalogCursorTimestamp,
  parseCatalogPageSize,
  parseCatalogSkuId,
  type CatalogSkuId,
} from '../../src';
import { BinaryUuidCodec, InvalidUuidV7Error } from '../../src/infrastructure/identifiers';
import {
  type CatalogPrismaReadClient,
  PrismaCatalogReadRepository,
} from '../../src/infrastructure/prisma/prisma-catalog-read.repository';

const SKU_ONE_ID = parseCatalogSkuId('01890f3a-8bcd-7def-8abc-0123456789ab');
const SKU_TWO_ID = parseCatalogSkuId('01890f3a-8bcd-7def-8abc-0123456789ac');
const SKU_THREE_ID = parseCatalogSkuId('01890f3a-8bcd-7def-8abc-0123456789ad');
const PRODUCT_ID = '01890f3a-8bcd-7def-9abc-0123456789ab';
const CREATED_AT_ONE = '2026-08-22T14:57:24.123456Z';
const CREATED_AT_TWO = '2026-08-22T14:57:24.123455Z';
const CREATED_AT_THREE = '2026-08-22T14:57:24.123454Z';
const PRISMA_CLIENT_VERSION = '7.9.1';

const uuidCodec = new BinaryUuidCodec();

type FindUniqueOperation = (args: unknown) => Promise<unknown>;
type QueryRawOperation = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;

type ClientFixture = Readonly<{
  client: CatalogPrismaReadClient;
  findUnique: jest.MockedFunction<FindUniqueOperation>;
  queryRaw: jest.MockedFunction<QueryRawOperation>;
}>;

type QueryInvocation = Readonly<{
  sql: string;
  values: readonly unknown[];
}>;

function clientFixture(): ClientFixture {
  const findUnique = jest.fn<ReturnType<FindUniqueOperation>, Parameters<FindUniqueOperation>>();
  const queryRaw = jest.fn<ReturnType<QueryRawOperation>, Parameters<QueryRawOperation>>();

  findUnique.mockResolvedValue(null);
  queryRaw.mockResolvedValue([]);

  return {
    client: {
      $queryRaw: queryRaw as CatalogPrismaReadClient['$queryRaw'],
      catalogSkuRecord: {
        findUnique:
          findUnique as unknown as CatalogPrismaReadClient['catalogSkuRecord']['findUnique'],
      },
    },
    findUnique,
    queryRaw,
  };
}

function lookupRecord(overrides: Readonly<Record<string, unknown>> = {}): unknown {
  return {
    code: 'MILK-1L',
    id: uuidCodec.toBytes(SKU_ONE_ID),
    name: 'Whole milk 1L',
    product: {
      id: uuidCodec.toBytes(PRODUCT_ID),
      name: 'Whole milk',
    },
    ...overrides,
  };
}

function listRow(
  skuId: string,
  createdAt: string,
  overrides: Readonly<Record<string, unknown>> = {},
): unknown {
  return {
    cursor_created_at: createdAt,
    product_id: uuidCodec.toBytes(PRODUCT_ID),
    product_name: 'Whole milk',
    sku_code: `MILK-${skuId.slice(-2).toUpperCase()}`,
    sku_id: uuidCodec.toBytes(skuId),
    sku_name: 'Whole milk 1L',
    ...overrides,
  };
}

function invocationAt(
  queryRaw: jest.MockedFunction<QueryRawOperation>,
  callIndex = 0,
): QueryInvocation {
  const invocation = queryRaw.mock.calls[callIndex];

  if (invocation === undefined) {
    throw new Error(`Expected raw query invocation ${String(callIndex)}`);
  }

  const [strings, ...values] = invocation;
  const sql = strings
    .reduce(
      (statement, segment, index): string =>
        `${statement}${segment}${index < values.length ? '?' : ''}`,
      '',
    )
    .replaceAll(/\s+/gu, ' ')
    .trim();

  return { sql, values };
}

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

function driverWrappedPrismaError(
  prismaCode: 'P2010' | 'P2039',
  overrides: Readonly<Record<string, unknown>> = {},
): InstanceType<typeof Prisma.PrismaClientKnownRequestError> {
  return knownPrismaError(prismaCode, {
    driverAdapterError: {
      cause: {
        code: 45028,
        kind: 'mysql',
        originalCode: '45028',
        state: 'HY000',
        ...overrides,
      },
    },
  });
}

describe('PrismaCatalogReadRepository.getPublicSkuById', (): void => {
  it('selects and maps one active SKU whose Product is active', async (): Promise<void> => {
    const fixture = clientFixture();
    fixture.findUnique.mockResolvedValue(lookupRecord());
    const repository = new PrismaCatalogReadRepository(fixture.client);

    await expect(repository.getPublicSkuById({ skuId: SKU_ONE_ID })).resolves.toEqual({
      kind: 'found',
      sku: {
        code: 'MILK-1L',
        id: SKU_ONE_ID,
        name: 'Whole milk 1L',
        product: {
          id: PRODUCT_ID,
          name: 'Whole milk',
        },
      },
    });

    expect(fixture.findUnique).toHaveBeenCalledTimes(1);
    expect(fixture.findUnique).toHaveBeenCalledWith({
      select: {
        code: true,
        id: true,
        name: true,
        product: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      where: {
        id: uuidCodec.toBytes(SKU_ONE_ID),
        product: {
          is: {
            status: 'ACTIVE',
          },
        },
        status: 'ACTIVE',
      },
    });
    expect(fixture.queryRaw).not.toHaveBeenCalled();
  });

  it('returns the same not-found result for every record hidden by the visibility query', async (): Promise<void> => {
    const fixture = clientFixture();
    fixture.findUnique.mockResolvedValue(null);
    const repository = new PrismaCatalogReadRepository(fixture.client);

    await expect(repository.getPublicSkuById({ skuId: SKU_ONE_ID })).resolves.toEqual({
      kind: 'not-found',
    });
  });

  it('rejects an invalid query UUID before calling persistence', async (): Promise<void> => {
    const fixture = clientFixture();
    const repository = new PrismaCatalogReadRepository(fixture.client);

    await expect(
      repository.getPublicSkuById({ skuId: 'not-a-uuid' as CatalogSkuId }),
    ).rejects.toBeInstanceOf(InvalidUuidV7Error);
    expect(fixture.findUnique).not.toHaveBeenCalled();
    expect(fixture.queryRaw).not.toHaveBeenCalled();
  });

  it.each([
    ['undefined record', undefined],
    ['nonbinary SKU id', lookupRecord({ id: SKU_ONE_ID })],
    ['invalid SKU UUIDv7 bytes', lookupRecord({ id: new Uint8Array(16) })],
    ['nonscalar SKU code', lookupRecord({ code: 123 })],
    ['missing Product projection', lookupRecord({ product: null })],
    [
      'invalid Product projection',
      lookupRecord({ product: { id: uuidCodec.toBytes(PRODUCT_ID), name: null } }),
    ],
  ])('wraps an invalid %s as a safe persistence failure', async (_label, record): Promise<void> => {
    const fixture = clientFixture();
    fixture.findUnique.mockResolvedValue(record);
    const repository = new PrismaCatalogReadRepository(fixture.client);

    await expect(repository.getPublicSkuById({ skuId: SKU_ONE_ID })).rejects.toMatchObject({
      message: 'Catalog read failed',
      name: 'CatalogReadPersistenceError',
    });
  });

  it.each(['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2037'])(
    'translates recognized Prisma error %s to read-unavailable',
    async (code): Promise<void> => {
      const fixture = clientFixture();
      const cause = knownPrismaError(code);
      fixture.findUnique.mockRejectedValue(cause);
      const repository = new PrismaCatalogReadRepository(fixture.client);

      await expect(repository.getPublicSkuById({ skuId: SKU_ONE_ID })).rejects.toMatchObject({
        cause,
        message: 'Catalog reads are temporarily unavailable',
        name: 'CatalogReadUnavailableError',
      });
    },
  );

  it('translates a recognized Prisma initialization error to read-unavailable', async (): Promise<void> => {
    const fixture = clientFixture();
    const cause = new Prisma.PrismaClientInitializationError(
      'database vendor details',
      PRISMA_CLIENT_VERSION,
      'P1001',
    );
    fixture.findUnique.mockRejectedValue(cause);
    const repository = new PrismaCatalogReadRepository(fixture.client);

    await expect(repository.getPublicSkuById({ skuId: SKU_ONE_ID })).rejects.toEqual(
      new CatalogReadUnavailableError(cause),
    );
  });

  it('translates a P2039-wrapped MySQL connection failure to read-unavailable', async (): Promise<void> => {
    const fixture = clientFixture();
    const cause = driverWrappedPrismaError('P2039', { code: 45009, originalCode: '45009' });
    fixture.findUnique.mockRejectedValue(cause);
    const repository = new PrismaCatalogReadRepository(fixture.client);

    await expect(repository.getPublicSkuById({ skuId: SKU_ONE_ID })).rejects.toEqual(
      new CatalogReadUnavailableError(cause),
    );
  });

  it.each([
    ['nontransient known Prisma failure', knownPrismaError('P2010')],
    [
      'unknown Prisma failure',
      new Prisma.PrismaClientUnknownRequestError('database vendor details', {
        clientVersion: PRISMA_CLIENT_VERSION,
      }),
    ],
    ['ordinary unexpected failure', new Error('unexpected driver failure')],
    ['forged transient code', { code: 'P2024' }],
    [
      'lookalike transient Prisma Error',
      Object.assign(new Error('lookalike'), {
        clientVersion: PRISMA_CLIENT_VERSION,
        code: 'P2024',
        name: 'PrismaClientKnownRequestError',
      }),
    ],
  ])('wraps a %s as a safe persistence failure', async (_label, cause): Promise<void> => {
    const fixture = clientFixture();
    fixture.findUnique.mockRejectedValue(cause);
    const repository = new PrismaCatalogReadRepository(fixture.client);

    await expect(repository.getPublicSkuById({ skuId: SKU_ONE_ID })).rejects.toEqual(
      new CatalogReadPersistenceError(cause),
    );
  });
});

describe('PrismaCatalogReadRepository.listPublicSkus', (): void => {
  it('uses one explicit active-only join query and returns an empty page', async (): Promise<void> => {
    const fixture = clientFixture();
    const repository = new PrismaCatalogReadRepository(fixture.client);

    await expect(
      repository.listPublicSkus({ after: null, limit: parseCatalogPageSize(2) }),
    ).resolves.toEqual({
      items: [],
      pageInfo: { nextCursor: null },
    });

    const invocation = invocationAt(fixture.queryRaw);

    expect(invocation.sql).toBe(
      "SELECT s.id AS sku_id, s.code AS sku_code, s.name AS sku_name, p.id AS product_id, p.name AS product_name, DATE_FORMAT(s.created_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS cursor_created_at FROM catalog_skus AS s INNER JOIN catalog_products AS p ON p.id = s.product_id WHERE s.status = ? AND p.status = ? ORDER BY s.created_at DESC, s.id DESC LIMIT ?",
    );
    expect(invocation.sql).not.toContain('SELECT *');
    expect(invocation.values).toEqual(['ACTIVE', 'ACTIVE', 3]);
    expect(fixture.queryRaw).toHaveBeenCalledTimes(1);
    expect(fixture.findUnique).not.toHaveBeenCalled();
  });

  it('maps a page without exposing persistence cursor metadata', async (): Promise<void> => {
    const fixture = clientFixture();
    fixture.queryRaw.mockResolvedValue([listRow(SKU_ONE_ID, CREATED_AT_ONE)]);
    const repository = new PrismaCatalogReadRepository(fixture.client);

    await expect(
      repository.listPublicSkus({ after: null, limit: parseCatalogPageSize(2) }),
    ).resolves.toEqual({
      items: [
        {
          code: 'MILK-AB',
          id: SKU_ONE_ID,
          name: 'Whole milk 1L',
          product: {
            id: PRODUCT_ID,
            name: 'Whole milk',
          },
        },
      ],
      pageInfo: { nextCursor: null },
    });
  });

  it('uses limit plus one and builds the next cursor from the final visible row', async (): Promise<void> => {
    const fixture = clientFixture();
    fixture.queryRaw.mockResolvedValue([
      listRow(SKU_ONE_ID, CREATED_AT_ONE),
      listRow(SKU_TWO_ID, CREATED_AT_TWO),
      listRow(SKU_THREE_ID, CREATED_AT_THREE),
    ]);
    const repository = new PrismaCatalogReadRepository(fixture.client);

    const page = await repository.listPublicSkus({
      after: null,
      limit: parseCatalogPageSize(2),
    });

    expect(page.items.map(({ id }): string => id)).toEqual([SKU_ONE_ID, SKU_TWO_ID]);
    expect(page.pageInfo).toEqual({
      nextCursor: {
        createdAt: CREATED_AT_TWO,
        id: SKU_TWO_ID,
      },
    });
    expect(invocationAt(fixture.queryRaw).values).toEqual(['ACTIVE', 'ACTIVE', 3]);
  });

  it('uses an exact DATETIME(6) seek and binary id tie-breaker for an exclusive cursor', async (): Promise<void> => {
    const fixture = clientFixture();
    const repository = new PrismaCatalogReadRepository(fixture.client);

    await repository.listPublicSkus({
      after: {
        createdAt: parseCatalogCursorTimestamp(CREATED_AT_ONE),
        id: SKU_ONE_ID,
      },
      limit: parseCatalogPageSize(2),
    });

    const invocation = invocationAt(fixture.queryRaw);

    expect(invocation.sql).toBe(
      "SELECT s.id AS sku_id, s.code AS sku_code, s.name AS sku_name, p.id AS product_id, p.name AS product_name, DATE_FORMAT(s.created_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS cursor_created_at FROM catalog_skus AS s INNER JOIN catalog_products AS p ON p.id = s.product_id WHERE s.status = ? AND p.status = ? AND ( s.created_at < CAST(? AS DATETIME(6)) OR ( s.created_at = CAST(? AS DATETIME(6)) AND s.id < ? ) ) ORDER BY s.created_at DESC, s.id DESC LIMIT ?",
    );
    expect(invocation.values).toEqual([
      'ACTIVE',
      'ACTIVE',
      '2026-08-22 14:57:24.123456',
      '2026-08-22 14:57:24.123456',
      uuidCodec.toBytes(SKU_ONE_ID),
      3,
    ]);
    expect(invocation.values).not.toContainEqual(expect.any(Date));
  });

  it('rejects an invalid cursor timestamp before calling persistence', async (): Promise<void> => {
    const fixture = clientFixture();
    const repository = new PrismaCatalogReadRepository(fixture.client);
    const invalidTimestamp = '2026-08-22T14:57:24.123Z' as ReturnType<
      typeof parseCatalogCursorTimestamp
    >;

    await expect(
      repository.listPublicSkus({
        after: { createdAt: invalidTimestamp, id: SKU_ONE_ID },
        limit: parseCatalogPageSize(2),
      }),
    ).rejects.toBeInstanceOf(InvalidCatalogCursorTimestampError);
    expect(fixture.queryRaw).not.toHaveBeenCalled();
    expect(fixture.findUnique).not.toHaveBeenCalled();
  });

  it('rejects an invalid cursor UUID before calling persistence', async (): Promise<void> => {
    const fixture = clientFixture();
    const repository = new PrismaCatalogReadRepository(fixture.client);

    await expect(
      repository.listPublicSkus({
        after: {
          createdAt: parseCatalogCursorTimestamp(CREATED_AT_ONE),
          id: 'not-a-uuid' as CatalogSkuId,
        },
        limit: parseCatalogPageSize(2),
      }),
    ).rejects.toBeInstanceOf(InvalidUuidV7Error);
    expect(fixture.queryRaw).not.toHaveBeenCalled();
    expect(fixture.findUnique).not.toHaveBeenCalled();
  });

  it('preserves distinct microseconds within one JavaScript millisecond across pages', async (): Promise<void> => {
    const fixture = clientFixture();
    fixture.queryRaw
      .mockResolvedValueOnce([
        listRow(SKU_ONE_ID, CREATED_AT_ONE),
        listRow(SKU_TWO_ID, CREATED_AT_TWO),
      ])
      .mockResolvedValueOnce([listRow(SKU_TWO_ID, CREATED_AT_TWO)]);
    const repository = new PrismaCatalogReadRepository(fixture.client);

    const firstPage = await repository.listPublicSkus({
      after: null,
      limit: parseCatalogPageSize(1),
    });
    const firstCursor = firstPage.pageInfo.nextCursor;

    expect(firstCursor).toEqual({ createdAt: CREATED_AT_ONE, id: SKU_ONE_ID });
    expect(firstCursor).not.toBeNull();

    if (firstCursor === null) {
      throw new Error('Expected a next cursor');
    }

    const secondPage = await repository.listPublicSkus({
      after: firstCursor,
      limit: parseCatalogPageSize(1),
    });
    const secondInvocation = invocationAt(fixture.queryRaw, 1);

    expect(secondPage.items.map(({ id }): string => id)).toEqual([SKU_TWO_ID]);
    expect(secondInvocation.values).toEqual([
      'ACTIVE',
      'ACTIVE',
      '2026-08-22 14:57:24.123456',
      '2026-08-22 14:57:24.123456',
      uuidCodec.toBytes(SKU_ONE_ID),
      2,
    ]);
  });

  it.each([
    ['non-array result', {}],
    ['nonrecord row', [null]],
    [
      'missing cursor timestamp',
      [listRow(SKU_ONE_ID, CREATED_AT_ONE, { cursor_created_at: null })],
    ],
    [
      'truncated cursor timestamp',
      [listRow(SKU_ONE_ID, CREATED_AT_ONE, { cursor_created_at: '2026-08-22T14:57:24.123Z' })],
    ],
    ['nonbinary SKU id', [listRow(SKU_ONE_ID, CREATED_AT_ONE, { sku_id: SKU_ONE_ID })]],
    [
      'invalid Product UUID',
      [listRow(SKU_ONE_ID, CREATED_AT_ONE, { product_id: new Uint8Array(16) })],
    ],
    ['nonscalar field', [listRow(SKU_ONE_ID, CREATED_AT_ONE, { sku_name: 10 })]],
  ])('wraps an invalid %s as a safe persistence failure', async (_label, result): Promise<void> => {
    const fixture = clientFixture();
    fixture.queryRaw.mockResolvedValue(result);
    const repository = new PrismaCatalogReadRepository(fixture.client);

    await expect(
      repository.listPublicSkus({ after: null, limit: parseCatalogPageSize(2) }),
    ).rejects.toMatchObject({
      message: 'Catalog read failed',
      name: 'CatalogReadPersistenceError',
    });
  });

  it('validates the lookahead row even though it is not returned', async (): Promise<void> => {
    const fixture = clientFixture();
    fixture.queryRaw.mockResolvedValue([
      listRow(SKU_ONE_ID, CREATED_AT_ONE),
      listRow(SKU_TWO_ID, CREATED_AT_TWO, { product_id: null }),
    ]);
    const repository = new PrismaCatalogReadRepository(fixture.client);

    await expect(
      repository.listPublicSkus({ after: null, limit: parseCatalogPageSize(1) }),
    ).rejects.toBeInstanceOf(CatalogReadPersistenceError);
  });

  it('translates a recognized raw-query timeout to read-unavailable', async (): Promise<void> => {
    const fixture = clientFixture();
    const cause = knownPrismaError('P2024');
    fixture.queryRaw.mockRejectedValue(cause);
    const repository = new PrismaCatalogReadRepository(fixture.client);

    await expect(
      repository.listPublicSkus({ after: null, limit: parseCatalogPageSize(2) }),
    ).rejects.toEqual(new CatalogReadUnavailableError(cause));
  });

  it('translates a P2010-wrapped MySQL socket timeout to read-unavailable', async (): Promise<void> => {
    const fixture = clientFixture();
    const cause = driverWrappedPrismaError('P2010', { code: 45026, originalCode: '45026' });
    fixture.queryRaw.mockRejectedValue(cause);
    const repository = new PrismaCatalogReadRepository(fixture.client);

    await expect(
      repository.listPublicSkus({ after: null, limit: parseCatalogPageSize(2) }),
    ).rejects.toEqual(new CatalogReadUnavailableError(cause));
  });

  it('does not classify a structured P2010 SQL syntax failure as unavailable', async (): Promise<void> => {
    const fixture = clientFixture();
    const cause = driverWrappedPrismaError('P2010', {
      code: 1064,
      originalCode: '1064',
      state: '42000',
    });
    fixture.queryRaw.mockRejectedValue(cause);
    const repository = new PrismaCatalogReadRepository(fixture.client);

    await expect(
      repository.listPublicSkus({ after: null, limit: parseCatalogPageSize(2) }),
    ).rejects.toEqual(new CatalogReadPersistenceError(cause));
  });

  it('wraps an unrecognized raw-query failure without leaking it', async (): Promise<void> => {
    const fixture = clientFixture();
    const cause = knownPrismaError('P2010');
    fixture.queryRaw.mockRejectedValue(cause);
    const repository = new PrismaCatalogReadRepository(fixture.client);

    await expect(
      repository.listPublicSkus({ after: null, limit: parseCatalogPageSize(2) }),
    ).rejects.toEqual(new CatalogReadPersistenceError(cause));
  });
});
