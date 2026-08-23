import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { test } from 'node:test';

import {
  createRedisRuntime,
  RedisRuntimeUnavailableError,
  type RedisConnectionOptions,
  type RedisRuntime,
} from '@oms/redis';
import {
  createRedisLuaScriptExecutor,
  defineRedisLuaScript,
  type RedisLuaScript,
  type RedisLuaScriptExecutor,
} from '@oms/redis/lua-script';

import { createIdentityCredentialAbuseNetworkFromAddressBytes } from '../../src/application/identity-credential-abuse-network';
import {
  authenticateIdentityCredentialAbuseDecision,
  IdentityCredentialAbuseControlUnavailableError,
  type IdentityCredentialAbuseDecision,
  type IdentitySessionRefreshCredentialAbuseAdmission,
} from '../../src/application/identity-session-refresh-credential-abuse-control';
import {
  IDENTITY_REFRESH_CREDENTIAL_WIRE_PREFIX,
  parseIdentityRefreshCredentialWireValue,
  serializeIdentityRefreshCredentialWireValue,
  type IdentityRefreshCredentialWireValue,
} from '../../src/application/identity-session-credential-wire.values';
import {
  createRedisIdentitySessionRefreshCredentialAbuseControl,
  type RedisIdentityCredentialAbuseBucketPolicy,
  type RedisIdentitySessionRefreshCredentialAbuseControlOptions,
} from '../../src/infrastructure/redis';

const READ_STATE_SCRIPT = defineRedisLuaScript(
  String.raw`
local result = {}

for index = 1, 4 do
  local value = redis.call('GET', KEYS[index])

  if value == false then
    value = '__missing__'
  end

  result[index] = value
  result[index + 4] = tostring(redis.call('PTTL', KEYS[index]))
end

return result
`,
  4,
  0,
);
const WRITE_STATE_SCRIPT = defineRedisLuaScript(
  `return redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])`,
  1,
  2,
);
const DELETE_STATE_SCRIPT = defineRedisLuaScript(
  `return redis.call('DEL', KEYS[1], KEYS[2], KEYS[3], KEYS[4])`,
  4,
  0,
);
const BLOCK_REDIS_SCRIPT = defineRedisLuaScript(
  String.raw`
local iterations = tonumber(ARGV[1])
local accumulator = 0

for index = 1, iterations do
  accumulator = (accumulator + index) % 2147483647
end

return tostring(accumulator)
`,
  0,
  1,
);

const BLOCKING_ITERATIONS = '10000000';
const FIXED_UNAVAILABLE_MESSAGE = 'Identity credential abuse control is temporarily unavailable';

interface RecordedInvocation {
  readonly script: RedisLuaScript;
  readonly keys: readonly string[];
  readonly arguments_: readonly string[];
}

interface RedisStateSnapshot {
  readonly values: readonly [string, string, string, string];
  readonly ttlMilliseconds: readonly [number, number, number, number];
}

class RecordingRedisLuaScriptExecutor implements RedisLuaScriptExecutor {
  public readonly invocations: RecordedInvocation[] = [];

  public constructor(private readonly delegate: RedisLuaScriptExecutor) {}

  public execute(
    script: RedisLuaScript,
    keys: readonly string[],
    arguments_: readonly string[],
  ): Promise<unknown> {
    this.invocations.push(
      Object.freeze({
        script,
        keys: Object.freeze([...keys]),
        arguments_: Object.freeze([...arguments_]),
      }),
    );

    return this.delegate.execute(script, keys, arguments_);
  }
}

function findRepositoryRoot(startDirectory: string): string {
  let currentDirectory = startDirectory;

  while (!existsSync(resolve(currentDirectory, 'pnpm-workspace.yaml'))) {
    const parentDirectory = dirname(currentDirectory);

    if (parentDirectory === currentDirectory) {
      throw new Error('Identity Redis integration environment is unavailable');
    }

    currentDirectory = parentDirectory;
  }

  return currentDirectory;
}

const repositoryRoot = findRepositoryRoot(__dirname);

function integrationEnvironmentUnavailable(): never {
  throw new Error('Identity Redis integration environment is unavailable');
}

function readRequiredEnvironmentVariable(name: string): string {
  const value = process.env[name];

  if (value === undefined || value.length === 0) {
    integrationEnvironmentUnavailable();
  }

  return value;
}

function readPort(name: string): number {
  const value = readRequiredEnvironmentVariable(name);

  if (!/^\d{1,5}$/u.test(value)) {
    integrationEnvironmentUnavailable();
  }

  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    integrationEnvironmentUnavailable();
  }

  return port;
}

