import {
  InvalidManagedMariaDbConnectionLeaseError,
  ManagedMariaDbConnectionAllocatorShutdownError,
  ManagedMariaDbConnectionAllocatorUnavailableError,
  ManagedMariaDbConnectionLeaseOwner,
  ManagedMariaDbConnectionReleaseError,
  type ManagedMariaDbAllocatedConnection,
  type ManagedMariaDbConnectionAllocator,
  type ManagedMariaDbConnectionLease,
} from '../src/client/managed-mariadb-connection-lease.owner';

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  readonly reject: (error: unknown) => void;
  readonly resolve: (value: Value) => void;
}

interface ConnectionHarness {
  readonly connection: ManagedMariaDbAllocatedConnection;
  readonly destroy: jest.MockedFunction<() => void>;
  readonly release: jest.MockedFunction<() => Promise<void>>;
}

interface AllocatorHarness {
  readonly allocator: ManagedMariaDbConnectionAllocator;
  readonly end: jest.MockedFunction<() => Promise<void>>;
  readonly getConnection: jest.MockedFunction<() => Promise<ManagedMariaDbAllocatedConnection>>;
}

function deferred<Value>(): Deferred<Value> {
  let resolvePromise: ((value: Value) => void) | undefined;
  let rejectPromise: ((error: unknown) => void) | undefined;
  const promise = new Promise<Value>((resolve, reject): void => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    promise,
    reject: (error): void => rejectPromise?.(error),
    resolve: (value): void => resolvePromise?.(value),
  };
}

function connectionHarness(
  overrides: Partial<ManagedMariaDbAllocatedConnection> = {},
): ConnectionHarness {
  const destroy = jest.fn(overrides.destroy ?? ((): void => undefined));
  const release = jest.fn(overrides.release ?? ((): Promise<void> => Promise.resolve()));
  const connection: ManagedMariaDbAllocatedConnection = {
    destroy,
    query: overrides.query ?? (<Result>(): Promise<Result> => Promise.resolve([] as Result)),
    release,
  };

  return { connection, destroy, release };
}

function allocatorHarness(
  getConnectionImplementation: () => Promise<ManagedMariaDbAllocatedConnection>,
  endImplementation: () => Promise<void> = (): Promise<void> => Promise.resolve(),
): AllocatorHarness {
  const end = jest.fn(endImplementation);
  const getConnection = jest.fn(getConnectionImplementation);
  const allocator: ManagedMariaDbConnectionAllocator = {
    end,
    getConnection,
  };

  return {
    allocator,
    end,
    getConnection,
  };
}

function expectCauseFree(error: unknown, expected: new () => Error): void {
  expect(error).toBeInstanceOf(expected);
  expect(Object.hasOwn(error as object, 'cause')).toBe(false);
}

