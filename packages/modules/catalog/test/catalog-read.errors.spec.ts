import { CatalogReadPersistenceError, CatalogReadUnavailableError } from '../src';

describe('CatalogReadUnavailableError', (): void => {
  it('exposes a stable safe message while retaining the diagnostic cause', (): void => {
    const cause = new Error('driver details');
    const error = new CatalogReadUnavailableError(cause);

    expect(error).toMatchObject({
      cause,
      message: 'Catalog reads are temporarily unavailable',
      name: 'CatalogReadUnavailableError',
    });
    expect(error.message).not.toContain(cause.message);
  });
});

describe('CatalogReadPersistenceError', (): void => {
  it('exposes a stable safe message while retaining the diagnostic cause', (): void => {
    const cause = new Error('query and connection details');
    const error = new CatalogReadPersistenceError(cause);

    expect(error).toMatchObject({
      cause,
      message: 'Catalog read failed',
      name: 'CatalogReadPersistenceError',
    });
    expect(error.message).not.toContain(cause.message);
  });
});