function decodePasswordFile(pathValue: string): string {
  const path = isAbsolute(pathValue) ? pathValue : resolve(repositoryRoot, pathValue);
  const bytes = readFileSync(path);
  let end = bytes.length;

  if (end > 0 && bytes[end - 1] === 0x0a) {
    end -= 1;

    if (end > 0 && bytes[end - 1] === 0x0d) {
      end -= 1;
    }
  }

  const passwordBytes = bytes.subarray(0, end);
  const password = passwordBytes.toString('utf8');

  if (passwordBytes.length === 0 || !Buffer.from(password, 'utf8').equals(passwordBytes)) {
    integrationEnvironmentUnavailable();
  }

  return password;
}

function readPassword(): string {
  const password = process.env['REDIS_PASSWORD'];
  const passwordFile = process.env['REDIS_PASSWORD_FILE'];

  if ((password === undefined) === (passwordFile === undefined)) {
    integrationEnvironmentUnavailable();
  }

  if (password !== undefined) {
    if (password.length === 0) {
      integrationEnvironmentUnavailable();
    }

    return password;
  }

  if (passwordFile === undefined) {
    integrationEnvironmentUnavailable();
  }

  return decodePasswordFile(passwordFile);
}

function redisOptions(overrides: Partial<RedisConnectionOptions> = {}): RedisConnectionOptions {
  if (process.env['REDIS_TLS_MODE'] !== undefined && process.env['REDIS_TLS_MODE'] !== 'disabled') {
    integrationEnvironmentUnavailable();
  }

  return {
    commandQueueLimit: 256,
    commandTimeoutMilliseconds: 500,
    connectTimeoutMilliseconds: 1_000,
    host: readRequiredEnvironmentVariable('REDIS_HOST'),
    password: readPassword(),
    port: readPort('REDIS_PORT'),
    probeTimeoutMilliseconds: 1_000,
    shutdownTimeoutMilliseconds: 1_000,
    tls: { enabled: false },
    username: readRequiredEnvironmentVariable('REDIS_USERNAME'),
    ...overrides,
  };
}

function createSecret(): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(randomBytes(32));
}

function bucketPolicy(
  capacity: number,
  tokenIntervalMicroseconds: number,
): RedisIdentityCredentialAbuseBucketPolicy {
  return Object.freeze({ capacity, tokenIntervalMicroseconds });
}

function adapterOptions(
  hmacSecret: Uint8Array,
  testName: string,
  policies: Readonly<{
    deployment: RedisIdentityCredentialAbuseBucketPolicy;
    network: RedisIdentityCredentialAbuseBucketPolicy;
    presentedCredential: RedisIdentityCredentialAbuseBucketPolicy;
  }>,
): RedisIdentitySessionRefreshCredentialAbuseControlOptions {
  const suffix = randomBytes(8).toString('hex');

  return Object.freeze({
    deploymentNamespace: `${testName}-${suffix}`,
    keyEpoch: 'v1',
    hmacSecret,
    deployment: policies.deployment,
    network: policies.network,
    presentedCredential: policies.presentedCredential,
  });
}

function uniformPolicies(
  capacity: number,
  tokenIntervalMicroseconds: number,
): Readonly<{
  deployment: RedisIdentityCredentialAbuseBucketPolicy;
  network: RedisIdentityCredentialAbuseBucketPolicy;
  presentedCredential: RedisIdentityCredentialAbuseBucketPolicy;
}> {
  return Object.freeze({
    deployment: bucketPolicy(capacity, tokenIntervalMicroseconds),
    network: bucketPolicy(capacity, tokenIntervalMicroseconds),
    presentedCredential: bucketPolicy(capacity, tokenIntervalMicroseconds),
  });
}

function refreshCredential(seed: number): IdentityRefreshCredentialWireValue {
  const payload = Buffer.alloc(32, seed).toString('base64url');
  return parseIdentityRefreshCredentialWireValue(
    `${IDENTITY_REFRESH_CREDENTIAL_WIRE_PREFIX}${payload}`,
  );
}

function admission(
  addressSuffix: number,
  credential: IdentityRefreshCredentialWireValue,
): IdentitySessionRefreshCredentialAbuseAdmission {
  return Object.freeze({
    network: createIdentityCredentialAbuseNetworkFromAddressBytes(
      'ipv4',
      Uint8Array.of(198, 51, 100, addressSuffix),
    ),
    presentedRefreshCredential: credential,
  });
}

function decision(value: unknown): IdentityCredentialAbuseDecision {
  return authenticateIdentityCredentialAbuseDecision(value);
}

