import {
  CatalogReadPersistenceError,
  CatalogReadUnavailableError,
  DEFAULT_CATALOG_PAGE_SIZE,
  GetPublicSku,
  InvalidCatalogCursorTimestampError,
  InvalidCatalogPageSizeError,
  InvalidCatalogSkuIdError,
  ListPublicSkus,
  parseCatalogCursorTimestamp,
  parseCatalogPageSize,
  parseCatalogSkuId,
  type CatalogReadRepository,
  type GetPublicSkuByIdResult,
  type PublicSkuPage,
} from '../src';

const SKU_ID = '01890f3a-8bcd-7def-8abc-0123456789ab';
const PRODUCT_ID = '01890f3a-8bcd-7def-9abc-0123456789ab';
const CREATED_AT = '2026-08-22T12:34:56.123456Z';

const HOSTILE_NON_ERROR_REJECTION = Object.freeze({
  toJSON(): never {
    throw new Error('The use case must not serialize a repository rejection');
  },
  toString(): never {
    throw new Error('The use case must not coerce a repository rejection');
  },
});

const REPOSITORY_REJECTION_CASES = [
  {
    label: 'CatalogReadUnavailableError',
    reason: new CatalogReadUnavailableError(new Error('database unavailable')),
  },
  {
    label: 'CatalogReadPersistenceError',
    reason: new CatalogReadPersistenceError(new Error('unexpected persistence failure')),
  },
  { label: 'generic Error', reason: new Error('repository-owned failure') },
  { label: 'hostile non-Error value', reason: HOSTILE_NON_ERROR_REJECTION },
] as const;

type RepositoryFixture = Readonly<{
  getPublicSkuById: jest.MockedFunction<CatalogReadRepository['getPublicSkuById']>;
  listPublicSkus: jest.MockedFunction<CatalogReadRepository['listPublicSkus']>;
  repository: CatalogReadRepository;
}>;

function repositoryFixture(): RepositoryFixture {
  const getPublicSkuById = jest.fn<
    ReturnType<CatalogReadRepository['getPublicSkuById']>,
    Parameters<CatalogReadRepository['getPublicSkuById']>
  >();
  const listPublicSkus = jest.fn<
    ReturnType<CatalogReadRepository['listPublicSkus']>,
    Parameters<CatalogReadRepository['listPublicSkus']>
  >();

  return {
    getPublicSkuById,
    listPublicSkus,
    repository: { getPublicSkuById, listPublicSkus },
  };
}

function foundSkuResult(): GetPublicSkuByIdResult {
  return {
    kind: 'found',
    sku: {
      code: 'MILK-1L',
      id: SKU_ID,
      name: 'Whole milk 1L',
      product: {
        id: PRODUCT_ID,
        name: 'Whole milk',
      },
    },
  };
}

function publicSkuPage(): PublicSkuPage {
  const result = foundSkuResult();

  if (result.kind !== 'found') {
    throw new Error('Expected the test SKU fixture to be found');
  }

  return {
    items: [result.sku],
    pageInfo: { nextCursor: null },
  };
}

describe('GetPublicSku', (): void => {
  it.each([foundSkuResult(), { kind: 'not-found' } as const])(
    'passes through the repository result for $kind',
    async (result): Promise<void> => {
      const fixture = repositoryFixture();
      fixture.getPublicSkuById.mockResolvedValue(result);
      const useCase = new GetPublicSku(fixture.repository);

      await expect(useCase.execute({ skuId: SKU_ID })).resolves.toBe(result);
      expect(fixture.getPublicSkuById).toHaveBeenCalledTimes(1);
      expect(fixture.getPublicSkuById).toHaveBeenCalledWith({
        skuId: parseCatalogSkuId(SKU_ID),
      });
      expect(fixture.listPublicSkus).not.toHaveBeenCalled();
    },
  );

  it.each(REPOSITORY_REJECTION_CASES)(
    'passes through the same $label rejection',
    async ({ reason }): Promise<void> => {
      const fixture = repositoryFixture();
      fixture.getPublicSkuById.mockRejectedValue(reason);
      const useCase = new GetPublicSku(fixture.repository);

      await expect(useCase.execute({ skuId: SKU_ID })).rejects.toBe(reason);
      expect(fixture.getPublicSkuById).toHaveBeenCalledTimes(1);
      expect(fixture.listPublicSkus).not.toHaveBeenCalled();
    },
  );

  it.each([
    'not-a-uuid',
    '01890F3A-8BCD-7DEF-8ABC-0123456789AB',
    '01890f3a-8bcd-4def-8abc-0123456789ab',
  ])('rejects an invalid SKU id without invoking the repository: %s', async (skuId) => {
    const fixture = repositoryFixture();
    const useCase = new GetPublicSku(fixture.repository);

    await expect(useCase.execute({ skuId })).rejects.toBeInstanceOf(InvalidCatalogSkuIdError);
    expect(fixture.getPublicSkuById).not.toHaveBeenCalled();
    expect(fixture.listPublicSkus).not.toHaveBeenCalled();
  });
});

