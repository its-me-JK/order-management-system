import { inspect } from 'node:util';

import * as identityPublicApi from '../../src';
import type { IdentitySessionRefreshReuseDetectedStoreInput } from '../../src/application/identity-session-refresh-command';
import {
  createIdentitySessionCredentialAttempt,
  type IdentitySessionCredentialAttempt,
} from '../../src/application/identity-session-credential-attempt';
import {
  createIdentitySessionCredentialCandidates,
  type IdentitySessionCredentialCandidates,
} from '../../src/application/identity-session-credential-candidates';
import type { IdentitySessionCredentialCrypto } from '../../src/application/identity-session-credential-crypto';
import {
  createIdentityAccessCredentialDigestFromBytes,
  createIdentityRefreshCredentialDigestFromBytes,
  type IdentityAccessCredentialDigest,
  type IdentityRefreshCredentialDigest,
} from '../../src/application/identity-session-credential-digest.values';
import {
  parseIdentityAccessCredentialWireValue,
  parseIdentityRefreshCredentialWireValue,
} from '../../src/application/identity-session-credential-wire.values';
import {
  createIdentitySessionRefreshDiscoveryBoundaryAuthority,
  createIdentitySessionRefreshDiscoveryFoundTicket,
} from '../../src/application/identity-session-refresh-discovery';
import { parseIdentitySecurityEventId } from '../../src/application/identity-security-event.values';
import {
  activateIdentitySessionRefreshWorkflow,
  beginIdentitySessionRefreshLockedLoad,
  closeIdentitySessionRefreshWorkflow,
  completeIdentitySessionRefreshLockedLoadFound,
  consumeIdentityTransactionPendingEvidence,
  createIdentitySessionRefreshWorkflow,
  createIdentitySessionRefreshAttemptBoundWorkflow,
  decideIdentitySessionRefresh,
  InvalidIdentitySessionRefreshWorkflowError,
  revokeIdentityTransactionPendingEvidence,
  type IdentitySessionRefreshReuseDetectedDecision,
  type IdentitySessionRefreshWorkflowBoundary,
  type IdentityTransactionRefreshReuseDetectedEvidence,
  type IdentityTransactionScope,
} from '../../src/application/identity-session-refresh-workflow';
import { IdentityAccount } from '../../src/domain/identity-account';
import { IdentityRefreshCredential } from '../../src/domain/identity-refresh-credential';
import { IdentitySessionFamily } from '../../src/domain/identity-session-family';
import {
  IDENTITY_SESSION_REFRESH_APPEND_REUSE_EVENT_MYSQL_STATEMENT,
  IDENTITY_SESSION_REFRESH_REUSE_DETECTED_MYSQL_STATEMENTS,
  IDENTITY_SESSION_REFRESH_REVOKE_REUSED_FAMILY_MYSQL_STATEMENT,
  type IdentitySessionRefreshReuseDetectedMySqlStatement,
  type IdentitySessionRefreshReuseDetectedMySqlWriteResult,
} from '../../src/infrastructure/mysql/identity-session-refresh-reuse-detected.statements';
import {
  createMySqlIdentitySessionRefreshReuseDetectedWriter,
  isMySqlIdentitySessionRefreshReuseDetectedConditionalConflict,
  type IdentitySessionRefreshReuseDetectedPersistenceMySqlContext,
} from '../../src/infrastructure/mysql/mysql-identity-session-refresh-reuse-detected.writer';
import * as identityPrismaApi from '../../src/infrastructure/prisma';