function assertUnavailable(error: unknown): boolean {
  assert.ok(error instanceof IdentityCredentialAbuseControlUnavailableError);
  assert.equal(error.name, 'IdentityCredentialAbuseControlUnavailableError');
  assert.equal(error.message, FIXED_UNAVAILABLE_MESSAGE);
  assert.equal('cause' in error, false);
  return true;
}

function assertRedisRuntimeUnavailable(error: unknown): boolean {
  assert.ok(error instanceof RedisRuntimeUnavailableError);
  assert.equal(error.name, 'RedisRuntimeUnavailableError');
  assert.equal(error.message, 'Redis runtime is unavailable');
  assert.equal('cause' in error, false);
  return true;
}

function requiredString(value: string | undefined): string {
  assert.ok(value !== undefined);
  return value;
}

async function readState(
  executor: RedisLuaScriptExecutor,
  keys: readonly string[],
): Promise<RedisStateSnapshot> {
  const raw = await executor.execute(READ_STATE_SCRIPT, keys, []);
  assert.ok(Array.isArray(raw));
  assert.equal(raw.length, 8);
  assert.ok(raw.every((value): value is string => typeof value === 'string'));

  const ttlMilliseconds = raw.slice(4).map((value) => {
    assert.match(value, /^-?\d+$/u);
    const parsed = Number(value);
    assert.ok(Number.isSafeInteger(parsed));
    return parsed;
  });

  return {
    values: raw.slice(0, 4) as [string, string, string, string],
    ttlMilliseconds: ttlMilliseconds as [number, number, number, number],
  };
}

async function writeState(
  executor: RedisLuaScriptExecutor,
  key: string,
  value: string,
  ttlMilliseconds = 60_000,
): Promise<void> {
  const result = await executor.execute(
    WRITE_STATE_SCRIPT,
    [key],
    [value, String(ttlMilliseconds)],
  );
  assert.equal(result, 'OK');
}

async function cleanInvocations(
  executor: RedisLuaScriptExecutor,
  invocations: readonly RecordedInvocation[],
): Promise<void> {
  const signatures = new Set<string>();

  for (const invocation of invocations) {
    if (invocation.keys.length !== 4) {
      continue;
    }

    const signature = invocation.keys.join('\u0000');

    if (signatures.has(signature)) {
      continue;
    }

    signatures.add(signature);
    await executor.execute(DELETE_STATE_SCRIPT, invocation.keys, []);
  }
}

async function closeRuntimes(runtimes: readonly RedisRuntime[]): Promise<void> {
  await Promise.all(runtimes.map(async (runtime): Promise<void> => runtime.close()));
}

async function settleWithin<Value>(
  operation: Promise<Value>,
  timeoutMilliseconds: number,
): Promise<Value> {
  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject): void => {
        timer = setTimeout((): void => {
          reject(new Error('Identity Redis integration operation exceeded its deadline'));
        }, timeoutMilliseconds);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

async function waitUntilRedisIsBlocked(
  runtime: RedisRuntime,
  blockerHasSettled: () => boolean,
): Promise<void> {
  await settleWithin(
    (async (): Promise<void> => {
      while (!blockerHasSettled()) {
        try {
          await runtime.connection.probe();
        } catch (error: unknown) {
          assertRedisRuntimeUnavailable(error);
          assert.equal(blockerHasSettled(), false);
          return;
        }
      }

      assert.fail('Redis blocker settled before the blocked-state probe');
    })(),
    1_000,
  );
}

async function waitUntilRedisResponds(runtime: RedisRuntime): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await runtime.connection.probe();
      return;
    } catch (error: unknown) {
      assertRedisRuntimeUnavailable(error);
      await new Promise<void>((resolveDelay): void => {
        setTimeout(resolveDelay, 10);
      });
    }
  }

  assert.fail('Redis did not become responsive after the bounded blocker');
}

async function cleanInvocationsWhenRedisResponds(
  executor: RedisLuaScriptExecutor,
  invocations: readonly RecordedInvocation[],
): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await cleanInvocations(executor, invocations);
      return;
    } catch (error: unknown) {
      assertRedisRuntimeUnavailable(error);
    }
  }

  throw new RedisRuntimeUnavailableError();
}

function tokenCount(state: string): number {
  const match = /^1:(\d+):\d+:\d+$/u.exec(state);
  assert.ok(match !== null);
  const parsed = Number(requiredString(match[1]));
  assert.ok(Number.isSafeInteger(parsed));
  return parsed;
}

