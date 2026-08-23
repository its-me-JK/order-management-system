import type {
  MySqlTransactionParameter,
  MySqlTransactionStatement,
  MySqlTransactionStatementDefinition,
} from './mysql-transaction.contract';

const MAX_STATEMENT_LENGTH = 32_768;
const MAX_POSITIONAL_PARAMETERS = 64;
const objectPrototype = Object.prototype;
const capturedFreeze = Object.freeze;
const capturedGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const capturedGetPrototypeOf = Object.getPrototypeOf;
const capturedHasOwn = Object.hasOwn;
const capturedIsArray = Array.isArray;
const capturedOwnKeys = Reflect.ownKeys;
const capturedReflectApply = Reflect.apply;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured once and invoked only through Reflect.apply.
const capturedMapSet = Map.prototype.set;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured once and invoked only through Reflect.apply.
const capturedWeakMapGet = WeakMap.prototype.get;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured once and invoked only through Reflect.apply.
const capturedWeakMapSet = WeakMap.prototype.set;

const DEFINITION_KEYS = capturedFreeze([
  'text',
  'parameterCount',
  'decode',
  'duplicateKeyFailures',
] as const);
const STATEMENT_START = /^(?:SELECT|INSERT|UPDATE|DELETE)\b/iu;
const SAFE_CONSTRAINT_NAME = /^[A-Za-z0-9_$-]{1,64}(?:\.[A-Za-z0-9_$-]{1,64}){0,2}$/u;

interface StatementRegistration<Result = unknown, Failure extends string = string> {
  readonly decode: (value: unknown) => Result;
  readonly duplicateKeyFailures: ReadonlyMap<string, Failure>;
  readonly duplicateKeyFailureValues: readonly Failure[];
  readonly parameterCount: number;
  readonly statement: object;
  readonly text: string;
}

const statementRegistrations = new WeakMap<object, StatementRegistration>();

function invalidStatement(): never {
  throw new TypeError('Invalid MySQL transaction statement definition');
}

function isPlainRecord(value: unknown): value is Readonly<Record<PropertyKey, unknown>> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !capturedIsArray(value) &&
    capturedGetPrototypeOf(value) === objectPrototype
  );
}

function ownDataValue(value: object, key: PropertyKey): unknown {
  const descriptor = capturedGetOwnPropertyDescriptor(value, key);

  if (descriptor === undefined || !capturedHasOwn(descriptor, 'value')) {
    invalidStatement();
  }

  return descriptor.value;
}

function readDefinition(value: unknown): Readonly<{
  decode: (value: unknown) => unknown;
  duplicateKeyFailures: unknown;
  parameterCount: number;
  text: string;
}> {
  if (!isPlainRecord(value)) invalidStatement();

  const keys = capturedOwnKeys(value);

  if (
    keys.length < 3 ||
    keys.length > 4 ||
    keys.some(
      (key) =>
        typeof key !== 'string' || !DEFINITION_KEYS.some((expectedKey) => expectedKey === key),
    ) ||
    !keys.includes('text') ||
    !keys.includes('parameterCount') ||
    !keys.includes('decode')
  ) {
    invalidStatement();
  }

  const text = ownDataValue(value, 'text');
  const parameterCount = ownDataValue(value, 'parameterCount');
  const decode = ownDataValue(value, 'decode');

  if (
    typeof text !== 'string' ||
    !Number.isSafeInteger(parameterCount) ||
    (parameterCount as number) < 0 ||
    (parameterCount as number) > MAX_POSITIONAL_PARAMETERS ||
    typeof decode !== 'function'
  ) {
    invalidStatement();
  }

  return {
    decode: decode as (value: unknown) => unknown,
    duplicateKeyFailures: keys.includes('duplicateKeyFailures')
      ? ownDataValue(value, 'duplicateKeyFailures')
      : undefined,
    parameterCount: parameterCount as number,
    text,
  };
}

