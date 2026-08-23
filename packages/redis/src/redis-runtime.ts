import { performance } from 'node:perf_hooks';
import { inspect, types as nodeUtilTypes } from 'node:util';

import type { ManagedRedisClient, RedisClientFactory } from './client/redis-client';
import {
  RedisRuntimeUnavailableError,
  type RedisConnection,
  type RedisConnectionOptions,
  type RedisRuntime,
} from './redis.contract';
import { normalizeRedisConnectionOptions } from './redis-options';

const REDACTED_REDIS_RUNTIME = '[REDACTED]';
const RUNTIME_CONSTRUCTION_CAPABILITY = Object.freeze({});
const CONNECTION_CONSTRUCTION_CAPABILITY = Object.freeze({});

// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured once and invoked only through Reflect.apply.
const capturedAbortSignalTimeout = AbortSignal.timeout;
const capturedClearTimeout = clearTimeout;
const capturedFreeze = Object.freeze;
const capturedIsProxy = nodeUtilTypes.isProxy;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured once and invoked only through Reflect.apply.
const capturedPerformanceNow = performance.now;
const capturedReflectApply = Reflect.apply;
const capturedSetTimeout = setTimeout;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured once and invoked only through Reflect.apply.
const capturedSetAdd = Set.prototype.add;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured once and invoked only through Reflect.apply.
const capturedSetDelete = Set.prototype.delete;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured once and invoked only through Reflect.apply.
const capturedWeakMapGet = WeakMap.prototype.get;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured once and invoked only through Reflect.apply.
const capturedWeakMapSet = WeakMap.prototype.set;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured once and invoked only through Reflect.apply.
const capturedWeakSetAdd = WeakSet.prototype.add;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured once and invoked only through Reflect.apply.
const capturedWeakSetHas = WeakSet.prototype.has;

export interface RedisRuntimeState {
  readonly activeOperations: Set<Promise<unknown>>;
  admittedOperationCount: number;
  activeProbe: Promise<void> | undefined;
  client: ManagedRedisClient | undefined;
  readonly clientFactory: RedisClientFactory;
  closed: boolean;
  closeOperation: Promise<void> | undefined;
  connectOperation: Promise<ManagedRedisClient> | undefined;
  readonly options: RedisConnectionOptions;
  shutdownExpiresAtMonotonicMilliseconds: number | undefined;
}

export interface RedisRuntimeDeadline {
  readonly abortSignal: AbortSignal;
  readonly expiresAtMonotonicMilliseconds: number;
}

const runtimeStates = new WeakMap<object, RedisRuntimeState>();
const connectionStates = new WeakMap<object, RedisRuntimeState>();
const destroyedClients = new WeakSet<object>();

function unavailable(): never {
  throw new RedisRuntimeUnavailableError();
}

function weakMapGet<Key extends object, Value>(
  map: WeakMap<Key, Value>,
  key: Key,
): Value | undefined {
  return capturedReflectApply(capturedWeakMapGet, map, [key]) as Value | undefined;
}

function weakMapSet<Key extends object, Value>(
  map: WeakMap<Key, Value>,
  key: Key,
  value: Value,
): void {
  capturedReflectApply(capturedWeakMapSet, map, [key, value]);
}

function addActiveOperation(state: RedisRuntimeState, operation: Promise<unknown>): void {
  capturedReflectApply(capturedSetAdd, state.activeOperations, [operation]);

  void operation.then(
    (): void => {
      capturedReflectApply(capturedSetDelete, state.activeOperations, [operation]);
    },
    (): void => {
      capturedReflectApply(capturedSetDelete, state.activeOperations, [operation]);
    },
  );
}

function safelyDestroyClient(client: ManagedRedisClient): void {
  try {
    if (capturedReflectApply(capturedWeakSetHas, destroyedClients, [client])) {
      return;
    }

    capturedReflectApply(capturedWeakSetAdd, destroyedClients, [client]);
    client.destroy();
  } catch {
    // Shutdown and failure translation must never expose a vendor error.
  }
}

function discardClient(state: RedisRuntimeState, client: ManagedRedisClient): void {
  safelyDestroyClient(client);

  if (state.client === client) {
    state.client = undefined;
  }
}

export function discardRedisRuntimeClient(
  state: RedisRuntimeState,
  client: ManagedRedisClient,
): void {
  discardClient(state, client);
}

function createNativeTimeout(milliseconds: number): AbortSignal {
  return capturedReflectApply(capturedAbortSignalTimeout, AbortSignal, [milliseconds]);
}

function monotonicNow(): number {
  return capturedReflectApply(capturedPerformanceNow, performance, []);
}

