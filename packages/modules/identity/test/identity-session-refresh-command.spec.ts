import { inspect } from 'node:util';

import {
  activateIdentitySessionRefreshCommand,
  admitIdentitySessionRefreshCommand,
  closeIdentitySessionRefreshCommand,
  createIdentitySessionRefreshCommand,
  InvalidIdentitySessionRefreshCommandError,
  runIdentitySessionRefreshCommand,
  type CreateIdentitySessionRefreshCommandInput,
  type IdentitySessionRefreshCommand,
  type IdentitySessionRefreshReuseDetectedStoreInput,
  type IdentitySessionRefreshRotatedStoreInput,
  type IdentitySessionRefreshStore,
} from '../src/application/identity-session-refresh-command';
import {
  createIdentitySessionCredentialAttempt,
  type IdentitySessionCredentialAttempt,
} from '../src/application/identity-session-credential-attempt';
import {
  createIdentitySessionCredentialCandidates,
  type IdentitySessionCredentialCandidates,
} from '../src/application/identity-session-credential-candidates';
import type { IdentitySessionCredentialCrypto } from '../src/application/identity-session-credential-crypto';
import {
  createIdentityAccessCredentialDigestFromBytes,
  createIdentityRefreshCredentialDigestFromBytes,
  type IdentityAccessCredentialDigest,
  type IdentityRefreshCredentialDigest,
} from '../src/application/identity-session-credential-digest.values';
import {
  parseIdentityAccessCredentialWireValue,
  parseIdentityRefreshCredentialWireValue,
} from '../src/application/identity-session-credential-wire.values';
import {
  createIdentitySessionRefreshDiscoveryBoundaryAuthority,
  createIdentitySessionRefreshDiscoveryFoundTicket,
  type IdentitySessionRefreshDiscoveryBoundaryAuthority,
  type IdentitySessionRefreshDiscoveryFoundTicket,
} from '../src/application/identity-session-refresh-discovery';
import {
  beginIdentitySessionRefreshLockedLoad,
  beginIdentitySessionRefreshReusePersistence,
  beginIdentitySessionRefreshRotatedPersistence,
  completeIdentitySessionRefreshLockedLoadFound,
  completeIdentitySessionRefreshLockedLoadNotFound,
  completeIdentitySessionRefreshReusePersistence,
  completeIdentitySessionRefreshRotatedPersistence,
  consumeIdentityTransactionPendingEvidence,
  inspectIdentitySessionRefreshCommittedCompletion,
  inspectIdentitySessionRefreshRotatedPersistence,
  InvalidIdentitySessionRefreshWorkflowError,
  promoteIdentityTransactionPendingEvidence,
  revokeIdentityTransactionPendingEvidence,
  type IdentitySessionRefreshRotatedPersistencePlan,
  type IdentitySessionRefreshWorkflowBoundary,
  type IdentityTransactionEvidence,
  type IdentityTransactionScope,
  type IdentitySessionRefreshCommittedCompletion,
} from '../src/application/identity-session-refresh-workflow';
import {
  createIdentitySessionRefreshCredentialDelivery,
  InvalidIdentitySessionRefreshCredentialDeliveryError,
} from '../src/application/identity-session-refresh-credential-delivery';
import * as identityPublicApi from '../src';
import { IdentityAccount } from '../src/domain/identity-account';
import { IdentityRefreshCredential } from '../src/domain/identity-refresh-credential';
import { IdentitySessionFamily } from '../src/domain/identity-session-family';
import type {
  // @ts-expect-error Refresh commands remain package-internal.
  IdentitySessionRefreshCommand as LeakedIdentitySessionRefreshCommand,
  // @ts-expect-error Refresh credential deliveries remain package-internal.
  IdentitySessionRefreshCredentialDelivery as LeakedIdentitySessionRefreshCredentialDelivery,
} from '../src';

const ACCOUNT_ID = '01890f3a-8bcd-7def-8abc-0123456789ab';
const SESSION_ID = '01890f3a-8bcd-7def-aabc-0123456789ab';
const PRESENTED_CREDENTIAL_ID = '01890f3a-8bcd-7def-8bcd-0123456789ab';
const SUCCESSOR_CREDENTIAL_ID = '01890f3a-8bcd-7def-9bcd-0123456789ab';
const ACCESS_CREDENTIAL_ID = '01890f3a-8bcd-7def-abcd-0123456789ab';
const SECURITY_EVENT_ID = '01890f3a-8bcd-7def-8cde-0123456789ab';
const ACCOUNT_CREATED_AT = '2026-08-23T09:00:00.000001Z';
const FAMILY_CREATED_AT = '2026-08-23T10:00:00.000001Z';
const INITIAL_IDLE_EXPIRES_AT = '2026-08-23T10:15:00.000001Z';
const ABSOLUTE_EXPIRES_AT = '2026-08-24T10:00:00.000001Z';
const ROTATED_AT = '2026-08-23T10:05:00.000002Z';
const REUSE_DETECTED_AT = '2026-08-23T10:06:00.000003Z';
const ACCESS_WIRE = `oms_at_v1_${'A'.repeat(42)}E`;
const REFRESH_WIRE = `oms_rt_v1_${'E'.repeat(42)}M`;
const COMMAND_ERROR_MESSAGE = 'Expected a valid Identity session refresh command transition';
const DELIVERY_ERROR_MESSAGE =
  'Expected an authorized Identity session refresh credential delivery';
const DELIVERY_REDACTION = '[IdentitySessionRefreshCredentialDelivery]';

void (undefined as unknown as LeakedIdentitySessionRefreshCommand);
void (undefined as unknown as LeakedIdentitySessionRefreshCredentialDelivery);

type CredentialAttemptFixture = Readonly<{
  attempt: IdentitySessionCredentialAttempt;
  candidates: IdentitySessionCredentialCandidates;
  accessCredentialDigest: IdentityAccessCredentialDigest;
  refreshCredentialDigest: IdentityRefreshCredentialDigest;
}>;

type StoreMode = 'not-found' | 'rotated' | 'reuse-detected';

interface StoreCalls {
  load: number;
  rotated: number;
  reuseDetected: number;
  loadScope: IdentityTransactionScope | undefined;
  loadTicket: IdentitySessionRefreshDiscoveryFoundTicket | undefined;
  rotatedPlan: IdentitySessionRefreshRotatedPersistencePlan | undefined;
  rotatedInputFrozen: boolean;
  reuseInputKeys: readonly PropertyKey[] | undefined;
  reuseInputFrozen: boolean;
  eventId: string | undefined;
}

