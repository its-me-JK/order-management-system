import { inspect } from 'node:util';

import * as identityPublicApi from '../../src';
import type { IdentitySessionRefreshRotatedStoreInput } from '../../src/application/identity-session-refresh-command';
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
  type IdentitySessionRefreshRotatedDecision,
  type IdentitySessionRefreshWorkflowBoundary,
  type IdentityTransactionRefreshRotatedEvidence,
  type IdentityTransactionScope,
} from '../../src/application/identity-session-refresh-workflow';
import { IdentityAccount } from '../../src/domain/identity-account';
import { parseIdentityAccountId } from '../../src/domain/identity-account.values';
import { parseIdentityPermissionCode } from '../../src/domain/identity-permission.values';
import { IdentityRefreshCredential } from '../../src/domain/identity-refresh-credential';
import { IdentitySessionFamily } from '../../src/domain/identity-session-family';
import { parseIdentitySessionId } from '../../src/domain/identity-session-family.values';
import type { IdentityAuthorityProjection } from '../../src/infrastructure/identity-authority-projection.mapper';
import {
  IDENTITY_SESSION_REFRESH_ROTATION_AUTHORITY_MYSQL_STATEMENT,
  type IdentitySessionRefreshRotationAuthorityMySqlResult,
} from '../../src/infrastructure/mysql/identity-session-refresh-rotation-authority.statement';
import type { IdentitySessionRefreshMySqlWriteResult } from '../../src/infrastructure/mysql/identity-session-refresh-mysql-write-result';
import {
  IDENTITY_SESSION_REFRESH_ADVANCE_FAMILY_MYSQL_STATEMENT,
  IDENTITY_SESSION_REFRESH_APPEND_ROTATED_EVENT_MYSQL_STATEMENT,
  IDENTITY_SESSION_REFRESH_CONSUME_PREDECESSOR_MYSQL_STATEMENT,
  IDENTITY_SESSION_REFRESH_INSERT_ACCESS_CREDENTIAL_MYSQL_STATEMENT,
  IDENTITY_SESSION_REFRESH_INSERT_SUCCESSOR_REFRESH_CREDENTIAL_MYSQL_STATEMENT,
  IDENTITY_SESSION_REFRESH_LINK_PREDECESSOR_MYSQL_STATEMENT,
  IDENTITY_SESSION_REFRESH_ROTATION_MYSQL_STATEMENTS,
  type IdentitySessionRefreshRotationMySqlStatement,
} from '../../src/infrastructure/mysql/identity-session-refresh-rotation.statements';
import {
  createMySqlIdentitySessionRefreshRotatedWriter,
  isMySqlIdentitySessionRefreshRotatedConditionalConflict,
  type IdentitySessionRefreshRotatedPersistenceMySqlContext,
} from '../../src/infrastructure/mysql/mysql-identity-session-refresh-rotated.writer';
import * as identityPrismaApi from '../../src/infrastructure/prisma';

const ACCOUNT_ID = '01890f3a-8bcd-7def-8abc-0123456789ab';
const SESSION_ID = '01890f3a-8bcd-7def-aabc-0123456789ab';
const CREDENTIAL_ID = '01890f3a-8bcd-7def-8bcd-0123456789ab';
const SUCCESSOR_CREDENTIAL_ID = '01890f3a-8bcd-7def-9bcd-0123456789ab';
const ACCESS_CREDENTIAL_ID = '01890f3a-8bcd-7def-abcd-0123456789ab';
const SECURITY_EVENT_ID = '01890f3a-8bcd-7def-8cde-0123456789ab';
const ACCOUNT_CREATED_AT = '2026-08-23T09:00:00.000001Z';
const FAMILY_CREATED_AT = '2026-08-23T10:00:00.000001Z';
const INITIAL_IDLE_EXPIRES_AT = '2026-08-23T10:15:00.000001Z';
const ROTATED_AT = '2026-08-23T10:05:00.000002Z';
const RESULTING_IDLE_EXPIRES_AT = '2026-08-23T10:20:00.000002Z';
const ACCESS_EXPIRES_AT = '2026-08-23T10:10:00.000002Z';
const ABSOLUTE_EXPIRES_AT = '2026-08-24T10:00:00.000001Z';
const ACCESS_WIRE = `oms_at_v1_${'A'.repeat(42)}E`;
const REFRESH_WIRE = `oms_rt_v1_${'E'.repeat(42)}M`;
const PERSISTENCE_ERROR_NAME = 'IdentitySessionRefreshRotatedPersistenceError';
const PERSISTENCE_ERROR_MESSAGE = 'Identity session refresh rotation persistence failed';
const CONFLICT_ERROR_NAME = 'IdentitySessionRefreshRotatedConditionalConflictError';
const CONFLICT_ERROR_MESSAGE =
  'Identity session refresh rotation persistence encountered a conditional conflict';

