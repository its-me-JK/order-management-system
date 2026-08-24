import type { DatabaseDriver } from '../src/client/database.driver';
import { ManagedDatabaseConnection } from '../src/database.connection';

function deferred(): {
  readonly promise: Promise<void>;
  readonly reject: (reason: unknown) => void;
  readonly resolve: () => void;
} {
  let rejectPromise: (reason: unknown) => void = (): void => undefined;
  let resolvePromise: () => void = (): void => undefined;
  const promise = new Promise<void>((resolve, reject): void => {
    rejectPromise = reject;
    resolvePromise = resolve;
  });

  return {
    promise,
    reject: rejectPromise,
    resolve: resolvePromise,
  };
}

function databaseDriver(overrides: Partial<DatabaseDriver> = {}): DatabaseDriver {
  return {
    close: jest.fn((): Promise<void> => Promise.resolve()),
    probe: jest.fn((): Promise<void> => Promise.resolve()),
    ...overrides,
  };
}

describe('ManagedDatabaseConnection', (): void => {
  it('delegates a connectivity probe to the database driver', async (): Promise<void> => {
    const probe = jest.fn((): Promise<void> => Promise.resolve());
    const driver = databaseDriver({ probe });
    const database = new ManagedDatabaseConnection(driver);

    await expect(database.probe()).resolves.toBeUndefined();
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight probe between concurrent callers', async (): Promise<void> => {
    const pendingProbe = deferred();
    const probe = jest.fn((): Promise<void> => pendingProbe.promise);
    const driver = databaseDriver({ probe });
    const database = new ManagedDatabaseConnection(driver);

    const firstProbe = database.probe();
    const secondProbe = database.probe();

    expect(probe).not.toHaveBeenCalled();

    await Promise.resolve();
    expect(probe).toHaveBeenCalledTimes(1);

    pendingProbe.resolve();
    await expect(Promise.all([firstProbe, secondProbe])).resolves.toEqual([undefined, undefined]);
  });

  it('bounds callers while retaining one underlying probe and forces bounded shutdown', async (): Promise<void> => {
    jest.useFakeTimers();

    try {
      const pendingProbe = deferred();
      const probe = jest.fn((): Promise<void> => pendingProbe.promise);
      const close = jest.fn((): Promise<void> => Promise.resolve());
      const database = new ManagedDatabaseConnection(databaseDriver({ close, probe }), 1_000);

      const firstProbe = database.probe();
      const firstProbeResult = expect(firstProbe).rejects.toThrow('Database probe timed out');

      await Promise.resolve();
      expect(probe).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(1_000);
      await firstProbeResult;

      const secondProbe = database.probe();
      const secondProbeResult = expect(secondProbe).rejects.toThrow('Database probe timed out');

      await jest.advanceTimersByTimeAsync(1_000);
      await secondProbeResult;
      expect(probe).toHaveBeenCalledTimes(1);

      const closeOperation = database.close();

      expect(close).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1_000);
      await expect(closeOperation).resolves.toBeUndefined();
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('allows a new probe after the active operation settles', async (): Promise<void> => {
    const probe = jest.fn((): Promise<void> => Promise.resolve());
    const driver = databaseDriver({ probe });
    const database = new ManagedDatabaseConnection(driver);

    await database.probe();
    await database.probe();

    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('propagates probe failures without replacing their diagnostic cause', async (): Promise<void> => {
    const failure = new Error('driver unavailable');
    const probe = jest.fn((): Promise<void> => Promise.reject(failure));
    const driver = databaseDriver({ probe });
    const database = new ManagedDatabaseConnection(driver);

    await expect(database.probe()).rejects.toBe(failure);
  });

  it('closes the driver exactly once', async (): Promise<void> => {
    const close = jest.fn((): Promise<void> => Promise.resolve());
    const driver = databaseDriver({ close });
    const database = new ManagedDatabaseConnection(driver);

    const firstClose = database.close();
    const secondClose = database.close();

    expect(firstClose).toBe(secondClose);
    await expect(Promise.all([firstClose, secondClose])).resolves.toEqual([undefined, undefined]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('waits for an active probe to settle before closing the driver', async (): Promise<void> => {
    const pendingProbe = deferred();
    const probe = jest.fn((): Promise<void> => pendingProbe.promise);
    const close = jest.fn((): Promise<void> => Promise.resolve());
    const database = new ManagedDatabaseConnection(databaseDriver({ close, probe }));

    const probeOperation = database.probe();
    const closeOperation = database.close();

    await Promise.resolve();
    expect(probe).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();

    pendingProbe.resolve();

    await expect(Promise.all([probeOperation, closeOperation])).resolves.toEqual([
      undefined,
      undefined,
    ]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('does not reconnect after shutdown begins', async (): Promise<void> => {
    const probe = jest.fn((): Promise<void> => Promise.resolve());
    const driver = databaseDriver({ probe });
    const database = new ManagedDatabaseConnection(driver);

    await database.close();

    await expect(database.probe()).rejects.toThrow('Database connection is closed');
    expect(probe).not.toHaveBeenCalled();
  });
});