type PreparedCommand = Readonly<{
  command: IdentitySessionRefreshCommand;
  boundary: IdentitySessionRefreshWorkflowBoundary;
  context: ReturnType<typeof activateIdentitySessionRefreshCommand>;
  discoveryAuthority: IdentitySessionRefreshDiscoveryBoundaryAuthority;
  discoveryTicket: IdentitySessionRefreshDiscoveryFoundTicket;
  credentialAttempt: CredentialAttemptFixture;
}>;

function bytes(fill: number): Uint8Array<ArrayBuffer> {
  const value = new Uint8Array(32);
  value.fill(fill);
  return value;
}

function discoveryDigest(fill = 19): IdentityRefreshCredentialDigest {
  return createIdentityRefreshCredentialDigestFromBytes(bytes(fill));
}

async function credentialAttempt(
  accessFill = 31,
  refreshFill = 32,
): Promise<CredentialAttemptFixture> {
  const accessCredentialDigest = createIdentityAccessCredentialDigestFromBytes(bytes(accessFill));
  const refreshCredentialDigest = createIdentityRefreshCredentialDigestFromBytes(
    bytes(refreshFill),
  );
  const candidates = createIdentitySessionCredentialCandidates({
    access: {
      wireValue: parseIdentityAccessCredentialWireValue(ACCESS_WIRE),
      digest: accessCredentialDigest,
    },
    refresh: {
      wireValue: parseIdentityRefreshCredentialWireValue(REFRESH_WIRE),
      digest: refreshCredentialDigest,
    },
  });
  const crypto: IdentitySessionCredentialCrypto = Object.freeze({
    generateSessionCredentialCandidates(): Promise<IdentitySessionCredentialCandidates> {
      return Promise.resolve(candidates);
    },
    digestAccessCredential(): Promise<IdentityAccessCredentialDigest> {
      return Promise.resolve(accessCredentialDigest);
    },
    digestRefreshCredential(): Promise<IdentityRefreshCredentialDigest> {
      return Promise.resolve(refreshCredentialDigest);
    },
  });
  const attempt = await createIdentitySessionCredentialAttempt(candidates, crypto);

  return Object.freeze({
    attempt,
    candidates,
    accessCredentialDigest,
    refreshCredentialDigest,
  });
}

function discoveryTicket(): Readonly<{
  authority: IdentitySessionRefreshDiscoveryBoundaryAuthority;
  ticket: IdentitySessionRefreshDiscoveryFoundTicket;
}> {
  const authority = createIdentitySessionRefreshDiscoveryBoundaryAuthority();
  const ticket = createIdentitySessionRefreshDiscoveryFoundTicket(authority, discoveryDigest(), {
    accountId: ACCOUNT_ID,
    sessionId: SESSION_ID,
    presentedRefreshCredentialId: PRESENTED_CREDENTIAL_ID,
  });

  return Object.freeze({ authority, ticket });
}

function commandInput(
  attempt: IdentitySessionCredentialAttempt,
  ticket: IdentitySessionRefreshDiscoveryFoundTicket,
  overrides: Readonly<Record<string, unknown>> = {},
): CreateIdentitySessionRefreshCommandInput {
  return {
    discoveryTicket: ticket,
    credentialAttempt: attempt,
    successorRefreshCredentialId: SUCCESSOR_CREDENTIAL_ID,
    refreshIdleLifetimeSeconds: 900,
    issuedAccessCredentialId: ACCESS_CREDENTIAL_ID,
    accessLifetimeSeconds: 300,
    securityEventId: SECURITY_EVENT_ID,
    ...overrides,
  };
}