export function createRedisRuntimeDeadline(milliseconds: number): RedisRuntimeDeadline {
  const expiresAtMonotonicMilliseconds = monotonicNow() + milliseconds;

  return capturedFreeze({
    abortSignal: createNativeTimeout(milliseconds),
    expiresAtMonotonicMilliseconds,
  });
}

function deadlineHasElapsed(deadline: RedisRuntimeDeadline): boolean {
  try {
    return monotonicNow() >= deadline.expiresAtMonotonicMilliseconds;
  } catch {
    return true;
  }
}

function runtimeNoLongerOwnsClient(state: RedisRuntimeState, client: ManagedRedisClient): boolean {
  if (state.client !== client) {
    return true;
  }

  const shutdownExpiry = state.shutdownExpiresAtMonotonicMilliseconds;

  if (shutdownExpiry === undefined) {
    return false;
  }

  try {
    return monotonicNow() >= shutdownExpiry;
  } catch {
    return true;
  }
}

function commandCannotSettle(
  state: RedisRuntimeState,
  client: ManagedRedisClient,
  deadline: RedisRuntimeDeadline,
): boolean {
  return deadlineHasElapsed(deadline) || runtimeNoLongerOwnsClient(state, client);
}

export function settleRedisRuntimeCommandWithinDeadline<Result>(
  state: RedisRuntimeState,
  client: ManagedRedisClient,
  deadline: RedisRuntimeDeadline,
  command: () => Promise<Result>,
): Promise<Result> {
  const { abortSignal } = deadline;

  return new Promise((resolve, reject): void => {
    let settled = false;
    const detachDeadline = (): void => {
      try {
        abortSignal.removeEventListener('abort', expire);
      } catch {
        // A deadline cleanup failure must not alter the command outcome.
      }
    };
    const expire = (): void => {
      if (settled) {
        return;
      }

      settled = true;
      detachDeadline();
      discardClient(state, client);
      reject(new RedisRuntimeUnavailableError());
    };
    const rejectProvider = (error: unknown): void => {
      if (settled) {
        return;
      }

      if (commandCannotSettle(state, client, deadline)) {
        expire();
        return;
      }

      settled = true;
      detachDeadline();
      reject(error instanceof Error ? error : new RedisRuntimeUnavailableError());
    };
    const resolveProvider = (value: Result): void => {
      if (settled) {
        return;
      }

      if (commandCannotSettle(state, client, deadline)) {
        expire();
        return;
      }

      settled = true;
      detachDeadline();
      resolve(value);
    };

    if (abortSignal.aborted || commandCannotSettle(state, client, deadline)) {
      expire();
      return;
    }

    try {
      abortSignal.addEventListener('abort', expire, { once: true });
    } catch {
      expire();
      return;
    }

    let providerOperation: Promise<Result>;

    try {
      if (commandCannotSettle(state, client, deadline)) {
        expire();
        return;
      }

      providerOperation = command();
    } catch (error: unknown) {
      rejectProvider(error);
      return;
    }

    void Promise.resolve(providerOperation).then(resolveProvider, rejectProvider);
  });
}

function connectWithinDeadline(
  state: RedisRuntimeState,
  client: ManagedRedisClient,
): Promise<void> {
  const deadline = createRedisRuntimeDeadline(state.options.connectTimeoutMilliseconds);
  const { abortSignal } = deadline;

  return new Promise((resolve, reject): void => {
    let settled = false;
    const fail = (): void => {
      if (settled) {
        return;
      }

      settled = true;
      abortSignal.removeEventListener('abort', fail);
      discardClient(state, client);
      reject(new RedisRuntimeUnavailableError());
    };
    const succeed = (): void => {
      if (settled) {
        return;
      }

      if (deadlineHasElapsed(deadline)) {
        fail();
        return;
      }

      settled = true;
      abortSignal.removeEventListener('abort', fail);
      resolve();
    };

    abortSignal.addEventListener('abort', fail, { once: true });
    const providerOperation = Promise.resolve().then((): Promise<void> => {
      if (deadlineHasElapsed(deadline)) {
        fail();
        return Promise.reject(new RedisRuntimeUnavailableError());
      }

      return client.connect();
    });
    void providerOperation.then(succeed, fail);
  });
}