const ACCOUNT_ID = '01890f3a-8bcd-7def-8abc-0123456789ab';
const SESSION_ID = '01890f3a-8bcd-7def-aabc-0123456789ab';
const CREDENTIAL_ID = '01890f3a-8bcd-7def-8bcd-0123456789ab';
const SUCCESSOR_CREDENTIAL_ID = '01890f3a-8bcd-7def-9bcd-0123456789ab';
const ACCESS_CREDENTIAL_ID = '01890f3a-8bcd-7def-abcd-0123456789ab';
const SECURITY_EVENT_ID = '01890f3a-8bcd-7def-8cde-0123456789ab';
const ACCOUNT_CREATED_AT = '2026-08-23T09:00:00.000001Z';
const FAMILY_CREATED_AT = '2026-08-23T10:00:00.000001Z';
const ROTATED_AT = '2026-08-23T10:05:00.000002Z';
const IDLE_EXPIRES_AT = '2026-08-23T10:20:00.000002Z';
const ABSOLUTE_EXPIRES_AT = '2026-08-24T10:00:00.000001Z';
const REUSE_DETECTED_AT = '2026-08-23T10:06:00.000003Z';
const ACCESS_WIRE = `oms_at_v1_${'A'.repeat(42)}E`;
const REFRESH_WIRE = `oms_rt_v1_${'E'.repeat(42)}M`;
const PERSISTENCE_ERROR_NAME = 'IdentitySessionRefreshReuseDetectedPersistenceError';
const PERSISTENCE_ERROR_MESSAGE = 'Identity session refresh reuse persistence failed';
const CONFLICT_ERROR_NAME = 'IdentitySessionRefreshReuseDetectedConditionalConflictError';
const CONFLICT_ERROR_MESSAGE =
  'Identity session refresh reuse persistence encountered a conditional conflict';

type StageResponse =
  Readonly<{ kind: 'result'; value: unknown }> | Readonly<{ error: Error; kind: 'throw' }>;
type StatementCall = Readonly<{
  parameters: readonly unknown[];
  statement: IdentitySessionRefreshReuseDetectedMySqlStatement;
}>;
type ContextFixture = Readonly<{
  calls: StatementCall[];
  context: IdentitySessionRefreshReuseDetectedPersistenceMySqlContext;
  executeStatement: jest.MockedFunction<
    (
      statement: IdentitySessionRefreshReuseDetectedMySqlStatement,
      parameters: readonly unknown[],
    ) => Promise<IdentitySessionRefreshReuseDetectedMySqlWriteResult>
  >;
}>;
type WriterFixture = Readonly<{
  attempt: IdentitySessionCredentialAttempt;
  boundary: IdentitySessionRefreshWorkflowBoundary;
  context: ContextFixture;
  decision: IdentitySessionRefreshReuseDetectedDecision;
  input: IdentitySessionRefreshReuseDetectedStoreInput;
  scope: IdentityTransactionScope;
  writer: ReturnType<typeof createMySqlIdentitySessionRefreshReuseDetectedWriter>;
}>;

const CHANGED: IdentitySessionRefreshReuseDetectedMySqlWriteResult = Object.freeze({
  kind: 'changed',
});
const NO_MATCH: IdentitySessionRefreshReuseDetectedMySqlWriteResult = Object.freeze({
  kind: 'no-match',
});
const MALFORMED: IdentitySessionRefreshReuseDetectedMySqlWriteResult = Object.freeze({
  kind: 'malformed',
});

function bytes(fill: number): Uint8Array<ArrayBuffer> {
  const value = new Uint8Array(32);
  value.fill(fill);
  return value;
}

async function credentialAttempt(): Promise<IdentitySessionCredentialAttempt> {
  const accessDigest: IdentityAccessCredentialDigest =
    createIdentityAccessCredentialDigestFromBytes(bytes(31));
  const refreshDigest: IdentityRefreshCredentialDigest =
    createIdentityRefreshCredentialDigestFromBytes(bytes(32));
  const candidates: IdentitySessionCredentialCandidates = createIdentitySessionCredentialCandidates(
    {
      access: {
        wireValue: parseIdentityAccessCredentialWireValue(ACCESS_WIRE),
        digest: accessDigest,
      },
      refresh: {
        wireValue: parseIdentityRefreshCredentialWireValue(REFRESH_WIRE),
        digest: refreshDigest,
      },
    },
  );
  const crypto: IdentitySessionCredentialCrypto = Object.freeze({
    generateSessionCredentialCandidates(): Promise<IdentitySessionCredentialCandidates> {
      return Promise.resolve(candidates);
    },
    digestAccessCredential(): Promise<IdentityAccessCredentialDigest> {
      return Promise.resolve(accessDigest);
    },
    digestRefreshCredential(): Promise<IdentityRefreshCredentialDigest> {
      return Promise.resolve(refreshDigest);
    },
  });

  return createIdentitySessionCredentialAttempt(candidates, crypto);
}