async function waitForExactlyOneQueuedAdmission(
  executor: RedisLuaScriptExecutor,
  keys: readonly string[],
): Promise<RedisStateSnapshot> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const snapshot = await readState(executor, keys);
    const bucketTokenCounts = snapshot.values.slice(1).map(tokenCount);

    if (bucketTokenCounts.every((tokens) => tokens === 1)) {
      return snapshot;
    }

    assert.ok(bucketTokenCounts.every((tokens) => tokens === 2));
    await new Promise<void>((resolveDelay): void => {
      setTimeout(resolveDelay, 10);
    });
  }

  assert.fail('The queued admission did not become observable');
}

void test('executes the production script from a cold CI cache and stores only pseudonymous bounded state', async () => {
  const secret = createSecret();
  const runtime = createRedisRuntime(redisOptions());
  const executor = createRedisLuaScriptExecutor(runtime);
  const recorder = new RecordingRedisLuaScriptExecutor(executor);
  const options = adapterOptions(secret, 'cold', uniformPolicies(2, 60_000_000));
  const control = createRedisIdentitySessionRefreshCredentialAbuseControl(recorder, options);
  const presentedCredential = refreshCredential(1);
  const input = admission(11, presentedCredential);

  secret.fill(0);

  try {
    // CI starts a fresh Redis service and no earlier step references this
    // production script, so this first call exercises EVALSHA -> NOSCRIPT -> EVAL.
    assert.equal(decision(await control.admitSessionRefresh(input)).kind, 'allowed');
    assert.equal(recorder.invocations.length, 1);

    const invocation = recorder.invocations[0];
    assert.ok(invocation !== undefined);
    assert.equal(invocation.keys.length, 4);
    assert.equal(new Set(invocation.keys).size, 4);
    const keyMatches = invocation.keys.map((key) =>
      /^oms:\{([A-Za-z0-9_-]{43})\}:id-abuse-refresh:a1:ev1:(m|[dnc]:[A-Za-z0-9_-]{43})$/u.exec(
        key,
      ),
    );
    assert.ok(keyMatches.every((match) => match !== null));
    assert.equal(new Set(keyMatches.map((match) => requiredString(match[1]))).size, 1);
    assert.deepEqual(
      keyMatches.map((match) => requiredString(match[2]).slice(0, 1)),
      ['m', 'd', 'n', 'c'],
    );

    const serializedCredential = serializeIdentityRefreshCredentialWireValue(presentedCredential);
    assert.ok(invocation.keys.every((key) => !key.includes(serializedCredential)));
    assert.ok(invocation.arguments_.every((argument) => argument !== serializedCredential));
    assert.equal(invocation.arguments_.length, 7);

    const snapshot = await readState(executor, invocation.keys);
    assert.match(snapshot.values[0], /^[0-9a-f]{64}$/u);
    assert.ok(snapshot.values.slice(1).every((value) => /^1:1:0:\d+$/u.test(value)));
    assert.equal(snapshot.ttlMilliseconds[0], -1);
    assert.ok(snapshot.ttlMilliseconds.slice(1).every((ttl) => ttl > 0 && ttl <= 60_000));
  } finally {
    await cleanInvocations(executor, recorder.invocations);
    await runtime.close();
  }
});

void test('atomically enforces one shared capacity across two independent process runtimes', async () => {
  const secret = createSecret();
  const runtimeA = createRedisRuntime(redisOptions());
  const runtimeB = createRedisRuntime(redisOptions());
  const executorA = createRedisLuaScriptExecutor(runtimeA);
  const executorB = createRedisLuaScriptExecutor(runtimeB);
  const recorderA = new RecordingRedisLuaScriptExecutor(executorA);
  const recorderB = new RecordingRedisLuaScriptExecutor(executorB);
  const options = adapterOptions(secret, 'concurrency', uniformPolicies(8, 180_000_000));
  const controlA = createRedisIdentitySessionRefreshCredentialAbuseControl(recorderA, options);
  const controlB = createRedisIdentitySessionRefreshCredentialAbuseControl(recorderB, options);
  const input = admission(12, refreshCredential(2));

  secret.fill(0);

  try {
    const decisions = await Promise.all(
      Array.from({ length: 32 }, async (_unused, index) =>
        decision(await (index % 2 === 0 ? controlA : controlB).admitSessionRefresh(input)),
      ),
    );

    assert.equal(decisions.filter((result) => result.kind === 'allowed').length, 8);
    assert.equal(decisions.filter((result) => result.kind === 'denied').length, 24);
    assert.equal(recorderA.invocations.length + recorderB.invocations.length, 32);

    const firstKeys = recorderA.invocations[0]?.keys;
    assert.ok(firstKeys !== undefined);
    assert.ok(
      [...recorderA.invocations, ...recorderB.invocations].every(
        (invocation) => invocation.keys.join('\u0000') === firstKeys.join('\u0000'),
      ),
    );
  } finally {
    await cleanInvocations(executorA, [...recorderA.invocations, ...recorderB.invocations]);
    await closeRuntimes([runtimeA, runtimeB]);
  }
});

