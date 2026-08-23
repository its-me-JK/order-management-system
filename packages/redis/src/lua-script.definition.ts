import { createHash } from 'node:crypto';
import { inspect, types as nodeUtilTypes } from 'node:util';

import {
  InvalidRedisLuaScriptError,
  RedisLuaScriptValue,
  type RedisLuaScript,
} from './lua-script.contract';

const MAX_SCRIPT_SOURCE_BYTES = 32_768;
const MAX_SCRIPT_KEYS = 16;
const MAX_SCRIPT_ARGUMENTS = 64;
const MAX_SCRIPT_KEY_BYTES = 512;
const MAX_SCRIPT_ARGUMENT_BYTES = 4_096;
const REDACTED_REDIS_LUA_SCRIPT = '[REDACTED]';

const capturedArray = Array;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured once as an immutable runtime primitive.
const capturedBufferByteLength = Buffer.byteLength;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured once as an immutable runtime primitive.
const capturedBufferFrom = Buffer.from;
const capturedFreeze = Object.freeze;
const capturedGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const capturedGetPrototypeOf = Object.getPrototypeOf;
const capturedIsInteger = Number.isInteger;
const capturedIsProxy = nodeUtilTypes.isProxy;
const capturedReflectApply = Reflect.apply;
const capturedReflectOwnKeys = Reflect.ownKeys;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured once and invoked through Reflect.apply.
const capturedWeakMapGet = WeakMap.prototype.get;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured once and invoked through Reflect.apply.
const capturedWeakMapSet = WeakMap.prototype.set;

const SCRIPT_CONSTRUCTION_CAPABILITY = capturedFreeze({});

export interface RedisLuaScriptRegistration {
  readonly argumentCount: number;
  readonly digest: string;
  readonly keyCount: number;
  readonly source: string;
}

const scriptRegistrations = new WeakMap<object, RedisLuaScriptRegistration>();

function invalidScript(): never {
  throw new InvalidRedisLuaScriptError();
}

function isWellFormed(value: string): boolean {
  return capturedBufferFrom(value, 'utf8').toString('utf8') === value;
}

function byteLength(value: string): number {
  return capturedBufferByteLength(value, 'utf8');
}

function boundedCount(value: unknown, maximum: number): number {
  if (!capturedIsInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    invalidScript();
  }

  return value as number;
}

function boundedString(value: unknown, minimumBytes: number, maximumBytes: number): string {
  if (typeof value !== 'string' || !isWellFormed(value)) {
    invalidScript();
  }

  const length = byteLength(value);

  if (length < minimumBytes || length > maximumBytes) {
    invalidScript();
  }

  return value;
}

class RegisteredRedisLuaScript extends RedisLuaScriptValue {
  public constructor(capability: unknown, registration: RedisLuaScriptRegistration) {
    super();

    if (new.target !== RegisteredRedisLuaScript || capability !== SCRIPT_CONSTRUCTION_CAPABILITY) {
      invalidScript();
    }

    capturedReflectApply(capturedWeakMapSet, scriptRegistrations, [this, registration]);
    capturedFreeze(this);
  }

  public toJSON(): string {
    return REDACTED_REDIS_LUA_SCRIPT;
  }

  public toString(): string {
    return REDACTED_REDIS_LUA_SCRIPT;
  }

  public [Symbol.toPrimitive](): string {
    return REDACTED_REDIS_LUA_SCRIPT;
  }

  public [inspect.custom](): string {
    return REDACTED_REDIS_LUA_SCRIPT;
  }
}

capturedFreeze(RegisteredRedisLuaScript.prototype);
capturedFreeze(RegisteredRedisLuaScript);

/**
 * Defines one immutable static script and its exact invocation arity.
 *
 * Static-script invariant: trusted registered scripts must never deliberately emit Redis's exact
 * `NOSCRIPT No matching script. Please use EVAL.` cache-miss error.
 */
export function defineRedisLuaScript(
  sourceValue: unknown,
  keyCountValue: unknown,
  argumentCountValue: unknown,
): RedisLuaScript {
  try {
    const source = boundedString(sourceValue, 1, MAX_SCRIPT_SOURCE_BYTES);
    const keyCount = boundedCount(keyCountValue, MAX_SCRIPT_KEYS);
    const argumentCount = boundedCount(argumentCountValue, MAX_SCRIPT_ARGUMENTS);
    const registration = capturedFreeze({
      argumentCount,
      digest: createHash('sha1').update(source, 'utf8').digest('hex'),
      keyCount,
      source,
    });

    return new RegisteredRedisLuaScript(
      SCRIPT_CONSTRUCTION_CAPABILITY,
      registration,
    ) as unknown as RedisLuaScript;
  } catch {
    invalidScript();
  }
}

export function getRedisLuaScriptRegistration(value: unknown): RedisLuaScriptRegistration {
  try {
    if (
      (typeof value !== 'object' && typeof value !== 'function') ||
      value === null ||
      capturedIsProxy(value)
    ) {
      invalidScript();
    }

    const registration = capturedReflectApply(capturedWeakMapGet, scriptRegistrations, [value]) as
      RedisLuaScriptRegistration | undefined;

    if (registration === undefined) {
      invalidScript();
    }

    return registration;
  } catch {
    invalidScript();
  }
}

function assertExactDenseStringArray(
  value: unknown,
  expectedLength: number,
  minimumBytes: number,
  maximumBytes: number,
): readonly string[] {
  if (
    !capturedArray.isArray(value) ||
    capturedIsProxy(value) ||
    capturedGetPrototypeOf(value) !== Array.prototype
  ) {
    invalidScript();
  }

  const lengthDescriptor = capturedGetOwnPropertyDescriptor(value, 'length');

  if (
    lengthDescriptor === undefined ||
    !('value' in lengthDescriptor) ||
    lengthDescriptor.value !== expectedLength
  ) {
    invalidScript();
  }

  const ownKeys = capturedReflectOwnKeys(value);

  if (ownKeys.length !== expectedLength + 1 || ownKeys[ownKeys.length - 1] !== 'length') {
    invalidScript();
  }

  const copy: string[] = [];

  for (let index = 0; index < expectedLength; index += 1) {
    const propertyName = String(index);

    if (ownKeys[index] !== propertyName) {
      invalidScript();
    }

    const descriptor = capturedGetOwnPropertyDescriptor(value, propertyName);

    if (descriptor === undefined || !('value' in descriptor)) {
      invalidScript();
    }

    copy.push(boundedString(descriptor.value, minimumBytes, maximumBytes));
  }

  return capturedFreeze(copy);
}

export function copyRedisLuaScriptKeys(value: unknown, expectedLength: number): readonly string[] {
  try {
    return assertExactDenseStringArray(value, expectedLength, 1, MAX_SCRIPT_KEY_BYTES);
  } catch {
    invalidScript();
  }
}

export function copyRedisLuaScriptArguments(
  value: unknown,
  expectedLength: number,
): readonly string[] {
  try {
    return assertExactDenseStringArray(value, expectedLength, 0, MAX_SCRIPT_ARGUMENT_BYTES);
  } catch {
    invalidScript();
  }
}