function result(value: unknown): StageResponse {
  return Object.freeze({ kind: 'result', value });
}

function thrown(error: Error): StageResponse {
  return Object.freeze({ error, kind: 'throw' });
}

function contextFixture(
  responses: readonly StageResponse[] = [result(CHANGED), result(CHANGED)],
): ContextFixture {
  const calls: StatementCall[] = [];
  let responseIndex = 0;
  const executeStatement = jest.fn<
    Promise<IdentitySessionRefreshReuseDetectedMySqlWriteResult>,
    [IdentitySessionRefreshReuseDetectedMySqlStatement, readonly unknown[]]
  >((statement, parameters): Promise<IdentitySessionRefreshReuseDetectedMySqlWriteResult> => {
    calls.push({ parameters, statement });
    const response = responses[responseIndex];
    responseIndex += 1;

    if (response === undefined) return Promise.reject(new Error('Missing test response'));
    if (response.kind === 'throw') return Promise.reject(response.error);
    return Promise.resolve(response.value as IdentitySessionRefreshReuseDetectedMySqlWriteResult);
  });

  return {
    calls,
    context: Object.freeze({
      executeStatement:
        executeStatement as unknown as IdentitySessionRefreshReuseDetectedPersistenceMySqlContext['executeStatement'],
    }),
    executeStatement,
  };
}

function account(): IdentityAccount {
  return IdentityAccount.rehydrate({
    id: ACCOUNT_ID,
    loginName: 'system.admin',
    status: 'ACTIVE',
    version: 1,
    createdAt: ACCOUNT_CREATED_AT,
    updatedAt: ACCOUNT_CREATED_AT,
    suspendedAt: null,
    deactivatedAt: null,
  });
}

function sessionFamily(): IdentitySessionFamily {
  return IdentitySessionFamily.rehydrate({
    id: SESSION_ID,
    accountId: ACCOUNT_ID,
    version: 2,
    createdAt: FAMILY_CREATED_AT,
    lastRotatedAt: ROTATED_AT,
    refreshIdleExpiresAt: IDLE_EXPIRES_AT,
    refreshAbsoluteExpiresAt: ABSOLUTE_EXPIRES_AT,
    revokedAt: null,
    closedReason: null,
  });
}

function reusedCredential(): IdentityRefreshCredential {
  return IdentityRefreshCredential.rehydrate({
    id: CREDENTIAL_ID,
    sessionId: SESSION_ID,
    sequence: 1,
    issuedAt: FAMILY_CREATED_AT,
    expiresAt: '2026-08-23T10:15:00.000001Z',
    consumedAt: ROTATED_AT,
    successorId: SUCCESSOR_CREDENTIAL_ID,
  });
}