void test('enforces deployment and network capacities independently of other dimensions', async () => {
  const deploymentSecret = createSecret();
  const networkSecret = createSecret();
  const runtime = createRedisRuntime(redisOptions());
  const executor = createRedisLuaScriptExecutor(runtime);
  const deploymentRecorder = new RecordingRedisLuaScriptExecutor(executor);
  const networkRecorder = new RecordingRedisLuaScriptExecutor(executor);
  const deploymentControl = createRedisIdentitySessionRefreshCredentialAbuseControl(
    deploymentRecorder,
    adapterOptions(
      deploymentSecret,
      'deployment-capacity',
      Object.freeze({
        deployment: bucketPolicy(2, 180_000_000),
        network: bucketPolicy(10, 180_000_000),
        presentedCredential: bucketPolicy(10, 180_000_000),
      }),
    ),
  );
  const networkControl = createRedisIdentitySessionRefreshCredentialAbuseControl(
    networkRecorder,
    adapterOptions(
      networkSecret,
      'network-capacity',
      Object.freeze({
        deployment: bucketPolicy(10, 180_000_000),
        network: bucketPolicy(2, 180_000_000),
        presentedCredential: bucketPolicy(10, 180_000_000),
      }),
    ),
  );

  deploymentSecret.fill(0);
  networkSecret.fill(0);

  try {
    const deploymentDecisions = await Promise.all([
      deploymentControl.admitSessionRefresh(admission(81, refreshCredential(10))),
      deploymentControl.admitSessionRefresh(admission(82, refreshCredential(11))),
      deploymentControl.admitSessionRefresh(admission(83, refreshCredential(12))),
    ]);
    const deploymentKinds = deploymentDecisions.map((value) => decision(value).kind);
    assert.equal(deploymentKinds.filter((kind) => kind === 'allowed').length, 2);
    assert.equal(deploymentKinds.filter((kind) => kind === 'denied').length, 1);

    const networkDecisions: IdentityCredentialAbuseDecision['kind'][] = [];

    for (const credentialSeed of [13, 14, 15]) {
      networkDecisions.push(
        decision(
          await networkControl.admitSessionRefresh(
            admission(84, refreshCredential(credentialSeed)),
          ),
        ).kind,
      );
    }

    assert.deepEqual(networkDecisions, ['allowed', 'allowed', 'denied']);
    assert.equal(
      decision(await networkControl.admitSessionRefresh(admission(85, refreshCredential(16)))).kind,
      'allowed',
    );
  } finally {
    await cleanInvocations(executor, [
      ...deploymentRecorder.invocations,
      ...networkRecorder.invocations,
    ]);
    await runtime.close();
  }
});

void test('does not spend permissive dimensions when any dimension denies the attempt', async () => {
  const secret = createSecret();
  const runtime = createRedisRuntime(redisOptions());
  const executor = createRedisLuaScriptExecutor(runtime);
  const recorder = new RecordingRedisLuaScriptExecutor(executor);
  const options = adapterOptions(
    secret,
    'all-or-none',
    Object.freeze({
      deployment: bucketPolicy(2, 180_000_000),
      network: bucketPolicy(2, 180_000_000),
      presentedCredential: bucketPolicy(1, 180_000_000),
    }),
  );
  const control = createRedisIdentitySessionRefreshCredentialAbuseControl(recorder, options);
  const firstCredential = refreshCredential(3);
  const secondCredential = refreshCredential(4);

  secret.fill(0);

  try {
    assert.equal(
      decision(await control.admitSessionRefresh(admission(21, firstCredential))).kind,
      'allowed',
    );
    assert.equal(
      decision(await control.admitSessionRefresh(admission(22, firstCredential))).kind,
      'denied',
    );
    assert.equal(
      decision(await control.admitSessionRefresh(admission(22, secondCredential))).kind,
      'allowed',
    );
  } finally {
    await cleanInvocations(executor, recorder.invocations);
    await runtime.close();
  }
});