type StatementResult =
  IdentitySessionRefreshMySqlWriteResult | IdentitySessionRefreshRotationAuthorityMySqlResult;
type StageResponse =
  Readonly<{ kind: 'result'; value: unknown }> | Readonly<{ error: Error; kind: 'throw' }>;
type StatementCall = Readonly<{
  parameters: readonly unknown[];
  statement: IdentitySessionRefreshRotationMySqlStatement;
}>;
type ContextFixture = Readonly<{
  calls: StatementCall[];
  context: IdentitySessionRefreshRotatedPersistenceMySqlContext;
  executeStatement: jest.MockedFunction<
    (
      statement: IdentitySessionRefreshRotationMySqlStatement,
      parameters: readonly unknown[],
    ) => Promise<StatementResult>
  >;
}>;
type WriterFixture = Readonly<{
  attempt: IdentitySessionCredentialAttempt;
  boundary: IdentitySessionRefreshWorkflowBoundary;
  context: ContextFixture;
  decision: IdentitySessionRefreshRotatedDecision;
  input: IdentitySessionRefreshRotatedStoreInput;
  scope: IdentityTransactionScope;
  writer: ReturnType<typeof createMySqlIdentitySessionRefreshRotatedWriter>;
}>;

const CHANGED: IdentitySessionRefreshMySqlWriteResult = Object.freeze({ kind: 'changed' });
const NO_MATCH: IdentitySessionRefreshMySqlWriteResult = Object.freeze({ kind: 'no-match' });
const MALFORMED: IdentitySessionRefreshMySqlWriteResult = Object.freeze({ kind: 'malformed' });
const AUTHORITY_PROJECTION: IdentityAuthorityProjection = Object.freeze({
  actorId: parseIdentityAccountId(ACCOUNT_ID),
  sessionId: parseIdentitySessionId(SESSION_ID),
  activeRoleCount: 1,
  permissions: Object.freeze([parseIdentityPermissionCode('catalog.products.read')]),
});
const RESOLVED_AUTHORITY: IdentitySessionRefreshRotationAuthorityMySqlResult = Object.freeze({
  kind: 'resolved',
  projection: AUTHORITY_PROJECTION,
});
const MALFORMED_AUTHORITY: IdentitySessionRefreshRotationAuthorityMySqlResult = Object.freeze({
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

function successfulResponses(): readonly StageResponse[] {
  return [
    result(CHANGED),
    result(CHANGED),
    result(CHANGED),
    result(CHANGED),
    result(CHANGED),
    result(RESOLVED_AUTHORITY),
    result(CHANGED),
  ];
}

function contextFixture(
  responses: readonly StageResponse[] = successfulResponses(),
): ContextFixture {
  const calls: StatementCall[] = [];
  let responseIndex = 0;
  const executeStatement = jest.fn<
    Promise<StatementResult>,
    [IdentitySessionRefreshRotationMySqlStatement, readonly unknown[]]
  >((statement, parameters): Promise<StatementResult> => {
    calls.push(Object.freeze({ parameters, statement }));
    const response = responses[responseIndex];
    responseIndex += 1;

    if (response === undefined) return Promise.reject(new Error('Missing test response'));
    if (response.kind === 'throw') return Promise.reject(response.error);
    return Promise.resolve(response.value as StatementResult);
  });

  return Object.freeze({
    calls,
    context: Object.freeze({
      executeStatement:
        executeStatement as unknown as IdentitySessionRefreshRotatedPersistenceMySqlContext['executeStatement'],
    }),
    executeStatement,
  });
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
    version: 1,
    createdAt: FAMILY_CREATED_AT,
    lastRotatedAt: FAMILY_CREATED_AT,
    refreshIdleExpiresAt: INITIAL_IDLE_EXPIRES_AT,
    refreshAbsoluteExpiresAt: ABSOLUTE_EXPIRES_AT,
    revokedAt: null,
    closedReason: null,
  });
}