async function prepareCommand(dbNow = ROTATED_AT): Promise<PreparedCommand> {
  const attempt = await credentialAttempt();
  const discovery = discoveryTicket();
  const command = createIdentitySessionRefreshCommand(
    commandInput(attempt.attempt, discovery.ticket),
  );
  const boundary = admitIdentitySessionRefreshCommand(command);
  const context = activateIdentitySessionRefreshCommand(boundary.controller, dbNow);

  return Object.freeze({
    command,
    boundary,
    context,
    discoveryAuthority: discovery.authority,
    discoveryTicket: discovery.ticket,
    credentialAttempt: attempt,
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

function sessionFamily(mode: StoreMode): IdentitySessionFamily {
  return IdentitySessionFamily.rehydrate({
    id: SESSION_ID,
    accountId: ACCOUNT_ID,
    version: mode === 'reuse-detected' ? 2 : 1,
    createdAt: FAMILY_CREATED_AT,
    lastRotatedAt: mode === 'reuse-detected' ? ROTATED_AT : FAMILY_CREATED_AT,
    refreshIdleExpiresAt:
      mode === 'reuse-detected' ? '2026-08-23T10:20:00.000002Z' : INITIAL_IDLE_EXPIRES_AT,
    refreshAbsoluteExpiresAt: ABSOLUTE_EXPIRES_AT,
    revokedAt: null,
    closedReason: null,
  });
}

function refreshCredential(mode: StoreMode): IdentityRefreshCredential {
  return IdentityRefreshCredential.rehydrate({
    id: PRESENTED_CREDENTIAL_ID,
    sessionId: SESSION_ID,
    sequence: 1,
    issuedAt: FAMILY_CREATED_AT,
    expiresAt: INITIAL_IDLE_EXPIRES_AT,
    consumedAt: mode === 'reuse-detected' ? ROTATED_AT : null,
    successorId: mode === 'reuse-detected' ? SUCCESSOR_CREDENTIAL_ID : null,
  });
}

function authorityProjection() {
  return Object.freeze({
    actorId: ACCOUNT_ID,
    sessionId: SESSION_ID,
    activeRoleCount: 1,
    permissions: Object.freeze(['catalog.products.read']),
  });
}

function transactionStore(
  prepared: PreparedCommand,
  mode: StoreMode,
): Readonly<{ store: IdentitySessionRefreshStore; calls: StoreCalls }> {
  const calls: StoreCalls = {
    load: 0,
    rotated: 0,
    reuseDetected: 0,
    loadScope: undefined,
    loadTicket: undefined,
    rotatedPlan: undefined,
    rotatedInputFrozen: false,
    reuseInputKeys: undefined,
    reuseInputFrozen: false,
    eventId: undefined,
  };
  const store: IdentitySessionRefreshStore = Object.freeze({
    loadForUpdate(
      scope: IdentityTransactionScope,
      ticket: IdentitySessionRefreshDiscoveryFoundTicket,
    ) {
      calls.load += 1;
      calls.loadScope = scope;
      calls.loadTicket = ticket;
      const operation = beginIdentitySessionRefreshLockedLoad(
        prepared.boundary.controller,
        scope,
        prepared.discoveryAuthority,
        ticket,
      );
      const result =
        mode === 'not-found'
          ? completeIdentitySessionRefreshLockedLoadNotFound(
              prepared.boundary.controller,
              operation,
            )
          : completeIdentitySessionRefreshLockedLoadFound(
              prepared.boundary.controller,
              operation,
              account(),
              sessionFamily(mode),
              refreshCredential(mode),
            );

      return Promise.resolve(result);
    },
    persistRotated(
      scope: IdentityTransactionScope,
      input: IdentitySessionRefreshRotatedStoreInput,
    ) {
      calls.rotated += 1;
      calls.rotatedInputFrozen = Object.isFrozen(input);
      calls.eventId = input.securityEventId;
      const action = beginIdentitySessionRefreshRotatedPersistence(
        prepared.boundary.controller,
        scope,
        input.decision,
        input.securityEventId,
      );
      calls.rotatedPlan = inspectIdentitySessionRefreshRotatedPersistence(
        prepared.boundary.controller,
        action,
      );

      return Promise.resolve(
        completeIdentitySessionRefreshRotatedPersistence(
          prepared.boundary.controller,
          action,
          authorityProjection(),
        ),
      );
    },
    persistReuseDetected(
      scope: IdentityTransactionScope,
      input: IdentitySessionRefreshReuseDetectedStoreInput,
    ) {
      calls.reuseDetected += 1;
      calls.reuseInputKeys = Reflect.ownKeys(input);
      calls.reuseInputFrozen = Object.isFrozen(input);
      calls.eventId = input.securityEventId;
      const action = beginIdentitySessionRefreshReusePersistence(
        prepared.boundary.controller,
        scope,
        input.decision,
        input.securityEventId,
      );

      return Promise.resolve(
        completeIdentitySessionRefreshReusePersistence(prepared.boundary.controller, action),
      );
    },
  });

  return Object.freeze({ store, calls });
}

function captureError(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }

  throw new Error('Expected action to throw');
}

function expectCommandError(action: () => unknown, forbidden: readonly string[] = []): void {
  const error = captureError(action);
  expect(error).toBeInstanceOf(InvalidIdentitySessionRefreshCommandError);
  expect(error).toMatchObject({
    name: 'InvalidIdentitySessionRefreshCommandError',
    message: COMMAND_ERROR_MESSAGE,
  });
  expect(error).not.toHaveProperty('cause');

  const rendered = inspect(error, { showHidden: true });
  for (const value of forbidden) {
    expect(rendered).not.toContain(value);
  }
}

function expectDeliveryError(action: () => unknown, forbidden: readonly string[] = []): void {
  const error = captureError(action);
  expect(error).toBeInstanceOf(InvalidIdentitySessionRefreshCredentialDeliveryError);
  expect(error).toMatchObject({
    name: 'InvalidIdentitySessionRefreshCredentialDeliveryError',
    message: DELIVERY_ERROR_MESSAGE,
  });
  expect(error).not.toHaveProperty('cause');

  const rendered = inspect(error, { showHidden: true });
  for (const value of forbidden) {
    expect(rendered).not.toContain(value);
  }
}

async function committedCompletion(
  prepared: PreparedCommand,
  mode: StoreMode,
): Promise<IdentitySessionRefreshCommittedCompletion> {
  const evidence = await runIdentitySessionRefreshCommand(
    prepared.boundary.controller,
    prepared.context,
    transactionStore(prepared, mode).store,
  );
  closeIdentitySessionRefreshCommand(prepared.boundary.controller);
  const completion = promoteIdentityTransactionPendingEvidence(
    prepared.boundary.controller,
    evidence,
  );

  if (completion === undefined) {
    throw new Error('Expected committed refresh completion fixture');
  }

  return completion;
}

function closeAndRevokePendingEvidence(
  prepared: PreparedCommand,
  evidence: IdentityTransactionEvidence,
): void {
  closeIdentitySessionRefreshCommand(prepared.boundary.controller);
  expect(revokeIdentityTransactionPendingEvidence(prepared.boundary.controller, evidence)).toBe(
    true,
  );
}

describe('Identity session refresh command', (): void => {
  it('creates one empty frozen command without observable credential material', async (): Promise<void> => {
    const attempt = await credentialAttempt();
    const discovery = discoveryTicket();
    const command = createIdentitySessionRefreshCommand(
      commandInput(attempt.attempt, discovery.ticket),
    );

    expect(Reflect.ownKeys(command)).toEqual([]);
    expect(Object.isFrozen(command)).toBe(true);
    expect(JSON.stringify(command)).toBe('{}');
    expect(inspect(command, { showHidden: true })).not.toContain(ACCESS_WIRE);
    expect(inspect(command, { showHidden: true })).not.toContain(REFRESH_WIRE);
    expect(inspect(command, { showHidden: true })).not.toContain(PRESENTED_CREDENTIAL_ID);

    const boundary = admitIdentitySessionRefreshCommand(command);
    closeIdentitySessionRefreshCommand(boundary.controller);
  });

  it('copies exact data properties and rejects malformed, accessor, or Proxy inputs cause-free', async (): Promise<void> => {
    const attempt = await credentialAttempt();
    const discovery = discoveryTicket();
    const valid = commandInput(attempt.attempt, discovery.ticket);
    let accessorReads = 0;
    const accessorInput = { ...valid } as Record<string, unknown>;
    Object.defineProperty(accessorInput, 'securityEventId', {
      enumerable: true,
      get(): string {
        accessorReads += 1;
        return 'accessor-event-secret';
      },
    });
    const trapped = new Proxy(valid, {
      ownKeys(): never {
        throw new Error('proxy-command-secret');
      },
    });

    expectCommandError(
      () => createIdentitySessionRefreshCommand({ ...valid, extra: 'extra-command-secret' }),
      ['extra-command-secret'],
    );
    expectCommandError(
      () => createIdentitySessionRefreshCommand(accessorInput),
      ['accessor-event-secret'],
    );
    expect(accessorReads).toBe(0);
    expectCommandError(
      () => createIdentitySessionRefreshCommand(trapped),
      ['proxy-command-secret'],
    );
    expectCommandError(() => createIdentitySessionRefreshCommand(null));
    expectCommandError(() => createIdentitySessionRefreshCommand([]));
  });

  it.each([
    ['successor id', { successorRefreshCredentialId: 'successor-command-secret' }],
    ['refresh lifetime', { refreshIdleLifetimeSeconds: 899 }],
    ['access id', { issuedAccessCredentialId: 'access-command-secret' }],
    ['access lifetime', { accessLifetimeSeconds: 299 }],
    ['security event id', { securityEventId: 'event-command-secret' }],
  ] as const)('rejects an invalid generated %s before admission', async (_name, overrides) => {
    const attempt = await credentialAttempt();
    const discovery = discoveryTicket();

    expectCommandError(
      () =>
        createIdentitySessionRefreshCommand(
          commandInput(attempt.attempt, discovery.ticket, overrides),
        ),
      Object.values(overrides).filter((value): value is string => typeof value === 'string'),
    );
  });

  it('admits a command and its credential attempt synchronously exactly once', async (): Promise<void> => {
    const attempt = await credentialAttempt();
    const discovery = discoveryTicket();
    const command = createIdentitySessionRefreshCommand(
      commandInput(attempt.attempt, discovery.ticket),
    );
    const boundary = admitIdentitySessionRefreshCommand(command);
    const secondCommand = createIdentitySessionRefreshCommand(
      commandInput(attempt.attempt, discovery.ticket),
    );

    expect(Reflect.ownKeys(boundary.controller)).toEqual([]);
    expect(Reflect.ownKeys(boundary.scope)).toEqual([]);
    expectCommandError(() => admitIdentitySessionRefreshCommand(command));
    expectCommandError(() => admitIdentitySessionRefreshCommand(structuredClone(command)));
    expectCommandError(() => admitIdentitySessionRefreshCommand(secondCommand));

    const context = activateIdentitySessionRefreshCommand(boundary.controller, ROTATED_AT);
    expect(context.scope).toBe(boundary.scope);
    closeIdentitySessionRefreshCommand(boundary.controller);
  });

  it('clears activation material and retires the claimed attempt after invalid writer time', async (): Promise<void> => {
    const attempt = await credentialAttempt();
    const firstDiscovery = discoveryTicket();
    const command = createIdentitySessionRefreshCommand(
      commandInput(attempt.attempt, firstDiscovery.ticket),
    );
    const boundary = admitIdentitySessionRefreshCommand(command);

    expectCommandError(
      () => activateIdentitySessionRefreshCommand(boundary.controller, 'invalid-db-now-secret'),
      ['invalid-db-now-secret'],
    );
    expect(() => {
      closeIdentitySessionRefreshCommand(boundary.controller);
    }).not.toThrow();

    const secondDiscovery = discoveryTicket();
    const replay = createIdentitySessionRefreshCommand(
      commandInput(attempt.attempt, secondDiscovery.ticket),
    );
    expectCommandError(() => admitIdentitySessionRefreshCommand(replay));
  });

  it('binds the exact activated context before the first store call', async (): Promise<void> => {
    const prepared = await prepareCommand();
    const transaction = transactionStore(prepared, 'not-found');

    await expect(
      runIdentitySessionRefreshCommand(
        prepared.boundary.controller,
        structuredClone(prepared.context),
        transaction.store,
      ),
    ).rejects.toBeInstanceOf(InvalidIdentitySessionRefreshCommandError);
    expect(transaction.calls.load).toBe(0);

    const evidence = await runIdentitySessionRefreshCommand(
      prepared.boundary.controller,
      prepared.context,
      transaction.store,
    );
    expect(evidence).toEqual({ kind: 'rejected' });
    closeAndRevokePendingEvidence(prepared, evidence);
  });

  it('turns locked not-found into consumed rejection evidence with no persistence call', async (): Promise<void> => {
    const prepared = await prepareCommand();
    const transaction = transactionStore(prepared, 'not-found');
    const evidence = await runIdentitySessionRefreshCommand(
      prepared.boundary.controller,
      prepared.context,
      transaction.store,
    );

    expect(evidence).toEqual({ kind: 'rejected' });
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(transaction.calls).toMatchObject({ load: 1, rotated: 0, reuseDetected: 0 });
    expect(transaction.calls.loadScope).toBe(prepared.boundary.scope);
    expect(transaction.calls.loadTicket).toBe(prepared.discoveryTicket);
    expect(() =>
      consumeIdentityTransactionPendingEvidence(prepared.boundary.controller, evidence),
    ).toThrow(InvalidIdentitySessionRefreshWorkflowError);
    await expect(
      runIdentitySessionRefreshCommand(
        prepared.boundary.controller,
        prepared.context,
        transaction.store,
      ),
    ).rejects.toBeInstanceOf(InvalidIdentitySessionRefreshCommandError);
    closeAndRevokePendingEvidence(prepared, evidence);
  });

  it('runs only rotation persistence with the exact event and attempt digest identities', async (): Promise<void> => {
    const prepared = await prepareCommand();
    const transaction = transactionStore(prepared, 'rotated');
    const evidence = await runIdentitySessionRefreshCommand(
      prepared.boundary.controller,
      prepared.context,
      transaction.store,
    );

    expect(evidence.kind).toBe('rotated');
    expect(transaction.calls).toMatchObject({ load: 1, rotated: 1, reuseDetected: 0 });
    expect(transaction.calls.rotatedInputFrozen).toBe(true);
    expect(transaction.calls.eventId).toBe(SECURITY_EVENT_ID);
    expect(transaction.calls.rotatedPlan?.accessCredentialDigest).toBe(
      prepared.credentialAttempt.accessCredentialDigest,
    );
    expect(transaction.calls.rotatedPlan?.refreshCredentialDigest).toBe(
      prepared.credentialAttempt.refreshCredentialDigest,
    );
    expect(inspect(evidence, { showHidden: true })).not.toContain(ACCESS_WIRE);
    expect(inspect(evidence, { showHidden: true })).not.toContain(REFRESH_WIRE);
    closeAndRevokePendingEvidence(prepared, evidence);
  });

  it('runs only reuse persistence with no candidate or digest-bearing input', async (): Promise<void> => {
    const prepared = await prepareCommand(REUSE_DETECTED_AT);
    const transaction = transactionStore(prepared, 'reuse-detected');
    const evidence = await runIdentitySessionRefreshCommand(
      prepared.boundary.controller,
      prepared.context,
      transaction.store,
    );

    expect(evidence).toEqual({ kind: 'reuse-detected' });
    expect(transaction.calls).toMatchObject({ load: 1, rotated: 0, reuseDetected: 1 });
    expect(transaction.calls.reuseInputKeys).toEqual(['decision', 'securityEventId']);
    expect(transaction.calls.reuseInputFrozen).toBe(true);
    expect(transaction.calls.eventId).toBe(SECURITY_EVENT_ID);
    expect(inspect(transaction.calls.reuseInputKeys, { showHidden: true })).not.toContain(
      'CredentialDigest',
    );
    closeAndRevokePendingEvidence(prepared, evidence);
  });

  it.each([
    ['load', 'not-found', ROTATED_AT, Object.freeze({ load: 1, rotated: 0, reuseDetected: 0 })],
    [
      'rotated writer',
      'rotated',
      ROTATED_AT,
      Object.freeze({ load: 1, rotated: 1, reuseDetected: 0 }),
    ],
    [
      'reuse writer',
      'reuse-detected',
      REUSE_DETECTED_AT,
      Object.freeze({ load: 1, rotated: 0, reuseDetected: 1 }),
    ],
  ] as const)(
    'makes a rejected %s operation absorbing without invoking an alternate writer',
    async (_stageName, mode, dbNow, expectedCalls): Promise<void> => {
      const prepared = await prepareCommand(dbNow);
      const valid = transactionStore(prepared, mode);
      const rejection = new Error('Expected internal store rejection');
      const calls = { load: 0, rotated: 0, reuseDetected: 0 };
      const rejectLoad = mode === 'not-found';
      const store: IdentitySessionRefreshStore = Object.freeze({
        loadForUpdate(
          scope: IdentityTransactionScope,
          ticket: IdentitySessionRefreshDiscoveryFoundTicket,
        ) {
          calls.load += 1;

          return rejectLoad ? Promise.reject(rejection) : valid.store.loadForUpdate(scope, ticket);
        },
        persistRotated(
          scope: IdentityTransactionScope,
          input: IdentitySessionRefreshRotatedStoreInput,
        ) {
          calls.rotated += 1;

          return mode === 'rotated'
            ? Promise.reject(rejection)
            : valid.store.persistRotated(scope, input);
        },
        persistReuseDetected(
          scope: IdentityTransactionScope,
          input: IdentitySessionRefreshReuseDetectedStoreInput,
        ) {
          calls.reuseDetected += 1;

          return mode === 'reuse-detected'
            ? Promise.reject(rejection)
            : valid.store.persistReuseDetected(scope, input);
        },
      });

      await expect(
        runIdentitySessionRefreshCommand(prepared.boundary.controller, prepared.context, store),
      ).rejects.toBe(rejection);
      expect(calls).toEqual(expectedCalls);
      await expect(
        runIdentitySessionRefreshCommand(prepared.boundary.controller, prepared.context, store),
      ).rejects.toBeInstanceOf(InvalidIdentitySessionRefreshCommandError);
      expect(calls).toEqual(expectedCalls);
      expect(() => {
        closeIdentitySessionRefreshCommand(prepared.boundary.controller);
      }).not.toThrow();
    },
  );

  it('exchanges only the exact rotated completion and original pair for one opaque delivery', async (): Promise<void> => {
    const prepared = await prepareCommand();
    const completion = await committedCompletion(prepared, 'rotated');
    const evidence = completion.evidence;

    if (evidence.kind !== 'rotated') {
      throw new Error('Expected rotated completion fixture');
    }

    const privateValues = [
      ACCESS_WIRE,
      REFRESH_WIRE,
      evidence.principal.actorId,
      evidence.principal.sessionId,
      ...evidence.principal.permissions,
      evidence.accessCredentialIssuedAt,
      evidence.accessCredentialExpiresAt,
      evidence.refreshIdleExpiresAt,
      evidence.refreshAbsoluteExpiresAt,
    ];
    const delivery = createIdentitySessionRefreshCredentialDelivery(
      completion,
      prepared.credentialAttempt.candidates,
    );

    expect(Object.isFrozen(delivery)).toBe(true);
    expect(Reflect.ownKeys(delivery)).toEqual([]);
    expect(String(delivery)).toBe(DELIVERY_REDACTION);
    expect(JSON.stringify(delivery)).toBe(JSON.stringify(DELIVERY_REDACTION));
    const rendered = inspect(delivery, { showHidden: true });
    for (const value of privateValues) {
      expect(rendered).not.toContain(value);
    }

    expect(() => inspectIdentitySessionRefreshCommittedCompletion(completion)).toThrow(
      InvalidIdentitySessionRefreshWorkflowError,
    );
    expectDeliveryError(
      () =>
        createIdentitySessionRefreshCredentialDelivery(
          completion,
          prepared.credentialAttempt.candidates,
        ),
      [ACCESS_WIRE, REFRESH_WIRE],
    );
  });

  it('rejects a frozen outer candidate clone without consuming the rightful pair', async (): Promise<void> => {
    const prepared = await prepareCommand();
    const completion = await committedCompletion(prepared, 'rotated');
    const candidates = prepared.credentialAttempt.candidates;
    const outerClone = Object.freeze({
      access: candidates.access,
      refresh: candidates.refresh,
    }) as unknown as IdentitySessionCredentialCandidates;

    expectDeliveryError(
      () => createIdentitySessionRefreshCredentialDelivery(completion, outerClone),
      [ACCESS_WIRE, REFRESH_WIRE],
    );
    expect(inspectIdentitySessionRefreshCommittedCompletion(completion)).toBe(completion);

    expect(createIdentitySessionRefreshCredentialDelivery(completion, candidates)).toBeDefined();
  });

  it('rejects transparent and hostile pair proxies without observation or sabotage', async (): Promise<void> => {
    const prepared = await prepareCommand();
    const completion = await committedCompletion(prepared, 'rotated');
    const candidates = prepared.credentialAttempt.candidates;
    const transparentProxy = new Proxy(candidates, {});
    const hostileSecret = 'hostile-delivery-pair-secret';
    let trapCalls = 0;
    const hostileProxy = new Proxy(candidates, {
      get(): never {
        trapCalls += 1;
        throw new Error(hostileSecret);
      },
      getOwnPropertyDescriptor(): never {
        trapCalls += 1;
        throw new Error(hostileSecret);
      },
      getPrototypeOf(): never {
        trapCalls += 1;
        throw new Error(hostileSecret);
      },
      ownKeys(): never {
        trapCalls += 1;
        throw new Error(hostileSecret);
      },
    });

    for (const proxy of [transparentProxy, hostileProxy]) {
      expectDeliveryError(
        () => createIdentitySessionRefreshCredentialDelivery(completion, proxy),
        [ACCESS_WIRE, REFRESH_WIRE, hostileSecret],
      );
      expect(inspectIdentitySessionRefreshCommittedCompletion(completion)).toBe(completion);
    }

    expect(trapCalls).toBe(0);
    expect(createIdentitySessionRefreshCredentialDelivery(completion, candidates)).toBeDefined();
  });

  it('rejects crossed authentic completion and candidate pairs without consuming either owner', async (): Promise<void> => {
    const first = await prepareCommand();
    const second = await prepareCommand();
    const firstCompletion = await committedCompletion(first, 'rotated');
    const secondCompletion = await committedCompletion(second, 'rotated');

    expectDeliveryError(() =>
      createIdentitySessionRefreshCredentialDelivery(
        firstCompletion,
        second.credentialAttempt.candidates,
      ),
    );
    expectDeliveryError(() =>
      createIdentitySessionRefreshCredentialDelivery(
        secondCompletion,
        first.credentialAttempt.candidates,
      ),
    );
    expect(inspectIdentitySessionRefreshCommittedCompletion(firstCompletion)).toBe(firstCompletion);
    expect(inspectIdentitySessionRefreshCommittedCompletion(secondCompletion)).toBe(
      secondCompletion,
    );

    expect(
      createIdentitySessionRefreshCredentialDelivery(
        firstCompletion,
        first.credentialAttempt.candidates,
      ),
    ).toBeDefined();
    expect(
      createIdentitySessionRefreshCredentialDelivery(
        secondCompletion,
        second.credentialAttempt.candidates,
      ),
    ).toBeDefined();
  });

  it.each([
    ['rejected', 'not-found', ROTATED_AT],
    ['reuse', 'reuse-detected', REUSE_DETECTED_AT],
  ] as const)(
    'refuses %s committed completions without consuming their registration',
    async (_branch, mode, dbNow): Promise<void> => {
      const prepared = await prepareCommand(dbNow);
      const completion = await committedCompletion(prepared, mode);

      expectDeliveryError(
        () =>
          createIdentitySessionRefreshCredentialDelivery(
            completion,
            prepared.credentialAttempt.candidates,
          ),
        [ACCESS_WIRE, REFRESH_WIRE],
      );
      expect(inspectIdentitySessionRefreshCommittedCompletion(completion)).toBe(completion);
    },
  );

  it('rejects authentic pending evidence without preventing later close, promotion, and delivery', async (): Promise<void> => {
    const prepared = await prepareCommand();
    const evidence = await runIdentitySessionRefreshCommand(
      prepared.boundary.controller,
      prepared.context,
      transactionStore(prepared, 'rotated').store,
    );
    const candidates = prepared.credentialAttempt.candidates;

    expectDeliveryError(
      () => createIdentitySessionRefreshCredentialDelivery(evidence, candidates),
      [ACCESS_WIRE, REFRESH_WIRE],
    );
    closeIdentitySessionRefreshCommand(prepared.boundary.controller);
    const completion = promoteIdentityTransactionPendingEvidence(
      prepared.boundary.controller,
      evidence,
    );

    expect(completion).toBeDefined();
    expect(createIdentitySessionRefreshCredentialDelivery(completion, candidates)).toBeDefined();
  });

  it('rejects forged, cloned, and hostile completion values cause-free without observation or mutation', async (): Promise<void> => {
    const prepared = await prepareCommand();
    const completion = await committedCompletion(prepared, 'rotated');
    const forgedCompletion = Object.freeze({
      kind: 'committed',
      evidence: completion.evidence,
    });
    const clonedCompletion = structuredClone(completion);
    let trapCalls = 0;
    const hostileSecret = 'hostile-delivery-completion-secret';
    const hostileCompletion = new Proxy(completion, {
      get(): never {
        trapCalls += 1;
        throw new Error(hostileSecret);
      },
      getPrototypeOf(): never {
        trapCalls += 1;
        throw new Error(hostileSecret);
      },
      ownKeys(): never {
        trapCalls += 1;
        throw new Error(hostileSecret);
      },
    });
    const candidates = prepared.credentialAttempt.candidates;

    expectDeliveryError(
      () => createIdentitySessionRefreshCredentialDelivery(forgedCompletion, candidates),
      [ACCESS_WIRE, REFRESH_WIRE],
    );
    expectDeliveryError(
      () => createIdentitySessionRefreshCredentialDelivery(clonedCompletion, candidates),
      [ACCESS_WIRE, REFRESH_WIRE],
    );
    expectDeliveryError(
      () => createIdentitySessionRefreshCredentialDelivery(hostileCompletion, candidates),
      [ACCESS_WIRE, REFRESH_WIRE, hostileSecret],
    );
    expect(trapCalls).toBe(0);
    expect(inspectIdentitySessionRefreshCommittedCompletion(completion)).toBe(completion);

    expect(createIdentitySessionRefreshCredentialDelivery(completion, candidates)).toBeDefined();
  });

  it('rejects store getter and method reentry without starting another command path', async (): Promise<void> => {
    const prepared = await prepareCommand();
    const valid = transactionStore(prepared, 'not-found');
    const reentryOutcomes: Promise<unknown>[] = [];
    let getterReads = 0;
    let methodCalls = 0;
    const storeRecord: Record<string, unknown> = {
      persistRotated: valid.store.persistRotated.bind(valid.store),
      persistReuseDetected: valid.store.persistReuseDetected.bind(valid.store),
    };
    Object.defineProperty(storeRecord, 'loadForUpdate', {
      enumerable: true,
      configurable: false,
      get() {
        getterReads += 1;
        reentryOutcomes.push(
          runIdentitySessionRefreshCommand(
            prepared.boundary.controller,
            prepared.context,
            store,
          ).catch((error: unknown) => error),
        );

        return (
          scope: IdentityTransactionScope,
          ticket: IdentitySessionRefreshDiscoveryFoundTicket,
        ) => {
          methodCalls += 1;
          reentryOutcomes.push(
            runIdentitySessionRefreshCommand(
              prepared.boundary.controller,
              prepared.context,
              store,
            ).catch((error: unknown) => error),
          );
          return valid.store.loadForUpdate(scope, ticket);
        };
      },
    });
    const store = Object.freeze(storeRecord) as unknown as IdentitySessionRefreshStore;

    const evidence = await runIdentitySessionRefreshCommand(
      prepared.boundary.controller,
      prepared.context,
      store,
    );
    expect(evidence).toEqual({ kind: 'rejected' });
    expect(getterReads).toBe(1);
    expect(methodCalls).toBe(1);
    expect(reentryOutcomes).toHaveLength(2);
    for (const outcome of reentryOutcomes) {
      await expect(outcome).resolves.toBeInstanceOf(InvalidIdentitySessionRefreshCommandError);
    }
    expect(valid.calls).toMatchObject({ load: 1, rotated: 0, reuseDetected: 0 });
    await expect(
      runIdentitySessionRefreshCommand(prepared.boundary.controller, prepared.context, store),
    ).rejects.toBeInstanceOf(InvalidIdentitySessionRefreshCommandError);
    expect(getterReads).toBe(1);
    expect(methodCalls).toBe(1);
    closeAndRevokePendingEvidence(prepared, evidence);
  });

  it('fails closed on forged writer evidence and cannot switch to another terminal branch', async (): Promise<void> => {
    const prepared = await prepareCommand();
    const valid = transactionStore(prepared, 'rotated');
    const forgedStore: IdentitySessionRefreshStore = Object.freeze({
      loadForUpdate: valid.store.loadForUpdate.bind(valid.store),
      persistRotated(): Promise<never> {
        return Promise.resolve(Object.freeze({ kind: 'rotated' }) as unknown as never);
      },
      persistReuseDetected(): Promise<never> {
        throw new Error('Unexpected reuse persistence');
      },
    });

    await expect(
      runIdentitySessionRefreshCommand(prepared.boundary.controller, prepared.context, forgedStore),
    ).rejects.toBeInstanceOf(InvalidIdentitySessionRefreshWorkflowError);
    await expect(
      runIdentitySessionRefreshCommand(prepared.boundary.controller, prepared.context, valid.store),
    ).rejects.toBeInstanceOf(InvalidIdentitySessionRefreshCommandError);
    closeIdentitySessionRefreshCommand(prepared.boundary.controller);
  });

  it('refuses scope closure while orchestration is still in flight', async (): Promise<void> => {
    const prepared = await prepareCommand();
    const valid = transactionStore(prepared, 'not-found');
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const delayedStore: IdentitySessionRefreshStore = Object.freeze({
      async loadForUpdate(
        scope: IdentityTransactionScope,
        ticket: IdentitySessionRefreshDiscoveryFoundTicket,
      ) {
        const result = await valid.store.loadForUpdate(scope, ticket);
        await gate;
        return result;
      },
      persistRotated: valid.store.persistRotated.bind(valid.store),
      persistReuseDetected: valid.store.persistReuseDetected.bind(valid.store),
    });
    const running = runIdentitySessionRefreshCommand(
      prepared.boundary.controller,
      prepared.context,
      delayedStore,
    );

    expectCommandError(() => {
      closeIdentitySessionRefreshCommand(prepared.boundary.controller);
    });
    release?.();
    const evidence = await running;
    expect(evidence).toEqual({ kind: 'rejected' });
    closeAndRevokePendingEvidence(prepared, evidence);
  });

  it('promotes only consumed evidence after scope close into one distinct committed completion', async (): Promise<void> => {
    const prepared = await prepareCommand();
    const transaction = transactionStore(prepared, 'rotated');
    const evidence = await runIdentitySessionRefreshCommand(
      prepared.boundary.controller,
      prepared.context,
      transaction.store,
    );

    expect(promoteIdentityTransactionPendingEvidence(prepared.boundary.controller, evidence)).toBe(
      undefined,
    );
    expect(revokeIdentityTransactionPendingEvidence(prepared.boundary.controller, evidence)).toBe(
      false,
    );

    closeIdentitySessionRefreshCommand(prepared.boundary.controller);
    const completion = promoteIdentityTransactionPendingEvidence(
      prepared.boundary.controller,
      evidence,
    );

    expect(completion).toEqual({ kind: 'committed', evidence });
    expect(completion).not.toBe(evidence);
    expect(completion?.evidence).toBe(evidence);
    expect(Reflect.ownKeys(completion ?? {})).toEqual(['kind', 'evidence']);
    expect(Object.isFrozen(completion)).toBe(true);
    expect(inspectIdentitySessionRefreshCommittedCompletion(completion)).toBe(completion);
    expect(promoteIdentityTransactionPendingEvidence(prepared.boundary.controller, evidence)).toBe(
      undefined,
    );
    expect(revokeIdentityTransactionPendingEvidence(prepared.boundary.controller, evidence)).toBe(
      false,
    );
    expect(() => inspectIdentitySessionRefreshCommittedCompletion(evidence)).toThrow(
      InvalidIdentitySessionRefreshWorkflowError,
    );
    expect(() =>
      inspectIdentitySessionRefreshCommittedCompletion(structuredClone(completion)),
    ).toThrow(InvalidIdentitySessionRefreshWorkflowError);

    const replayDiscovery = discoveryTicket();
    const replay = createIdentitySessionRefreshCommand(
      commandInput(prepared.credentialAttempt.attempt, replayDiscovery.ticket),
    );
    expectCommandError(() => admitIdentitySessionRefreshCommand(replay));
  });

  it('keeps foreign and hostile settlement values non-throwing without sabotaging rightful owners', async (): Promise<void> => {
    const first = await prepareCommand();
    const second = await prepareCommand();
    const firstEvidence = await runIdentitySessionRefreshCommand(
      first.boundary.controller,
      first.context,
      transactionStore(first, 'not-found').store,
    );
    const secondEvidence = await runIdentitySessionRefreshCommand(
      second.boundary.controller,
      second.context,
      transactionStore(second, 'not-found').store,
    );
    closeIdentitySessionRefreshCommand(first.boundary.controller);
    closeIdentitySessionRefreshCommand(second.boundary.controller);

    let trapCalls = 0;
    const hostileEvidence = new Proxy(firstEvidence, {
      get(): never {
        trapCalls += 1;
        throw new Error('hostile-settlement-secret');
      },
      ownKeys(): never {
        trapCalls += 1;
        throw new Error('hostile-settlement-secret');
      },
    });
    const hostileController = new Proxy(first.boundary.controller, {
      get(): never {
        trapCalls += 1;
        throw new Error('hostile-settlement-secret');
      },
      ownKeys(): never {
        trapCalls += 1;
        throw new Error('hostile-settlement-secret');
      },
    });

    expect(
      promoteIdentityTransactionPendingEvidence(first.boundary.controller, secondEvidence),
    ).toBe(undefined);
    expect(
      revokeIdentityTransactionPendingEvidence(second.boundary.controller, firstEvidence),
    ).toBe(false);
    expect(
      promoteIdentityTransactionPendingEvidence(first.boundary.controller, hostileEvidence),
    ).toBe(undefined);
    expect(
      revokeIdentityTransactionPendingEvidence(first.boundary.controller, hostileEvidence),
    ).toBe(false);
    expect(promoteIdentityTransactionPendingEvidence(hostileController, firstEvidence)).toBe(
      undefined,
    );
    expect(revokeIdentityTransactionPendingEvidence(hostileController, firstEvidence)).toBe(false);
    expect(trapCalls).toBe(0);

    const completion = promoteIdentityTransactionPendingEvidence(
      first.boundary.controller,
      firstEvidence,
    );
    expect(completion).toEqual({ kind: 'committed', evidence: firstEvidence });
    const hostileCompletion = new Proxy(completion ?? Object.freeze({}), {
      get(): never {
        trapCalls += 1;
        throw new Error('hostile-settlement-secret');
      },
      ownKeys(): never {
        trapCalls += 1;
        throw new Error('hostile-settlement-secret');
      },
    });
    expect(() => inspectIdentitySessionRefreshCommittedCompletion(hostileCompletion)).toThrow(
      InvalidIdentitySessionRefreshWorkflowError,
    );
    expect(trapCalls).toBe(0);
    expect(
      revokeIdentityTransactionPendingEvidence(second.boundary.controller, secondEvidence),
    ).toBe(true);
  });

  it.each([
    ['rejected', 'not-found', ROTATED_AT],
    ['reuse', 'reuse-detected', REUSE_DETECTED_AT],
  ] as const)(
    'promotes %s evidence without retaining credential delivery eligibility',
    async (_branch, mode, dbNow): Promise<void> => {
      const prepared = await prepareCommand(dbNow);
      const evidence = await runIdentitySessionRefreshCommand(
        prepared.boundary.controller,
        prepared.context,
        transactionStore(prepared, mode).store,
      );
      closeIdentitySessionRefreshCommand(prepared.boundary.controller);

      const completion = promoteIdentityTransactionPendingEvidence(
        prepared.boundary.controller,
        evidence,
      );

      expect(completion).toEqual({ kind: 'committed', evidence });
      expect(completion?.evidence).toBe(evidence);
      expect(inspectIdentitySessionRefreshCommittedCompletion(completion)).toBe(completion);
      expect(inspect(completion, { showHidden: true })).not.toContain(ACCESS_WIRE);
      expect(inspect(completion, { showHidden: true })).not.toContain(REFRESH_WIRE);

      const retryDiscovery = discoveryTicket();
      const retry = createIdentitySessionRefreshCommand(
        commandInput(prepared.credentialAttempt.attempt, retryDiscovery.ticket),
      );
      expectCommandError(() => admitIdentitySessionRefreshCommand(retry));
    },
  );

  it.each([
    ['rejected', 'not-found', ROTATED_AT],
    ['rotated', 'rotated', ROTATED_AT],
    ['reuse', 'reuse-detected', REUSE_DETECTED_AT],
  ] as const)(
    'revokes %s evidence once and never permits later promotion',
    async (_branch, mode, dbNow): Promise<void> => {
      const prepared = await prepareCommand(dbNow);
      const evidence = await runIdentitySessionRefreshCommand(
        prepared.boundary.controller,
        prepared.context,
        transactionStore(prepared, mode).store,
      );
      closeIdentitySessionRefreshCommand(prepared.boundary.controller);

      expect(revokeIdentityTransactionPendingEvidence(prepared.boundary.controller, evidence)).toBe(
        true,
      );
      expect(revokeIdentityTransactionPendingEvidence(prepared.boundary.controller, evidence)).toBe(
        false,
      );
      expect(
        promoteIdentityTransactionPendingEvidence(prepared.boundary.controller, evidence),
      ).toBe(undefined);
    },
  );

  it('settles with the WeakMap intrinsics captured before later prototype mutation', async (): Promise<void> => {
    const promoted = await prepareCommand();
    const revoked = await prepareCommand();
    const promotedEvidence = await runIdentitySessionRefreshCommand(
      promoted.boundary.controller,
      promoted.context,
      transactionStore(promoted, 'rotated').store,
    );
    const revokedEvidence = await runIdentitySessionRefreshCommand(
      revoked.boundary.controller,
      revoked.context,
      transactionStore(revoked, 'not-found').store,
    );
    closeIdentitySessionRefreshCommand(promoted.boundary.controller);
    closeIdentitySessionRefreshCommand(revoked.boundary.controller);

    const getDescriptor = Object.getOwnPropertyDescriptor(WeakMap.prototype, 'get');
    const setDescriptor = Object.getOwnPropertyDescriptor(WeakMap.prototype, 'set');
    const deleteDescriptor = Object.getOwnPropertyDescriptor(WeakMap.prototype, 'delete');

    if (
      getDescriptor === undefined ||
      setDescriptor === undefined ||
      deleteDescriptor === undefined
    ) {
      throw new Error('Expected WeakMap intrinsic descriptors');
    }

    let mutationCalls = 0;
    let completion: ReturnType<typeof promoteIdentityTransactionPendingEvidence>;
    let revokedResult: boolean;
    const mutatedIntrinsic = (): never => {
      mutationCalls += 1;
      throw new Error('mutated-weak-map-intrinsic');
    };

    try {
      Object.defineProperties(WeakMap.prototype, {
        get: { ...getDescriptor, value: mutatedIntrinsic },
        set: { ...setDescriptor, value: mutatedIntrinsic },
        delete: { ...deleteDescriptor, value: mutatedIntrinsic },
      });
      completion = promoteIdentityTransactionPendingEvidence(
        promoted.boundary.controller,
        promotedEvidence,
      );
      revokedResult = revokeIdentityTransactionPendingEvidence(
        revoked.boundary.controller,
        revokedEvidence,
      );
    } finally {
      Object.defineProperties(WeakMap.prototype, {
        get: getDescriptor,
        set: setDescriptor,
        delete: deleteDescriptor,
      });
    }

    expect(completion).toEqual({ kind: 'committed', evidence: promotedEvidence });
    expect(revokedResult).toBe(true);
    expect(mutationCalls).toBe(0);
  });

  it('keeps the command, store, and delivery gate absent from the supported package surface', (): void => {
    expect(identityPublicApi).not.toHaveProperty('createIdentitySessionRefreshCommand');
    expect(identityPublicApi).not.toHaveProperty('runIdentitySessionRefreshCommand');
    expect(identityPublicApi).not.toHaveProperty('InvalidIdentitySessionRefreshCommandError');
    expect(identityPublicApi).not.toHaveProperty('promoteIdentityTransactionPendingEvidence');
    expect(identityPublicApi).not.toHaveProperty(
      'inspectIdentitySessionRefreshCommittedCompletion',
    );
    expect(identityPublicApi).not.toHaveProperty(
      'consumeIdentitySessionRefreshCommittedCredentialPair',
    );
    expect(identityPublicApi).not.toHaveProperty('createIdentitySessionRefreshCredentialDelivery');
    expect(identityPublicApi).not.toHaveProperty(
      'InvalidIdentitySessionRefreshCredentialDeliveryError',
    );
  });
});