void test('refills from Redis time with carried remainder and renews bounded TTLs', async () => {
  const secret = createSecret();
  const runtime = createRedisRuntime(redisOptions());
  const executor = createRedisLuaScriptExecutor(runtime);
  const recorder = new RecordingRedisLuaScriptExecutor(executor);
  const intervalMicroseconds = 1_000_000;
  const options = adapterOptions(secret, 'refill', uniformPolicies(2, intervalMicroseconds));
  const control = createRedisIdentitySessionRefreshCredentialAbuseControl(recorder, options);
  const input = admission(31, refreshCredential(5));

  secret.fill(0);

  try {
    assert.equal(decision(await control.admitSessionRefresh(input)).kind, 'allowed');
    assert.equal(decision(await control.admitSessionRefresh(input)).kind, 'allowed');

    const keys = recorder.invocations.at(-1)?.keys;
    assert.ok(keys !== undefined);
    const exhausted = await readState(executor, keys);
    const parsedState = /^1:0:\d+:(\d+)$/u.exec(exhausted.values[1]);
    assert.ok(parsedState !== null);
    const lastMicroseconds = BigInt(requiredString(parsedState[1]));
    const seededLastMicroseconds = (lastMicroseconds - 1_100_000n).toString();

    for (const key of keys.slice(1)) {
      await writeState(executor, key, `1:0:0:${seededLastMicroseconds}`, 5_000);
    }

    assert.equal(decision(await control.admitSessionRefresh(input)).kind, 'allowed');
    const refilled = await readState(executor, keys);

    for (let index = 1; index < 4; index += 1) {
      const state = requiredString(refilled.values[index]);
      const match = /^1:0:(\d+):\d+$/u.exec(state);
      assert.ok(match !== null);
      const remainder = Number(requiredString(match[1]));
      const ttlMilliseconds = refilled.ttlMilliseconds[index];
      assert.ok(ttlMilliseconds !== undefined);
      assert.ok(remainder >= 100_000 && remainder < intervalMicroseconds);
      assert.ok(ttlMilliseconds > 0);
      assert.ok(ttlMilliseconds <= 2_000);
    }

    const denied = decision(await control.admitSessionRefresh(input));
    assert.equal(denied.kind, 'denied');
    assert.equal(denied.retryAfterSeconds, 1);
  } finally {
    await cleanInvocations(executor, recorder.invocations);
    await runtime.close();
  }
});

void test('fails closed on Redis clock regression without changing values or renewing TTLs', async () => {
  const secret = createSecret();
  const runtime = createRedisRuntime(redisOptions());
  const executor = createRedisLuaScriptExecutor(runtime);
  const recorder = new RecordingRedisLuaScriptExecutor(executor);
  const options = adapterOptions(secret, 'regression', uniformPolicies(1, 10_000_000));
  const control = createRedisIdentitySessionRefreshCredentialAbuseControl(recorder, options);
  const input = admission(41, refreshCredential(6));

  secret.fill(0);

  try {
    assert.equal(decision(await control.admitSessionRefresh(input)).kind, 'allowed');
    const keys = recorder.invocations[0]?.keys;
    assert.ok(keys !== undefined);
    const initial = await readState(executor, keys);
    const state = /^1:0:0:(\d+)$/u.exec(initial.values[2]);
    assert.ok(state !== null);
    const futureHighWaterMark = (BigInt(requiredString(state[1])) + 5_000_000n).toString();

    await writeState(executor, requiredString(keys[2]), `1:0:0:${futureHighWaterMark}`, 15_000);

    const measurementStartedAtMilliseconds = Date.now();
    const beforeRegression = await readState(executor, keys);
    await assert.rejects(control.admitSessionRefresh(input), assertUnavailable);
    const afterRegression = await readState(executor, keys);
    const measurementElapsedMilliseconds = Date.now() - measurementStartedAtMilliseconds;

    assert.deepEqual(afterRegression.values, beforeRegression.values);
    assert.equal(afterRegression.ttlMilliseconds[0], -1);

    for (let index = 1; index < 4; index += 1) {
      const beforeTtl = beforeRegression.ttlMilliseconds[index];
      const afterTtl = afterRegression.ttlMilliseconds[index];
      assert.ok(beforeTtl !== undefined && beforeTtl > 0);
      assert.ok(afterTtl !== undefined && afterTtl > 0);
      assert.ok(afterTtl <= beforeTtl);
      assert.ok(afterTtl >= beforeTtl - measurementElapsedMilliseconds - 100);
    }
  } finally {
    await cleanInvocations(executor, recorder.invocations);
    await runtime.close();
  }
});