function startConnection(state: RedisRuntimeState): Promise<ManagedRedisClient> {
  if (state.closed) {
    return Promise.reject(new RedisRuntimeUnavailableError());
  }

  const existingClient = state.client;

  if (existingClient !== undefined) {
    let existingClientIsReady: unknown;

    try {
      existingClientIsReady = existingClient.isReady;
    } catch {
      discardClient(state, existingClient);
      return Promise.reject(new RedisRuntimeUnavailableError());
    }

    if (existingClientIsReady === true) {
      return Promise.resolve(existingClient);
    }
  }

  if (state.connectOperation !== undefined) {
    return state.connectOperation;
  }

  if (existingClient !== undefined) {
    discardClient(state, existingClient);
  }

  let client: ManagedRedisClient;

  try {
    client = state.clientFactory(state.options);
  } catch {
    return Promise.reject(new RedisRuntimeUnavailableError());
  }

  try {
    client.onError((): void => undefined);
  } catch {
    safelyDestroyClient(client);
    return Promise.reject(new RedisRuntimeUnavailableError());
  }

  state.client = client;

  let operation: Promise<ManagedRedisClient>;

  try {
    operation = connectWithinDeadline(state, client).then(
      (): ManagedRedisClient => {
        if (state.closed || state.client !== client) {
          discardClient(state, client);
          unavailable();
        }

        let clientIsReady: unknown;

        try {
          clientIsReady = client.isReady;
        } catch {
          discardClient(state, client);
          unavailable();
        }

        if (clientIsReady !== true) {
          discardClient(state, client);
          unavailable();
        }

        return client;
      },
      (): never => {
        discardClient(state, client);
        unavailable();
      },
    );
  } catch {
    discardClient(state, client);
    return Promise.reject(new RedisRuntimeUnavailableError());
  }

  state.connectOperation = operation;

  void operation.then(
    (): void => {
      if (state.connectOperation === operation) {
        state.connectOperation = undefined;
      }
    },
    (): void => {
      if (state.connectOperation === operation) {
        state.connectOperation = undefined;
      }
    },
  );

  return operation;
}

export function getRedisRuntimeState(value: unknown): RedisRuntimeState {
  try {
    if (
      (typeof value !== 'object' && typeof value !== 'function') ||
      value === null ||
      capturedIsProxy(value)
    ) {
      unavailable();
    }

    const state = weakMapGet(runtimeStates, value);

    if (state === undefined) {
      unavailable();
    }

    return state;
  } catch {
    unavailable();
  }
}

function getRedisConnectionState(value: unknown): RedisRuntimeState {
  try {
    if (
      (typeof value !== 'object' && typeof value !== 'function') ||
      value === null ||
      capturedIsProxy(value)
    ) {
      unavailable();
    }

    const state = weakMapGet(connectionStates, value);

    if (state === undefined) {
      unavailable();
    }

    return state;
  } catch {
    unavailable();
  }
}

export function runRedisRuntimeOperation<Prepared, Result>(
  state: RedisRuntimeState,
  prepare: () => Prepared,
  operation: (
    client: ManagedRedisClient,
    commandTimeoutMilliseconds: number,
    prepared: Prepared,
  ) => Promise<Result>,
): Promise<Result> {
  if (state.closed || state.admittedOperationCount >= state.options.commandQueueLimit) {
    return Promise.reject(new RedisRuntimeUnavailableError());
  }

  state.admittedOperationCount += 1;
  let prepared: Prepared;

  try {
    prepared = prepare();
  } catch (error: unknown) {
    state.admittedOperationCount -= 1;
    throw error;
  }

  const trackedOperation = Promise.resolve()
    .then(async (): Promise<Result> => {
      const client = await startConnection(state);

      if (state.closed) {
        unavailable();
      }

      return operation(client, state.options.commandTimeoutMilliseconds, prepared);
    })
    .finally((): void => {
      state.admittedOperationCount -= 1;
    });

  addActiveOperation(state, trackedOperation);
  return trackedOperation;
}

function startProbe(state: RedisRuntimeState): Promise<void> {
  const operation = runRedisRuntimeOperation(
    state,
    (): undefined => undefined,
    async (client): Promise<void> => {
      let response: unknown;

      try {
        const deadline = createRedisRuntimeDeadline(state.options.probeTimeoutMilliseconds);
        response = await settleRedisRuntimeCommandWithinDeadline(
          state,
          client,
          deadline,
          (): Promise<unknown> => client.ping(deadline.abortSignal),
        );
      } catch {
        discardClient(state, client);
        unavailable();
      }

      if (response !== 'PONG') {
        discardClient(state, client);
        unavailable();
      }
    },
  ).catch((): never => {
    unavailable();
  });

  state.activeProbe = operation;

  void operation.then(
    (): void => {
      if (state.activeProbe === operation) {
        state.activeProbe = undefined;
      }
    },
    (): void => {
      if (state.activeProbe === operation) {
        state.activeProbe = undefined;
      }
    },
  );

  return operation;
}

