import { ErrorReply } from '@redis/client';
import { types as nodeUtilTypes } from 'node:util';

import {
  InvalidRedisLuaScriptError,
  type RedisLuaScript,
  type RedisLuaScriptExecutor,
} from './lua-script.contract';
import {
  copyRedisLuaScriptArguments,
  copyRedisLuaScriptKeys,
  getRedisLuaScriptRegistration,
} from './lua-script.definition';
import { RedisRuntimeUnavailableError, type RedisRuntime } from './redis.contract';
import {
  createRedisRuntimeDeadline,
  discardRedisRuntimeClient,
  getRedisRuntimeState,
  runRedisRuntimeOperation,
  settleRedisRuntimeCommandWithinDeadline,
  type RedisRuntimeState,
} from './redis-runtime';

const EXECUTOR_CONSTRUCTION_CAPABILITY = Object.freeze({});
const REDIS_NOSCRIPT_CACHE_MISS_MESSAGE = 'NOSCRIPT No matching script. Please use EVAL.';
const capturedIsError: (value: unknown) => boolean = (
  Error as ErrorConstructor & Readonly<{ isError(value: unknown): boolean }>
).isError;
const capturedFreeze = Object.freeze;
const capturedGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const capturedIsProxy = nodeUtilTypes.isProxy;
const capturedReflectApply = Reflect.apply;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured once and invoked only through Reflect.apply.
const capturedWeakMapGet = WeakMap.prototype.get;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured once and invoked only through Reflect.apply.
const capturedWeakMapSet = WeakMap.prototype.set;

const executorStates = new WeakMap<object, RedisRuntimeState>();

function invalidScript(): never {
  throw new InvalidRedisLuaScriptError();
}

function unavailable(): never {
  throw new RedisRuntimeUnavailableError();
}

function isAuthenticNoScriptReply(value: unknown): boolean {
  try {
    if (!(value instanceof ErrorReply) || !capturedIsError(value) || capturedIsProxy(value)) {
      return false;
    }

    const descriptor = capturedGetOwnPropertyDescriptor(value, 'message');

    return (
      descriptor !== undefined &&
      'value' in descriptor &&
      typeof descriptor.value === 'string' &&
      descriptor.value === REDIS_NOSCRIPT_CACHE_MISS_MESSAGE
    );
  } catch {
    return false;
  }
}

function getExecutorState(value: unknown): RedisRuntimeState {
  try {
    if (
      (typeof value !== 'object' && typeof value !== 'function') ||
      value === null ||
      capturedIsProxy(value)
    ) {
      invalidScript();
    }

    const state = capturedReflectApply(capturedWeakMapGet, executorStates, [value]) as
      RedisRuntimeState | undefined;

    if (state === undefined) {
      invalidScript();
    }

    return state;
  } catch {
    invalidScript();
  }
}

class ManagedRedisLuaScriptExecutor implements RedisLuaScriptExecutor {
  public constructor(capability: unknown, state: RedisRuntimeState) {
    if (
      new.target !== ManagedRedisLuaScriptExecutor ||
      capability !== EXECUTOR_CONSTRUCTION_CAPABILITY
    ) {
      invalidScript();
    }

    capturedReflectApply(capturedWeakMapSet, executorStates, [this, state]);
    capturedFreeze(this);
  }

  public async execute(
    script: RedisLuaScript,
    keysValue: readonly string[],
    argumentsValue: readonly string[],
  ): Promise<unknown> {
    const state = getExecutorState(this);
    const redisOperation = runRedisRuntimeOperation(
      state,
      () => {
        const registration = getRedisLuaScriptRegistration(script);

        return {
          arguments_: copyRedisLuaScriptArguments(argumentsValue, registration.argumentCount),
          keys: copyRedisLuaScriptKeys(keysValue, registration.keyCount),
          registration,
        };
      },
      async (
        client,
        commandTimeoutMilliseconds,
        { arguments_, keys, registration },
      ): Promise<unknown> => {
        const deadline = createRedisRuntimeDeadline(commandTimeoutMilliseconds);

        try {
          return await settleRedisRuntimeCommandWithinDeadline(
            state,
            client,
            deadline,
            (): Promise<unknown> =>
              client.evaluateSha(registration.digest, keys, arguments_, deadline.abortSignal),
          );
        } catch (error: unknown) {
          if (!isAuthenticNoScriptReply(error)) {
            discardRedisRuntimeClient(state, client);
            unavailable();
          }

          try {
            return await settleRedisRuntimeCommandWithinDeadline(
              state,
              client,
              deadline,
              (): Promise<unknown> =>
                client.evaluate(registration.source, keys, arguments_, deadline.abortSignal),
            );
          } catch {
            discardRedisRuntimeClient(state, client);
            unavailable();
          }
        }
      },
    );

    try {
      return await redisOperation;
    } catch {
      unavailable();
    }
  }
}

capturedFreeze(ManagedRedisLuaScriptExecutor.prototype);
capturedFreeze(ManagedRedisLuaScriptExecutor);

export function createRedisLuaScriptExecutor(runtime: RedisRuntime): RedisLuaScriptExecutor {
  try {
    return new ManagedRedisLuaScriptExecutor(
      EXECUTOR_CONSTRUCTION_CAPABILITY,
      getRedisRuntimeState(runtime),
    );
  } catch {
    invalidScript();
  }
}