function refreshCredential(): IdentityRefreshCredential {
  return IdentityRefreshCredential.rehydrate({
    id: CREDENTIAL_ID,
    sessionId: SESSION_ID,
    sequence: 1,
    issuedAt: FAMILY_CREATED_AT,
    expiresAt: INITIAL_IDLE_EXPIRES_AT,
    consumedAt: null,
    successorId: null,
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
    refreshCredential(),
    ROTATED_AT,
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

  if (decision.kind !== 'rotated') throw new Error('Expected a rotated decision');
  const input: IdentitySessionRefreshRotatedStoreInput = Object.freeze({
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
    writer: createMySqlIdentitySessionRefreshRotatedWriter(context.context, boundary.controller),
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
  evidence: IdentityTransactionRefreshRotatedEvidence,
): void {
  expect(consumeIdentityTransactionPendingEvidence(fixture.boundary.controller, evidence)).toBe(
    evidence,
  );
  closeIdentitySessionRefreshWorkflow(fixture.boundary.controller);
  expect(revokeIdentityTransactionPendingEvidence(fixture.boundary.controller, evidence)).toBe(
    true,
  );
}

function digestParameter(call: StatementCall | undefined): Uint8Array {
  const value = call?.parameters[2];

  if (!(value instanceof Uint8Array)) throw new Error('Expected digest bytes');
  return value;
}

function expectZeroedDigest(call: StatementCall | undefined): void {
  expect(Array.from(digestParameter(call))).toEqual(new Array<number>(32).fill(0));
}

describe('direct MySQL Identity refresh rotated writer', (): void => {
  it('executes the seven fixed operations with exact correlated material before minting evidence', async (): Promise<void> => {
    const fixture = await writerFixture();
    const evidence = await fixture.writer.persistRotated(fixture.scope, fixture.input);

    expect(fixture.context.calls.map(({ statement }) => statement)).toEqual(
      IDENTITY_SESSION_REFRESH_ROTATION_MYSQL_STATEMENTS,
    );
    expect(fixture.context.calls[0]?.parameters).toEqual([
      ROTATED_AT,
      CREDENTIAL_ID,
      SESSION_ID,
      1,
      FAMILY_CREATED_AT,
      INITIAL_IDLE_EXPIRES_AT,
    ]);
    expect(fixture.context.calls[1]?.parameters).toEqual([
      SUCCESSOR_CREDENTIAL_ID,
      SESSION_ID,
      expect.any(Uint8Array),
      2,
      ROTATED_AT,
      RESULTING_IDLE_EXPIRES_AT,
    ]);
    expect(fixture.context.calls[2]?.parameters).toEqual([
      ACCESS_CREDENTIAL_ID,
      SESSION_ID,
      expect.any(Uint8Array),
      2,
      ROTATED_AT,
      ACCESS_EXPIRES_AT,
    ]);
    expect(fixture.context.calls[3]?.parameters).toEqual([
      SUCCESSOR_CREDENTIAL_ID,
      CREDENTIAL_ID,
      SESSION_ID,
      1,
      FAMILY_CREATED_AT,
      INITIAL_IDLE_EXPIRES_AT,
      ROTATED_AT,
    ]);
    expect(fixture.context.calls[4]?.parameters).toEqual([
      2,
      ROTATED_AT,
      RESULTING_IDLE_EXPIRES_AT,
      SESSION_ID,
      ACCOUNT_ID,
      1,
      FAMILY_CREATED_AT,
      FAMILY_CREATED_AT,
      INITIAL_IDLE_EXPIRES_AT,
      ABSOLUTE_EXPIRES_AT,
      1,
      CREDENTIAL_ID,
      1,
      ROTATED_AT,
      SUCCESSOR_CREDENTIAL_ID,
      SUCCESSOR_CREDENTIAL_ID,
      2,
      ROTATED_AT,
      RESULTING_IDLE_EXPIRES_AT,
      ACCESS_CREDENTIAL_ID,
      2,
      ROTATED_AT,
      ACCESS_EXPIRES_AT,
    ]);
    expect(fixture.context.calls[5]?.parameters).toEqual([ACCOUNT_ID, 1, SESSION_ID, 2]);
    expect(fixture.context.calls[6]?.parameters).toEqual([
      SECURITY_EVENT_ID,
      ACCOUNT_ID,
      ACCOUNT_ID,
      SESSION_ID,
      ROTATED_AT,
    ]);

    for (const call of fixture.context.calls) expect(Object.isFrozen(call.parameters)).toBe(true);
    expectZeroedDigest(fixture.context.calls[1]);
    expectZeroedDigest(fixture.context.calls[2]);
    expect(evidence).toEqual({
      kind: 'rotated',
      principal: {
        actorId: ACCOUNT_ID,
        sessionId: SESSION_ID,
        permissions: ['catalog.products.read'],
      },
      accessCredentialIssuedAt: ROTATED_AT,
      accessCredentialExpiresAt: ACCESS_EXPIRES_AT,
      refreshIdleExpiresAt: RESULTING_IDLE_EXPIRES_AT,
      refreshAbsoluteExpiresAt: ABSOLUTE_EXPIRES_AT,
    });
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(inspect(evidence, { showHidden: true })).not.toContain(ACCESS_WIRE);
    expect(inspect(evidence, { showHidden: true })).not.toContain(REFRESH_WIRE);

    await expect(
      fixture.writer.persistRotated(fixture.scope, fixture.input),
    ).rejects.toBeInstanceOf(InvalidIdentitySessionRefreshWorkflowError);
    expect(fixture.context.executeStatement).toHaveBeenCalledTimes(7);
    closeSuccessfulFixture(fixture, evidence);
  });

  it.each([0, 3, 4] as const)(
    'maps a zero-row result at conditional stage %i to one runtime-authentic conflict',
    async (failureStage): Promise<void> => {
      const responses = successfulResponses().slice();
      responses[failureStage] = result(NO_MATCH);
      const fixture = await writerFixture(contextFixture(responses));
      const error = await captureRejection(() =>
        fixture.writer.persistRotated(fixture.scope, fixture.input),
      );

      expect(error.name).toBe(CONFLICT_ERROR_NAME);
      expect(error.message).toBe(CONFLICT_ERROR_MESSAGE);
      expect(Object.hasOwn(error, 'cause')).toBe(false);
      expect(Object.isFrozen(error)).toBe(true);
      expect(isMySqlIdentitySessionRefreshRotatedConditionalConflict(error)).toBe(true);
      expect(isMySqlIdentitySessionRefreshRotatedConditionalConflict(new Error())).toBe(false);
      expect(
        isMySqlIdentitySessionRefreshRotatedConditionalConflict(
          Object.freeze({ name: CONFLICT_ERROR_NAME, message: CONFLICT_ERROR_MESSAGE }),
        ),
      ).toBe(false);
      expect(isMySqlIdentitySessionRefreshRotatedConditionalConflict(new Proxy(error, {}))).toBe(
        false,
      );
      expect(fixture.context.executeStatement).toHaveBeenCalledTimes(failureStage + 1);

      await expect(
        fixture.writer.persistRotated(fixture.scope, fixture.input),
      ).rejects.toBeInstanceOf(InvalidIdentitySessionRefreshWorkflowError);
      closeFailedFixture(fixture);
    },
  );

  it('rejects recovered construction of the private conditional-conflict type', async (): Promise<void> => {
    const fixture = await writerFixture(contextFixture([result(NO_MATCH)]));
    const error = await captureRejection(() =>
      fixture.writer.persistRotated(fixture.scope, fixture.input),
    );
    const conflictPrototype = Reflect.getPrototypeOf(error);
    const constructorValue =
      conflictPrototype === null
        ? undefined
        : (Object.getOwnPropertyDescriptor(conflictPrototype, 'constructor')?.value as unknown);

    expect(typeof constructorValue).toBe('function');
    if (typeof constructorValue !== 'function') throw new Error('Expected conflict constructor');
    const forged = captureSynchronousError(() => Reflect.construct(constructorValue, []));
    expectPersistenceError(forged);
    expect(isMySqlIdentitySessionRefreshRotatedConditionalConflict(forged)).toBe(false);
    closeFailedFixture(fixture);
  });

  it.each([1, 2, 6] as const)(
    'does not reinterpret impossible no-match at insert stage %i as a conditional conflict',
    async (failureStage): Promise<void> => {
      const responses = successfulResponses().slice();
      responses[failureStage] = result(NO_MATCH);
      const fixture = await writerFixture(contextFixture(responses));
      const error = await captureRejection(() =>
        fixture.writer.persistRotated(fixture.scope, fixture.input),
      );

      expectPersistenceError(error);
      expect(isMySqlIdentitySessionRefreshRotatedConditionalConflict(error)).toBe(false);
      expect(fixture.context.executeStatement).toHaveBeenCalledTimes(failureStage + 1);
      closeFailedFixture(fixture);
    },
  );

  it.each([
    ['malformed consume result', 0, result(MALFORMED)],
    ['extra-field successor result', 1, result(Object.freeze({ kind: 'changed', secret: true }))],
    ['malformed authority result', 5, result(MALFORMED_AUTHORITY)],
    [
      'authority result with an extra field',
      5,
      result(Object.freeze({ ...RESOLVED_AUTHORITY, providerSecret: true })),
    ],
    ['malformed event result', 6, result(MALFORMED)],
  ] as const)('fails closed for %s', async (_scenario, failureStage, response): Promise<void> => {
    const responses = successfulResponses().slice();
    responses[failureStage] = response;
    const fixture = await writerFixture(contextFixture(responses));
    const error = await captureRejection(() =>
      fixture.writer.persistRotated(fixture.scope, fixture.input),
    );

    expectPersistenceError(error, ['providerSecret']);
    expect(isMySqlIdentitySessionRefreshRotatedConditionalConflict(error)).toBe(false);
    expect(fixture.context.executeStatement).toHaveBeenCalledTimes(failureStage + 1);
    closeFailedFixture(fixture);
  });

  it.each([0, 1, 2, 3, 4, 5, 6] as const)(
    'hides a provider rejection, erases copied digests, and absorbs the action at stage %i',
    async (failureStage): Promise<void> => {
      const providerSecret = `vendor-query-secret-${String(failureStage)}`;
      const responses = successfulResponses().slice();
      responses[failureStage] = thrown(new Error(providerSecret));
      const fixture = await writerFixture(contextFixture(responses));
      const error = await captureRejection(() =>
        fixture.writer.persistRotated(fixture.scope, fixture.input),
      );

      expectPersistenceError(error, [providerSecret]);
      expect(fixture.context.executeStatement).toHaveBeenCalledTimes(failureStage + 1);
      if (failureStage >= 1) expectZeroedDigest(fixture.context.calls[1]);
      if (failureStage >= 2) expectZeroedDigest(fixture.context.calls[2]);
      await expect(
        fixture.writer.persistRotated(fixture.scope, fixture.input),
      ).rejects.toBeInstanceOf(InvalidIdentitySessionRefreshWorkflowError);
      closeFailedFixture(fixture);
    },
  );

  it('keeps each copied digest live through its promise and erases it before the next call', async (): Promise<void> => {
    const calls: StatementCall[] = [];
    const observedDigestBytes: number[][] = [];
    let resolveSuccessor: ((value: StatementResult) => void) | undefined;
    const successorSettled = new Promise<StatementResult>((resolve): void => {
      resolveSuccessor = resolve;
    });
    const context: IdentitySessionRefreshRotatedPersistenceMySqlContext = Object.freeze({
      executeStatement(
        statement: IdentitySessionRefreshRotationMySqlStatement,
        parameters: readonly unknown[],
      ): Promise<StatementResult> {
        calls.push(Object.freeze({ parameters, statement }));
        const callIndex = calls.length - 1;

        if ((callIndex === 1 || callIndex === 2) && parameters[2] instanceof Uint8Array) {
          observedDigestBytes.push(Array.from(parameters[2]));
        }
        if (callIndex === 1) return successorSettled;
        if (callIndex === 5) return Promise.resolve(RESOLVED_AUTHORITY);
        return Promise.resolve(CHANGED);
      },
    }) as IdentitySessionRefreshRotatedPersistenceMySqlContext;
    const fixture = await writerFixture({
      calls,
      context,
      executeStatement: jest.fn(),
    });
    const persistence = fixture.writer.persistRotated(fixture.scope, fixture.input);

    await new Promise<void>((resolve): void => {
      queueMicrotask(resolve);
    });
    expect(Array.from(digestParameter(calls[1]))).toEqual(new Array<number>(32).fill(32));
    expect(calls).toHaveLength(2);
    if (resolveSuccessor === undefined) throw new Error('Expected successor resolver');
    resolveSuccessor(CHANGED);
    const evidence = await persistence;

    expectZeroedDigest(calls[1]);
    expectZeroedDigest(calls[2]);
    expect(observedDigestBytes).toEqual([
      new Array<number>(32).fill(32),
      new Array<number>(32).fill(31),
    ]);
    expect(calls[3]?.statement).toBe(IDENTITY_SESSION_REFRESH_LINK_PREDECESSOR_MYSQL_STATEMENT);
    closeSuccessfulFixture(fixture, evidence);
  });

  it('authenticates scope and decision before SQL without consuming the rightful action', async (): Promise<void> => {
    const fixture = await writerFixture();
    const foreignAttempt = await credentialAttempt();
    const foreignBoundary = createIdentitySessionRefreshAttemptBoundWorkflow(foreignAttempt);
    const foreign = activateIdentitySessionRefreshWorkflow(foreignBoundary.controller);

    await expect(
      fixture.writer.persistRotated(foreign.scope, fixture.input),
    ).rejects.toBeInstanceOf(InvalidIdentitySessionRefreshWorkflowError);
    await expect(
      fixture.writer.persistRotated(
        fixture.scope,
        Object.freeze({
          ...fixture.input,
          decision: structuredClone(fixture.decision),
        }) as IdentitySessionRefreshRotatedStoreInput,
      ),
    ).rejects.toBeInstanceOf(InvalidIdentitySessionRefreshWorkflowError);
    expect(fixture.context.executeStatement).not.toHaveBeenCalled();

    const evidence = await fixture.writer.persistRotated(fixture.scope, fixture.input);
    closeSuccessfulFixture(fixture, evidence);
    closeIdentitySessionRefreshWorkflow(foreignBoundary.controller);
  });

  it('rejects hostile store input without invoking traps or poisoning the rightful decision', async (): Promise<void> => {
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
      fixture.writer.persistRotated(fixture.scope, hostileInput),
    );

    expectPersistenceError(error, ['input-proxy-secret']);
    expect(trapCalls).toBe(0);
    expect(fixture.context.executeStatement).not.toHaveBeenCalled();
    const evidence = await fixture.writer.persistRotated(fixture.scope, fixture.input);
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
        createMySqlIdentitySessionRefreshRotatedWriter(
          malformed as IdentitySessionRefreshRotatedPersistenceMySqlContext,
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
      'createMySqlIdentitySessionRefreshRotatedWriter',
      'isMySqlIdentitySessionRefreshRotatedConditionalConflict',
      'IDENTITY_SESSION_REFRESH_ROTATION_MYSQL_STATEMENTS',
    ]) {
      expect(identityPublicApi).not.toHaveProperty(internalName);
      expect(identityPrismaApi).not.toHaveProperty(internalName);
    }
    closeIdentitySessionRefreshWorkflow(fixture.boundary.controller);
  });

  it('preserves the direct context receiver and rejects an escaped writer receiver', async (): Promise<void> => {
    let receiverMatched = true;
    let callIndex = 0;
    const context = {
      executeStatement(this: unknown): Promise<StatementResult> {
        receiverMatched &&= this === context;
        const response = callIndex === 5 ? RESOLVED_AUTHORITY : CHANGED;
        callIndex += 1;
        return Promise.resolve(response);
      },
    };
    Object.freeze(context);
    const fixture = await writerFixture({
      calls: [],
      context: context as unknown as IdentitySessionRefreshRotatedPersistenceMySqlContext,
      executeStatement: jest.fn(),
    });
    const evidence = await fixture.writer.persistRotated(fixture.scope, fixture.input);

    expect(receiverMatched).toBe(true);
    const escaped = fixture.writer.persistRotated;
    const error = await captureRejection(() =>
      Reflect.apply(escaped, Object.freeze({}), [fixture.scope, fixture.input]),
    );
    expectPersistenceError(error);
    closeSuccessfulFixture(fixture, evidence);
  });

  it('uses only the seven fixed statement identities', (): void => {
    expect(IDENTITY_SESSION_REFRESH_ROTATION_MYSQL_STATEMENTS).toEqual([
      IDENTITY_SESSION_REFRESH_CONSUME_PREDECESSOR_MYSQL_STATEMENT,
      IDENTITY_SESSION_REFRESH_INSERT_SUCCESSOR_REFRESH_CREDENTIAL_MYSQL_STATEMENT,
      IDENTITY_SESSION_REFRESH_INSERT_ACCESS_CREDENTIAL_MYSQL_STATEMENT,
      IDENTITY_SESSION_REFRESH_LINK_PREDECESSOR_MYSQL_STATEMENT,
      IDENTITY_SESSION_REFRESH_ADVANCE_FAMILY_MYSQL_STATEMENT,
      IDENTITY_SESSION_REFRESH_ROTATION_AUTHORITY_MYSQL_STATEMENT,
      IDENTITY_SESSION_REFRESH_APPEND_ROTATED_EVENT_MYSQL_STATEMENT,
    ]);
  });
});