function settleWithinShutdownBound(
  operations: readonly Promise<unknown>[],
  timeoutMilliseconds: number,
): Promise<void> {
  if (operations.length === 0) {
    return Promise.resolve();
  }

  return new Promise((resolve): void => {
    let settled = false;
    const finish = (): void => {
      if (settled) {
        return;
      }

      settled = true;
      capturedClearTimeout(timeout);
      resolve();
    };
    const timeout = capturedSetTimeout(finish, timeoutMilliseconds);

    void Promise.allSettled(operations).then(finish);
  });
}

function closeRuntime(state: RedisRuntimeState): Promise<void> {
  if (state.closeOperation !== undefined) {
    return state.closeOperation;
  }

  state.closed = true;
  try {
    state.shutdownExpiresAtMonotonicMilliseconds =
      monotonicNow() + state.options.shutdownTimeoutMilliseconds;
  } catch {
    state.shutdownExpiresAtMonotonicMilliseconds = Number.NEGATIVE_INFINITY;
  }
  const activeOperations = [...state.activeOperations];
  const operation = settleWithinShutdownBound(
    activeOperations,
    state.options.shutdownTimeoutMilliseconds,
  ).then((): void => {
    const client = state.client;
    state.client = undefined;
    state.connectOperation = undefined;
    state.activeProbe = undefined;

    if (client !== undefined) {
      safelyDestroyClient(client);
    }
  });

  state.closeOperation = operation;
  return operation;
}

class ManagedRedisConnection implements RedisConnection {
  public constructor(capability: unknown, state: RedisRuntimeState) {
    if (
      new.target !== ManagedRedisConnection ||
      capability !== CONNECTION_CONSTRUCTION_CAPABILITY
    ) {
      unavailable();
    }

    weakMapSet(connectionStates, this, state);
    capturedFreeze(this);
  }

  public probe(): Promise<void> {
    const state = getRedisConnectionState(this);

    if (state.closed) {
      return Promise.reject(new RedisRuntimeUnavailableError());
    }

    state.activeProbe ??= startProbe(state);
    return state.activeProbe;
  }

  public toJSON(): string {
    return REDACTED_REDIS_RUNTIME;
  }

  public toString(): string {
    return REDACTED_REDIS_RUNTIME;
  }

  public [Symbol.toPrimitive](): string {
    return REDACTED_REDIS_RUNTIME;
  }

  public [inspect.custom](): string {
    return REDACTED_REDIS_RUNTIME;
  }
}

class ManagedRedisRuntime implements RedisRuntime {
  declare public readonly connection: RedisConnection;

  public constructor(capability: unknown, state: RedisRuntimeState) {
    if (new.target !== ManagedRedisRuntime || capability !== RUNTIME_CONSTRUCTION_CAPABILITY) {
      unavailable();
    }

    const connection = new ManagedRedisConnection(CONNECTION_CONSTRUCTION_CAPABILITY, state);
    Object.defineProperty(this, 'connection', {
      configurable: false,
      enumerable: false,
      value: connection,
      writable: false,
    });
    weakMapSet(runtimeStates, this, state);
    capturedFreeze(this);
  }

  public close(): Promise<void> {
    return closeRuntime(getRedisRuntimeState(this));
  }

  public toJSON(): string {
    return REDACTED_REDIS_RUNTIME;
  }

  public toString(): string {
    return REDACTED_REDIS_RUNTIME;
  }

  public [Symbol.toPrimitive](): string {
    return REDACTED_REDIS_RUNTIME;
  }

  public [inspect.custom](): string {
    return REDACTED_REDIS_RUNTIME;
  }
}

capturedFreeze(ManagedRedisConnection.prototype);
capturedFreeze(ManagedRedisConnection);
capturedFreeze(ManagedRedisRuntime.prototype);
capturedFreeze(ManagedRedisRuntime);

export function createRedisRuntimeWithClientFactory(
  options: unknown,
  clientFactory: RedisClientFactory,
): RedisRuntime {
  try {
    if (typeof clientFactory !== 'function' || capturedIsProxy(clientFactory)) {
      unavailable();
    }

    const state: RedisRuntimeState = {
      activeOperations: new Set(),
      admittedOperationCount: 0,
      activeProbe: undefined,
      client: undefined,
      clientFactory,
      closed: false,
      closeOperation: undefined,
      connectOperation: undefined,
      options: normalizeRedisConnectionOptions(options),
      shutdownExpiresAtMonotonicMilliseconds: undefined,
    };

    return new ManagedRedisRuntime(RUNTIME_CONSTRUCTION_CAPABILITY, state);
  } catch {
    unavailable();
  }
}