void test('rejects non-canonical bucket states without mutating sibling dimensions', async () => {
  const secret = createSecret();
  const runtime = createRedisRuntime(redisOptions());
  const executor = createRedisLuaScriptExecutor(runtime);
  const recorder = new RecordingRedisLuaScriptExecutor(executor);
  const options = adapterOptions(secret, 'corrupt', uniformPolicies(2, 10_000_000));
  const control = createRedisIdentitySessionRefreshCredentialAbuseControl(recorder, options);
  const input = admission(51, refreshCredential(7));

  secret.fill(0);

  try {
    assert.equal(decision(await control.admitSessionRefresh(input)).kind, 'allowed');
    const keys = recorder.invocations[0]?.keys;
    assert.ok(keys !== undefined);
    const before = await readState(executor, keys);
    const validState = /^1:1:0:(\d+)$/u.exec(before.values[2]);
    assert.ok(validState !== null);
    const lastMicroseconds = requiredString(validState[1]);
    const malformedStates = [
      `2:1:0:${lastMicroseconds}`,
      `1:01:0:${lastMicroseconds}`,
      `1:2:0:${lastMicroseconds}`,
      `1:1:10000000:${lastMicroseconds}`,
      '1:1:0:9007199254740992',
      'corrupt-state',
    ] as const;

    for (const malformedState of malformedStates) {
      await writeState(executor, requiredString(keys[2]), malformedState);
      await assert.rejects(control.admitSessionRefresh(input), assertUnavailable);

      const after = await readState(executor, keys);
      assert.equal(after.values[0], before.values[0]);
      assert.equal(after.values[1], before.values[1]);
      assert.equal(after.values[2], malformedState);
      assert.equal(after.values[3], before.values[3]);
    }
  } finally {
    await cleanInvocations(executor, recorder.invocations);
    await runtime.close();
  }
});

void test('rejects policy and HMAC-secret drift at the shared marker without rewriting state', async () => {
  const secret = createSecret();
  const differentSecret = createSecret();
  const runtime = createRedisRuntime(redisOptions());
  const executor = createRedisLuaScriptExecutor(runtime);
  const originalRecorder = new RecordingRedisLuaScriptExecutor(executor);
  const policyMismatchRecorder = new RecordingRedisLuaScriptExecutor(executor);
  const secretMismatchRecorder = new RecordingRedisLuaScriptExecutor(executor);
  const originalOptions = adapterOptions(secret, 'policy', uniformPolicies(2, 10_000_000));
  const policyMismatchOptions = Object.freeze({
    deploymentNamespace: originalOptions.deploymentNamespace,
    keyEpoch: originalOptions.keyEpoch,
    hmacSecret: secret,
    deployment: originalOptions.deployment,
    network: bucketPolicy(3, 10_000_000),
    presentedCredential: originalOptions.presentedCredential,
  });
  const secretMismatchOptions = Object.freeze({
    deploymentNamespace: originalOptions.deploymentNamespace,
    keyEpoch: originalOptions.keyEpoch,
    hmacSecret: differentSecret,
    deployment: originalOptions.deployment,
    network: originalOptions.network,
    presentedCredential: originalOptions.presentedCredential,
  });
  const original = createRedisIdentitySessionRefreshCredentialAbuseControl(
    originalRecorder,
    originalOptions,
  );
  const policyMismatch = createRedisIdentitySessionRefreshCredentialAbuseControl(
    policyMismatchRecorder,
    policyMismatchOptions,
  );
  const secretMismatch = createRedisIdentitySessionRefreshCredentialAbuseControl(
    secretMismatchRecorder,
    secretMismatchOptions,
  );
  const input = admission(61, refreshCredential(8));

  secret.fill(0);
  differentSecret.fill(0);

  try {
    assert.equal(decision(await original.admitSessionRefresh(input)).kind, 'allowed');
    const keys = originalRecorder.invocations[0]?.keys;
    assert.ok(keys !== undefined);
    const before = await readState(executor, keys);

    await assert.rejects(policyMismatch.admitSessionRefresh(input), assertUnavailable);
    await assert.rejects(secretMismatch.admitSessionRefresh(input), assertUnavailable);

    const policyMismatchKeys = policyMismatchRecorder.invocations[0]?.keys;
    const secretMismatchKeys = secretMismatchRecorder.invocations[0]?.keys;
    assert.ok(policyMismatchKeys !== undefined && secretMismatchKeys !== undefined);
    assert.equal(policyMismatchKeys[0], keys[0]);
    assert.equal(secretMismatchKeys[0], keys[0]);
    assert.deepEqual(policyMismatchKeys, keys);
    assert.ok(secretMismatchKeys.slice(1).every((key, index) => key !== keys[index + 1]));

    const after = await readState(executor, keys);
    assert.deepEqual(after.values, before.values);
    assert.equal(decision(await original.admitSessionRefresh(input)).kind, 'allowed');
  } finally {
    await cleanInvocations(executor, [
      ...originalRecorder.invocations,
      ...policyMismatchRecorder.invocations,
      ...secretMismatchRecorder.invocations,
    ]);
    await runtime.close();
  }
});