describe('ManagedMariaDbConnectionLeaseOwner', (): void => {
  it('creates one allocator lazily and authenticates a frozen lease', async (): Promise<void> => {
    const events: string[] = [];
    const connection = connectionHarness();
    const harness = allocatorHarness((): Promise<ManagedMariaDbAllocatedConnection> => {
      events.push('getConnection');
      return Promise.resolve(connection.connection);
    });
    const allocatorOptions = Object.freeze({ connectionLimit: 2 });
    const factory = jest.fn(
      (options: typeof allocatorOptions): ManagedMariaDbConnectionAllocator => {
        expect(options).toBe(allocatorOptions);
        events.push('factory');
        return harness.allocator;
      },
    );
    const owner = new ManagedMariaDbConnectionLeaseOwner(factory, allocatorOptions);

    expect(factory).not.toHaveBeenCalled();

    const lease = await owner.acquire();

    expect(events).toEqual(['factory', 'getConnection']);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(Object.isFrozen(lease)).toBe(true);
    expect(Reflect.ownKeys(lease)).toEqual([]);
    expect(owner.connectionFor(lease)).toBe(connection.connection);

    await expect(owner.release(lease)).resolves.toBeUndefined();
    owner.beginClose();
    expect(() => owner.acquire()).toThrow(ManagedMariaDbConnectionAllocatorUnavailableError);
    const close = owner.close();
    expect(owner.close()).toBe(close);
    await expect(close).resolves.toBeUndefined();
    expect(harness.end).toHaveBeenCalledTimes(1);
  });

  it('registers a pending acquire before close and destroys a late connection without delivering it', async (): Promise<void> => {
    const pendingConnection = deferred<ManagedMariaDbAllocatedConnection>();
    const connection = connectionHarness();
    const harness = allocatorHarness(
      (): Promise<ManagedMariaDbAllocatedConnection> => pendingConnection.promise,
    );
    const owner = new ManagedMariaDbConnectionLeaseOwner(
      (): ManagedMariaDbConnectionAllocator => harness.allocator,
      {},
      {
        shutdownGraceMilliseconds: 0,
      },
    );
    const acquisition = owner.acquire();
    const acquisitionResult = expect(acquisition).rejects.toBeInstanceOf(
      ManagedMariaDbConnectionAllocatorUnavailableError,
    );

    await Promise.resolve();
    expect(harness.getConnection).toHaveBeenCalledTimes(1);

    const close = owner.close();

    await Promise.resolve();
    expect(harness.end).toHaveBeenCalledTimes(1);
    pendingConnection.resolve(connection.connection);

    await acquisitionResult;
    await expect(close).resolves.toBeUndefined();
    expect(connection.destroy).toHaveBeenCalledTimes(1);
    expect(connection.release).not.toHaveBeenCalled();
  });

  it('makes release one-shot, destroys on release failure, and hides its cause', async (): Promise<void> => {
    const pendingRelease = deferred<undefined>();
    const vendorError = new Error('reset leaked digest details');
    const connection = connectionHarness({
      release: (): Promise<void> => pendingRelease.promise,
    });
    const harness = allocatorHarness((): Promise<ManagedMariaDbAllocatedConnection> =>
      Promise.resolve(connection.connection),
    );
    const owner = new ManagedMariaDbConnectionLeaseOwner(
      (): ManagedMariaDbConnectionAllocator => harness.allocator,
      {},
    );
    const lease = await owner.acquire();
    const release = owner.release(lease);

    expect(() => owner.connectionFor(lease)).toThrow(InvalidManagedMariaDbConnectionLeaseError);
    expect(() => owner.release(lease)).toThrow(InvalidManagedMariaDbConnectionLeaseError);
    expect(connection.release).toHaveBeenCalledTimes(1);
    expect(connection.destroy).not.toHaveBeenCalled();

    pendingRelease.reject(vendorError);
    let failure: unknown;
    try {
      await release;
    } catch (error: unknown) {
      failure = error;
    }

    expectCauseFree(failure, ManagedMariaDbConnectionReleaseError);
    expect((failure as Error).message).not.toContain(vendorError.message);
    expect(connection.destroy).toHaveBeenCalledTimes(1);
    expect(() => {
      owner.destroy(lease);
    }).toThrow(InvalidManagedMariaDbConnectionLeaseError);
    await expect(owner.close()).resolves.toBeUndefined();
  });

  it('keeps a releasing lease authentic so a caller-owned deadline can quarantine it', async (): Promise<void> => {
    const pendingRelease = deferred<undefined>();
    const connection = connectionHarness({
      release: (): Promise<void> => pendingRelease.promise,
    });
    const harness = allocatorHarness((): Promise<ManagedMariaDbAllocatedConnection> =>
      Promise.resolve(connection.connection),
    );
    const owner = new ManagedMariaDbConnectionLeaseOwner(
      (): ManagedMariaDbConnectionAllocator => harness.allocator,
      {},
    );
    const lease = await owner.acquire();
    const release = owner.release(lease);

    expect(() => owner.connectionFor(lease)).toThrow(InvalidManagedMariaDbConnectionLeaseError);
    expect(() => owner.release(lease)).toThrow(InvalidManagedMariaDbConnectionLeaseError);

    expect(() => {
      owner.destroy(lease);
    }).not.toThrow();
    expect(connection.destroy).toHaveBeenCalledTimes(1);
    expect(() => {
      owner.destroy(lease);
    }).toThrow(InvalidManagedMariaDbConnectionLeaseError);

    pendingRelease.resolve(undefined);
    await expect(release).resolves.toBeUndefined();
    await expect(owner.close()).resolves.toBeUndefined();
  });

  it('rejects forged, cloned, proxied, foreign-owner, and replayed leases without touching a connection', async (): Promise<void> => {
    const connection = connectionHarness();
    const harness = allocatorHarness((): Promise<ManagedMariaDbAllocatedConnection> =>
      Promise.resolve(connection.connection),
    );
    const owner = new ManagedMariaDbConnectionLeaseOwner(
      (): ManagedMariaDbConnectionAllocator => harness.allocator,
      {},
    );
    const foreignOwner = new ManagedMariaDbConnectionLeaseOwner(
      (): ManagedMariaDbConnectionAllocator => harness.allocator,
      {},
    );
    const lease = await owner.acquire();
    const invalidLeases = [
      Object.freeze({}) as ManagedMariaDbConnectionLease,
      { ...lease } as ManagedMariaDbConnectionLease,
      new Proxy(lease, {}),
    ];

    for (const invalidLease of invalidLeases) {
      expect(() => owner.connectionFor(invalidLease)).toThrow(
        InvalidManagedMariaDbConnectionLeaseError,
      );
      expect(() => owner.release(invalidLease)).toThrow(InvalidManagedMariaDbConnectionLeaseError);
      expect(() => {
        owner.destroy(invalidLease);
      }).toThrow(InvalidManagedMariaDbConnectionLeaseError);
    }

    expect(() => foreignOwner.connectionFor(lease)).toThrow(
      InvalidManagedMariaDbConnectionLeaseError,
    );
    expect(() => foreignOwner.release(lease)).toThrow(InvalidManagedMariaDbConnectionLeaseError);
    expect(() => {
      foreignOwner.destroy(lease);
    }).toThrow(InvalidManagedMariaDbConnectionLeaseError);
    expect(connection.release).not.toHaveBeenCalled();
    expect(connection.destroy).not.toHaveBeenCalled();

    owner.destroy(lease);
    expect(connection.destroy).toHaveBeenCalledTimes(1);
    expect(() => {
      owner.destroy(lease);
    }).toThrow(InvalidManagedMariaDbConnectionLeaseError);
    expect(connection.destroy).toHaveBeenCalledTimes(1);
    await expect(owner.close()).resolves.toBeUndefined();
    await expect(foreignOwner.close()).resolves.toBeUndefined();
  });

  it('allows an active lease to drain during grace and closes the allocator once', async (): Promise<void> => {
    const connection = connectionHarness();
    const harness = allocatorHarness((): Promise<ManagedMariaDbAllocatedConnection> =>
      Promise.resolve(connection.connection),
    );
    const owner = new ManagedMariaDbConnectionLeaseOwner(
      (): ManagedMariaDbConnectionAllocator => harness.allocator,
      {},
      {
        shutdownGraceMilliseconds: 0,
      },
    );
    const lease = await owner.acquire();
    const firstClose = owner.close();
    const secondClose = owner.close();

    expect(firstClose).toBe(secondClose);
    await Promise.resolve();
    expect(harness.end).toHaveBeenCalledTimes(1);

    await expect(owner.release(lease)).resolves.toBeUndefined();
    await expect(firstClose).resolves.toBeUndefined();
    expect(connection.release).toHaveBeenCalledTimes(1);
    expect(connection.destroy).not.toHaveBeenCalled();
    expect(harness.end).toHaveBeenCalledTimes(1);
  });

  it('destroys the exact active connection after the bounded grace deadline', async (): Promise<void> => {
    jest.useFakeTimers();

    try {
      const connection = connectionHarness();
      const harness = allocatorHarness((): Promise<ManagedMariaDbAllocatedConnection> =>
        Promise.resolve(connection.connection),
      );
      const owner = new ManagedMariaDbConnectionLeaseOwner(
        (): ManagedMariaDbConnectionAllocator => harness.allocator,
        {},
        {
          shutdownGraceMilliseconds: 50,
        },
      );
      const lease = await owner.acquire();
      const close = owner.close();
      await Promise.resolve();

      expect(connection.destroy).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(50);
      await expect(close).resolves.toBeUndefined();
      expect(connection.destroy).toHaveBeenCalledTimes(1);
      expect(connection.release).not.toHaveBeenCalled();
      expect(() => owner.connectionFor(lease)).toThrow(InvalidManagedMariaDbConnectionLeaseError);
    } finally {
      jest.useRealTimers();
    }
  });

  it('collapses allocator-end and forced-destroy failures into one cause-free shutdown error', async (): Promise<void> => {
    jest.useFakeTimers();

    try {
      const connection = connectionHarness({
        destroy: (): never => {
          throw new Error('destroy provider detail');
        },
      });
      const harness = allocatorHarness(
        (): Promise<ManagedMariaDbAllocatedConnection> => Promise.resolve(connection.connection),
        (): Promise<void> => Promise.reject(new Error('allocator provider detail')),
      );
      const owner = new ManagedMariaDbConnectionLeaseOwner(
        (): ManagedMariaDbConnectionAllocator => harness.allocator,
        {},
        {
          shutdownGraceMilliseconds: 10,
        },
      );
      await owner.acquire();
      const close = owner.close();
      await Promise.resolve();
      let closeFailure: unknown;
      const observeClose = close.catch((error: unknown): void => {
        closeFailure = error;
      });

      await jest.advanceTimersByTimeAsync(10);
      await observeClose;
      expectCauseFree(closeFailure, ManagedMariaDbConnectionAllocatorShutdownError);
      expect((closeFailure as Error).message).not.toMatch(/provider detail/u);
      expect(harness.end).toHaveBeenCalledTimes(1);
      expect(connection.destroy).toHaveBeenCalledTimes(1);
      expect(owner.close()).toBe(close);
    } finally {
      jest.useRealTimers();
    }
  });
});