async function writerFixture(context = contextFixture()): Promise<WriterFixture> {
  const attempt = await credentialAttempt();
  const boundary = createIdentitySessionRefreshAttemptBoundWorkflow(attempt);
  const activated = activateIdentitySessionRefreshWorkflow(boundary.controller);
  const authority = createIdentitySessionRefreshDiscoveryBoundaryAuthority();
  const discoveryDigest = createIdentityRefreshCredentialDigestFromBytes(bytes(23));
  const ticket = createIdentitySessionRefreshDiscoveryFoundTicket(authority, discoveryDigest, {
    accountId: ACCOUNT_ID,
    sessionId: SESSION_ID,
    presentedRefreshCredentialId: CREDENTIAL_ID,
  });
  const operation = beginIdentitySessionRefreshLockedLoad(
    boundary.controller,
    activated.scope,
    authority,
    ticket,
  );
  const load = completeIdentitySessionRefreshLockedLoadFound(
    boundary.controller,
    operation,
    account(),
    sessionFamily(),
    reusedCredential(),
    REUSE_DETECTED_AT,
  );
  const decision = decideIdentitySessionRefresh(
    activated,
    load,
    Object.freeze({
      successorRefreshCredentialId: SUCCESSOR_CREDENTIAL_ID,
      refreshIdleLifetimeSeconds: 900,
      issuedAccessCredentialId: ACCESS_CREDENTIAL_ID,
      accessLifetimeSeconds: 300,
    }),
  );

  if (decision.kind !== 'reuse-detected') throw new Error('Expected a reuse decision');
  const input: IdentitySessionRefreshReuseDetectedStoreInput = Object.freeze({
    decision,
    securityEventId: parseIdentitySecurityEventId(SECURITY_EVENT_ID),
  });

  return Object.freeze({
    attempt,
    boundary,
    context,
    decision,
    input,
    scope: activated.scope,
    writer: createMySqlIdentitySessionRefreshReuseDetectedWriter(
      context.context,
      boundary.controller,
    ),
  });
}

async function captureRejection(operation: () => Promise<unknown>): Promise<Error> {
  try {
    await operation();
  } catch (error: unknown) {
    if (error instanceof Error) return error;
  }

  throw new Error('Expected the operation to reject with an Error');
}

function captureSynchronousError(operation: () => unknown): Error {
  try {
    operation();
  } catch (error: unknown) {
    if (error instanceof Error) return error;
  }

  throw new Error('Expected the operation to throw with an Error');
}

function expectPersistenceError(error: Error, forbidden: readonly string[] = []): void {
  expect(error.name).toBe(PERSISTENCE_ERROR_NAME);
  expect(error.message).toBe(PERSISTENCE_ERROR_MESSAGE);
  expect(Reflect.getPrototypeOf(error)).not.toBe(Error.prototype);
  expect(Object.isFrozen(Reflect.getPrototypeOf(error))).toBe(true);
  expect(Object.hasOwn(error, 'cause')).toBe(false);

  const rendered = inspect(error, { showHidden: true });
  for (const value of forbidden) expect(rendered).not.toContain(value);
}

function closeFailedFixture(fixture: WriterFixture): void {
  closeIdentitySessionRefreshWorkflow(fixture.boundary.controller);
}

function closeSuccessfulFixture(
  fixture: WriterFixture,
  evidence: IdentityTransactionRefreshReuseDetectedEvidence,
): void {
  expect(consumeIdentityTransactionPendingEvidence(fixture.boundary.controller, evidence)).toBe(
    evidence,
  );
  closeIdentitySessionRefreshWorkflow(fixture.boundary.controller);
  expect(revokeIdentityTransactionPendingEvidence(fixture.boundary.controller, evidence)).toBe(
    true,
  );
}