void test('makes one fail-closed adapter call when Redis command outcome becomes ambiguous', async () => {
  const secret = createSecret();
  const adapterRuntime = createRedisRuntime(
    redisOptions({ commandTimeoutMilliseconds: 25, shutdownTimeoutMilliseconds: 2_000 }),
  );
  const blockerRuntime = createRedisRuntime(
    redisOptions({ commandTimeoutMilliseconds: 500, shutdownTimeoutMilliseconds: 2_000 }),
  );
  const blockedStateProbeRuntime = createRedisRuntime(
    redisOptions({
      connectTimeoutMilliseconds: 100,
      probeTimeoutMilliseconds: 25,
      shutdownTimeoutMilliseconds: 2_000,
    }),
  );
  const cleanupRuntime = createRedisRuntime(
    redisOptions({
      commandTimeoutMilliseconds: 500,
      connectTimeoutMilliseconds: 100,
      shutdownTimeoutMilliseconds: 2_000,
    }),
  );
  const adapterExecutor = createRedisLuaScriptExecutor(adapterRuntime);
  const blockerExecutor = createRedisLuaScriptExecutor(blockerRuntime);
  const cleanupExecutor = createRedisLuaScriptExecutor(cleanupRuntime);
  const recorder = new RecordingRedisLuaScriptExecutor(adapterExecutor);
  const options = adapterOptions(secret, 'ambiguous', uniformPolicies(3, 180_000_000));
  const control = createRedisIdentitySessionRefreshCredentialAbuseControl(recorder, options);
  const input = admission(71, refreshCredential(9));

  secret.fill(0);
  let primaryFailure: Error | undefined;

  try {
    // Warm only the production script so the timed operation is one EVALSHA,
    // not a cache-loss fallback.
    assert.equal(decision(await control.admitSessionRefresh(input)).kind, 'allowed');
    assert.equal(recorder.invocations.length, 1);
    const keys = recorder.invocations[0]?.keys;
    assert.ok(keys !== undefined);
    const beforeAmbiguousCall = await readState(blockerExecutor, keys);
    assert.ok(beforeAmbiguousCall.values.slice(1).every((value) => tokenCount(value) === 2));

    await Promise.all([
      blockerRuntime.connection.probe(),
      blockedStateProbeRuntime.connection.probe(),
      cleanupRuntime.connection.probe(),
      blockerExecutor.execute(BLOCK_REDIS_SCRIPT, [], ['1000']),
    ]);

    let blockerSettled = false;
    const blocker = blockerExecutor.execute(BLOCK_REDIS_SCRIPT, [], [BLOCKING_ITERATIONS]);
    void blocker.then(
      (): void => {
        blockerSettled = true;
      },
      (): void => {
        blockerSettled = true;
      },
    );

    await waitUntilRedisIsBlocked(blockedStateProbeRuntime, () => blockerSettled);

    await assert.rejects(
      settleWithin(control.admitSessionRefresh(input), 1_000),
      assertUnavailable,
    );
    assert.equal(recorder.invocations.length, 2);
    await settleWithin(
      blocker.catch((error: unknown): undefined => {
        assertRedisRuntimeUnavailable(error);
        return undefined;
      }),
      1_000,
    );
    await waitUntilRedisResponds(blockedStateProbeRuntime);

    const afterAmbiguousCall = await waitForExactlyOneQueuedAdmission(cleanupExecutor, keys);
    assert.ok(afterAmbiguousCall.values.slice(1).every((value) => tokenCount(value) === 1));
    assert.equal(recorder.invocations.length, 2);

    await new Promise<void>((resolveDelay): void => {
      setTimeout(resolveDelay, 50);
    });
    const afterReplayWindow = await readState(cleanupExecutor, keys);
    assert.ok(afterReplayWindow.values.slice(1).every((value) => tokenCount(value) === 1));
  } catch (error: unknown) {
    primaryFailure =
      error instanceof Error ? error : new Error('Identity Redis ambiguity assertion failed');
  }

  let cleanupFailure: Error | undefined;

  try {
    await cleanInvocationsWhenRedisResponds(cleanupExecutor, recorder.invocations);
  } catch (error: unknown) {
    cleanupFailure =
      error instanceof Error ? error : new Error('Identity Redis ambiguity cleanup failed');
  }

  try {
    await closeRuntimes([adapterRuntime, blockerRuntime, blockedStateProbeRuntime, cleanupRuntime]);
  } catch (error: unknown) {
    cleanupFailure ??=
      error instanceof Error ? error : new Error('Identity Redis ambiguity shutdown failed');
  }

  if (primaryFailure !== undefined) {
    throw primaryFailure;
  }

  if (cleanupFailure !== undefined) {
    throw cleanupFailure;
  }
});