function countPositionalParameters(text: string): number {
  let parameterCount = 0;
  let quote: "'" | '`' | undefined;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (quote === undefined) {
      if (character === "'" || character === '`') quote = character;
      else if (character === '?') parameterCount += 1;
      continue;
    }

    if (character !== quote) continue;

    if (text[index + 1] === quote) index += 1;
    else quote = undefined;
  }

  if (quote !== undefined) invalidStatement();
  return parameterCount;
}

function normalizeStatementText(value: string): Readonly<{
  parameterCount: number;
  text: string;
}> {
  const text = value.trim();

  if (
    text.length === 0 ||
    text.length > MAX_STATEMENT_LENGTH ||
    !STATEMENT_START.test(text) ||
    text.includes('"') ||
    text.includes('\\') ||
    /[;\0]|--|#|\/\*|\*\//u.test(text)
  ) {
    invalidStatement();
  }

  const parameterCount = countPositionalParameters(text);

  if (parameterCount > MAX_POSITIONAL_PARAMETERS) invalidStatement();

  return { parameterCount, text };
}

function copyDuplicateKeyFailures<Failure extends string>(
  value: unknown,
): Readonly<{
  byConstraint: ReadonlyMap<string, Failure>;
  values: readonly Failure[];
}> {
  if (value === undefined) {
    return capturedFreeze({
      byConstraint: new Map<string, Failure>(),
      values: capturedFreeze([] as Failure[]),
    });
  }
  if (!isPlainRecord(value)) invalidStatement();

  const failures = new Map<string, Failure>();
  const failureValues: Failure[] = [];

  for (const key of capturedOwnKeys(value)) {
    if (typeof key !== 'string' || !SAFE_CONSTRAINT_NAME.test(key)) invalidStatement();

    const failure = ownDataValue(value, key);

    if (typeof failure !== 'string' || failure.length === 0 || failure.length > 64) {
      invalidStatement();
    }

    capturedReflectApply(capturedMapSet, failures, [key, failure as Failure]);
    failureValues.push(failure as Failure);
  }

  return capturedFreeze({
    byConstraint: failures,
    values: capturedFreeze(failureValues),
  });
}

export function defineMySqlTransactionStatement<
  Parameters extends readonly MySqlTransactionParameter[],
  Result,
  Failure extends string,
>(
  definitionValue: MySqlTransactionStatementDefinition<Parameters, Result, Failure>,
): MySqlTransactionStatement<Parameters, Result, Failure> {
  try {
    const definition = readDefinition(definitionValue);
    const normalized = normalizeStatementText(definition.text);

    if (normalized.parameterCount !== definition.parameterCount) invalidStatement();
    const statement = capturedFreeze({}) as MySqlTransactionStatement<Parameters, Result, Failure>;
    const duplicateKeyFailures = copyDuplicateKeyFailures<Failure>(definition.duplicateKeyFailures);
    const registration: StatementRegistration<Result, Failure> = capturedFreeze({
      decode: definition.decode as (value: unknown) => Result,
      duplicateKeyFailures: duplicateKeyFailures.byConstraint,
      duplicateKeyFailureValues: duplicateKeyFailures.values,
      parameterCount: normalized.parameterCount,
      statement,
      text: normalized.text,
    });

    capturedReflectApply(capturedWeakMapSet, statementRegistrations, [statement, registration]);
    return statement;
  } catch {
    invalidStatement();
  }
}

/** @internal Recovers only a statement created by this module. */
export function getMySqlTransactionStatementRegistration(
  statementValue: unknown,
): StatementRegistration {
  const recovered: unknown =
    (typeof statementValue === 'object' && statementValue !== null) ||
    typeof statementValue === 'function'
      ? capturedReflectApply(capturedWeakMapGet, statementRegistrations, [statementValue])
      : undefined;
  const registration = recovered as StatementRegistration | undefined;

  if (registration === undefined || registration.statement !== statementValue) {
    invalidStatement();
  }

  return registration;
}