describe('direct MySQL Identity refresh reuse-detected writer', (): void => {
  it('conditionally revokes then appends the exact mapped event before minting evidence', async (): Promise<void> => {
    const fixture = await writerFixture();
    const evidence = await fixture.writer.persistReuseDetected(fixture.scope, fixture.input);

    expect(fixture.context.calls.map(({ statement }) => statement)).toEqual(
      IDENTITY_SESSION_REFRESH_REUSE_DETECTED_MYSQL_STATEMENTS,
    );
    expect(fixture.context.calls[0]?.parameters).toEqual([
      3,
      REUSE_DETECTED_AT,
      SESSION_ID,
      ACCOUNT_ID,
      2,
      1,
      CREDENTIAL_ID,
      1,
    ]);
    expect(fixture.context.calls[1]?.parameters).toEqual([
      SECURITY_EVENT_ID,
      ACCOUNT_ID,
      SESSION_ID,
      REUSE_DETECTED_AT,
    ]);
    expect(Object.isFrozen(fixture.context.calls[0]?.parameters)).toBe(true);
    expect(Object.isFrozen(fixture.context.calls[1]?.parameters)).toBe(true);
    expect(evidence).toEqual({ kind: 'reuse-detected' });
    expect(Reflect.ownKeys(evidence)).toEqual(['kind']);
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(inspect(evidence, { showHidden: true })).not.toContain(ACCESS_WIRE);
    expect(inspect(evidence, { showHidden: true })).not.toContain(REFRESH_WIRE);

    await expect(
      fixture.writer.persistReuseDetected(fixture.scope, fixture.input),
    ).rejects.toBeInstanceOf(InvalidIdentitySessionRefreshWorkflowError);
    expect(fixture.context.executeStatement).toHaveBeenCalledTimes(2);
    closeSuccessfulFixture(fixture, evidence);
  });

  it('turns zero conditional updates into one authentic conflict and skips the event', async (): Promise<void> => {
    const fixture = await writerFixture(contextFixture([result(NO_MATCH)]));
    const error = await captureRejection(() =>
      fixture.writer.persistReuseDetected(fixture.scope, fixture.input),
    );

    expect(error.name).toBe(CONFLICT_ERROR_NAME);
    expect(error.message).toBe(CONFLICT_ERROR_MESSAGE);
    expect(Object.hasOwn(error, 'cause')).toBe(false);
    expect(Object.isFrozen(error)).toBe(true);
    expect(isMySqlIdentitySessionRefreshReuseDetectedConditionalConflict(error)).toBe(true);
    expect(isMySqlIdentitySessionRefreshReuseDetectedConditionalConflict(new Error())).toBe(false);
    expect(
      isMySqlIdentitySessionRefreshReuseDetectedConditionalConflict(
        Object.freeze({ name: CONFLICT_ERROR_NAME, message: CONFLICT_ERROR_MESSAGE }),
      ),
    ).toBe(false);
    expect(
      isMySqlIdentitySessionRefreshReuseDetectedConditionalConflict(new Proxy(error, {})),
    ).toBe(false);
    const conflictPrototype = Reflect.getPrototypeOf(error);
    const conflictConstructor: unknown =
      conflictPrototype === null
        ? undefined
        : (Object.getOwnPropertyDescriptor(conflictPrototype, 'constructor')?.value as unknown);

    expect(typeof conflictConstructor).toBe('function');
    if (typeof conflictConstructor !== 'function') {
      throw new Error('Expected the private conflict constructor');
    }
    const recoveredConflictConstructor = conflictConstructor as new () => unknown;
    const forgedConflict = captureSynchronousError(() =>
      Reflect.construct(recoveredConflictConstructor, []),
    );
    expectPersistenceError(forgedConflict);
    expect(isMySqlIdentitySessionRefreshReuseDetectedConditionalConflict(forgedConflict)).toBe(
      false,
    );
    expect(fixture.context.executeStatement).toHaveBeenCalledTimes(1);
    expect(fixture.context.calls[0]?.statement).toBe(
      IDENTITY_SESSION_REFRESH_REVOKE_REUSED_FAMILY_MYSQL_STATEMENT,
    );

    await expect(
      fixture.writer.persistReuseDetected(fixture.scope, fixture.input),
    ).rejects.toBeInstanceOf(InvalidIdentitySessionRefreshWorkflowError);
    expect(fixture.context.executeStatement).toHaveBeenCalledTimes(1);
    closeFailedFixture(fixture);
  });

  it.each([
    ['malformed update result', [result(MALFORMED)], 1],
    ['malformed event result', [result(CHANGED), result(MALFORMED)], 2],
    ['impossible event no-match', [result(CHANGED), result(NO_MATCH)], 2],
    [
      'extra-field update result',
      [result(Object.freeze({ kind: 'changed', providerSecret: true }))],
      1,
    ],
  ] as const)(
    'fails closed for a %s',
    async (_scenario, responses, expectedCalls): Promise<void> => {
      const fixture = await writerFixture(contextFixture(responses));
      const error = await captureRejection(() =>
        fixture.writer.persistReuseDetected(fixture.scope, fixture.input),
      );

      expectPersistenceError(error, ['providerSecret']);
      expect(isMySqlIdentitySessionRefreshReuseDetectedConditionalConflict(error)).toBe(false);
      expect(fixture.context.executeStatement).toHaveBeenCalledTimes(expectedCalls);
      await expect(
        fixture.writer.persistReuseDetected(fixture.scope, fixture.input),
      ).rejects.toBeInstanceOf(InvalidIdentitySessionRefreshWorkflowError);
      expect(fixture.context.executeStatement).toHaveBeenCalledTimes(expectedCalls);
      closeFailedFixture(fixture);
    },
  );

  it.each([0, 1] as const)(
    'hides a provider rejection and absorbs the workflow at statement %i',
    async (failureStage): Promise<void> => {
      const providerSecret = `vendor-query-secret-${String(failureStage)}`;
      const responses = [result(CHANGED), result(CHANGED)];
      responses[failureStage] = thrown(new Error(providerSecret));
      const fixture = await writerFixture(contextFixture(responses));
      const error = await captureRejection(() =>
        fixture.writer.persistReuseDetected(fixture.scope, fixture.input),
      );

      expectPersistenceError(error, [providerSecret]);
      expect(fixture.context.executeStatement).toHaveBeenCalledTimes(failureStage + 1);
      await expect(
        fixture.writer.persistReuseDetected(fixture.scope, fixture.input),
      ).rejects.toBeInstanceOf(InvalidIdentitySessionRefreshWorkflowError);
      expect(fixture.context.executeStatement).toHaveBeenCalledTimes(failureStage + 1);
      closeFailedFixture(fixture);
    },
  );

  it('authenticates the scope and decision before SQL without consuming the rightful action', async (): Promise<void> => {
    const fixture = await writerFixture();
    const foreignAttempt = await credentialAttempt();
    const foreignBoundary = createIdentitySessionRefreshAttemptBoundWorkflow(foreignAttempt);
    const foreignContext = activateIdentitySessionRefreshWorkflow(foreignBoundary.controller);

    await expect(
      fixture.writer.persistReuseDetected(foreignContext.scope, fixture.input),
    ).rejects.toBeInstanceOf(InvalidIdentitySessionRefreshWorkflowError);
    await expect(
      fixture.writer.persistReuseDetected(
        fixture.scope,
        Object.freeze({
          ...fixture.input,
          decision: structuredClone(fixture.decision),
        }) as IdentitySessionRefreshReuseDetectedStoreInput,
      ),
    ).rejects.toBeInstanceOf(InvalidIdentitySessionRefreshWorkflowError);
    expect(fixture.context.executeStatement).not.toHaveBeenCalled();

    const evidence = await fixture.writer.persistReuseDetected(fixture.scope, fixture.input);
    expect(fixture.context.executeStatement).toHaveBeenCalledTimes(2);
    closeSuccessfulFixture(fixture, evidence);
    closeIdentitySessionRefreshWorkflow(foreignBoundary.controller);
  });

  it('rejects hostile store inputs without invoking traps or poisoning the rightful decision', async (): Promise<void> => {
    const fixture = await writerFixture();
    let trapCalls = 0;
    const hostileInput = new Proxy(fixture.input, {
      get(): never {
        trapCalls += 1;
        throw new Error('input-proxy-secret');
      },
      ownKeys(): never {
        trapCalls += 1;
        throw new Error('input-proxy-secret');
      },
    });
    const error = await captureRejection(() =>
      fixture.writer.persistReuseDetected(fixture.scope, hostileInput),
    );

    expectPersistenceError(error, ['input-proxy-secret']);
    expect(trapCalls).toBe(0);
    expect(fixture.context.executeStatement).not.toHaveBeenCalled();

    const evidence = await fixture.writer.persistReuseDetected(fixture.scope, fixture.input);
    closeSuccessfulFixture(fixture, evidence);
  });

  it('requires a frozen direct context with one own data operation', (): void => {
    const boundary = createIdentitySessionRefreshWorkflow();
    const executeStatement = jest.fn();
    const malformedContexts: unknown[] = [
      null,
      [],
      { executeStatement },
      Object.freeze({ executeStatement: 'not-a-function' }),
      new Proxy(Object.freeze({ executeStatement }), {}),
      Object.freeze(
        Object.defineProperty({}, 'executeStatement', {
          configurable: false,
          enumerable: true,
          get: (): never => {
            throw new Error('context-accessor-secret');
          },
        }),
      ),
    ];

    for (const malformed of malformedContexts) {
      const error = captureSynchronousError(() =>
        createMySqlIdentitySessionRefreshReuseDetectedWriter(
          malformed as IdentitySessionRefreshReuseDetectedPersistenceMySqlContext,
          boundary.controller,
        ),
      );
      expectPersistenceError(error, ['context-accessor-secret']);
    }
    closeIdentitySessionRefreshWorkflow(boundary.controller);
  });

  it('seals the runtime, rejects recovered construction, and stays out of package barrels', async (): Promise<void> => {
    const fixture = await writerFixture();
    const runtime = fixture.writer as unknown as Readonly<{ constructor: unknown }>;
    const recoveredConstructor = runtime.constructor;

    expect(Object.isFrozen(fixture.writer)).toBe(true);
    expect(Reflect.ownKeys(fixture.writer)).toEqual([]);
    expect(Object.isFrozen(Object.getPrototypeOf(fixture.writer))).toBe(true);
    expect(typeof recoveredConstructor).toBe('function');
    expect(Object.isFrozen(recoveredConstructor)).toBe(true);

    if (typeof recoveredConstructor !== 'function') throw new Error('Expected writer constructor');
    const error = captureSynchronousError(() => Reflect.construct(recoveredConstructor, []));
    expectPersistenceError(error);

    for (const internalName of [
      'createMySqlIdentitySessionRefreshReuseDetectedWriter',
      'isMySqlIdentitySessionRefreshReuseDetectedConditionalConflict',
      'IDENTITY_SESSION_REFRESH_REUSE_DETECTED_MYSQL_STATEMENTS',
    ]) {
      expect(identityPublicApi).not.toHaveProperty(internalName);
      expect(identityPrismaApi).not.toHaveProperty(internalName);
    }
    closeIdentitySessionRefreshWorkflow(fixture.boundary.controller);
  });

  it('preserves the direct context receiver and rejects an escaped method receiver', async (): Promise<void> => {
    let receiverMatched = false;
    const context = {
      executeStatement(
        this: unknown,
      ): Promise<IdentitySessionRefreshReuseDetectedMySqlWriteResult> {
        receiverMatched = this === context;
        return Promise.resolve(CHANGED);
      },
    };
    Object.freeze(context);
    const fixture = await writerFixture({
      calls: [],
      context: context as unknown as IdentitySessionRefreshReuseDetectedPersistenceMySqlContext,
      executeStatement: jest.fn(),
    });
    const evidence = await fixture.writer.persistReuseDetected(fixture.scope, fixture.input);

    expect(receiverMatched).toBe(true);
    const escaped = fixture.writer.persistReuseDetected;
    const error = await captureRejection(() =>
      Reflect.apply(escaped, Object.freeze({}), [fixture.scope, fixture.input]),
    );
    expectPersistenceError(error);
    closeSuccessfulFixture(fixture, evidence);
  });

  it('uses only the two fixed statement identities', (): void => {
    expect(IDENTITY_SESSION_REFRESH_REUSE_DETECTED_MYSQL_STATEMENTS).toEqual([
      IDENTITY_SESSION_REFRESH_REVOKE_REUSED_FAMILY_MYSQL_STATEMENT,
      IDENTITY_SESSION_REFRESH_APPEND_REUSE_EVENT_MYSQL_STATEMENT,
    ]);
  });
});