describe('ListPublicSkus', (): void => {
  it.each([undefined, {}, { after: null }])(
    'applies the default bounded query for input %p',
    async (input): Promise<void> => {
      const fixture = repositoryFixture();
      const result = publicSkuPage();
      fixture.listPublicSkus.mockResolvedValue(result);
      const useCase = new ListPublicSkus(fixture.repository);

      await expect(useCase.execute(input)).resolves.toBe(result);
      expect(fixture.listPublicSkus).toHaveBeenCalledTimes(1);
      expect(fixture.listPublicSkus).toHaveBeenCalledWith({
        after: null,
        limit: DEFAULT_CATALOG_PAGE_SIZE,
      });
      expect(fixture.getPublicSkuById).not.toHaveBeenCalled();
    },
  );

  it.each([1, 20, 100])(
    'passes an explicitly validated page-size boundary: %d',
    async (limit): Promise<void> => {
      const fixture = repositoryFixture();
      const result = publicSkuPage();
      fixture.listPublicSkus.mockResolvedValue(result);
      const useCase = new ListPublicSkus(fixture.repository);

      await expect(useCase.execute({ limit })).resolves.toBe(result);
      expect(fixture.listPublicSkus).toHaveBeenCalledWith({
        after: null,
        limit: parseCatalogPageSize(limit),
      });
    },
  );

  it('validates a decoded cursor before passing it to the repository', async (): Promise<void> => {
    const fixture = repositoryFixture();
    const result = publicSkuPage();
    fixture.listPublicSkus.mockResolvedValue(result);
    const useCase = new ListPublicSkus(fixture.repository);

    await expect(
      useCase.execute({
        after: { createdAt: CREATED_AT, id: SKU_ID },
        limit: 1,
      }),
    ).resolves.toBe(result);
    expect(fixture.listPublicSkus).toHaveBeenCalledWith({
      after: {
        createdAt: parseCatalogCursorTimestamp(CREATED_AT),
        id: parseCatalogSkuId(SKU_ID),
      },
      limit: parseCatalogPageSize(1),
    });
  });

  it.each(REPOSITORY_REJECTION_CASES)(
    'passes through the same $label rejection',
    async ({ reason }): Promise<void> => {
      const fixture = repositoryFixture();
      fixture.listPublicSkus.mockRejectedValue(reason);
      const useCase = new ListPublicSkus(fixture.repository);

      await expect(useCase.execute()).rejects.toBe(reason);
      expect(fixture.listPublicSkus).toHaveBeenCalledTimes(1);
      expect(fixture.getPublicSkuById).not.toHaveBeenCalled();
    },
  );

  it.each([0, -1, 101, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid page size %p without invoking the repository',
    async (limit): Promise<void> => {
      const fixture = repositoryFixture();
      const useCase = new ListPublicSkus(fixture.repository);

      await expect(useCase.execute({ limit })).rejects.toBeInstanceOf(InvalidCatalogPageSizeError);
      expect(fixture.listPublicSkus).not.toHaveBeenCalled();
      expect(fixture.getPublicSkuById).not.toHaveBeenCalled();
    },
  );

  it('rejects an invalid cursor timestamp without invoking the repository', async (): Promise<void> => {
    const fixture = repositoryFixture();
    const useCase = new ListPublicSkus(fixture.repository);

    await expect(
      useCase.execute({
        after: { createdAt: '2026-08-22T12:34:56.123Z', id: SKU_ID },
      }),
    ).rejects.toBeInstanceOf(InvalidCatalogCursorTimestampError);
    expect(fixture.listPublicSkus).not.toHaveBeenCalled();
    expect(fixture.getPublicSkuById).not.toHaveBeenCalled();
  });

  it('rejects an invalid cursor SKU id without invoking the repository', async (): Promise<void> => {
    const fixture = repositoryFixture();
    const useCase = new ListPublicSkus(fixture.repository);

    await expect(
      useCase.execute({
        after: { createdAt: CREATED_AT, id: 'not-a-uuid' },
      }),
    ).rejects.toBeInstanceOf(InvalidCatalogSkuIdError);
    expect(fixture.listPublicSkus).not.toHaveBeenCalled();
    expect(fixture.getPublicSkuById).not.toHaveBeenCalled();
  });
});
