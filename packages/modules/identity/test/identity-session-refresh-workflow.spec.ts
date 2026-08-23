import { inspect } from 'node:util';

import {
  activateIdentitySessionRefreshWorkflow,
  beginIdentitySessionRefreshLockedLoad,
  beginIdentitySessionRefreshReusePersistence,
  beginIdentitySessionRefreshRotatedPersistence,
  closeIdentitySessionRefreshWorkflow,
  completeIdentitySessionRefreshLockedLoadFound,
  completeIdentitySessionRefreshLockedLoadNotFound,
  completeIdentitySessionRefreshRejected,
  completeIdentitySessionRefreshReusePersistence,
  completeIdentitySessionRefreshRotatedPersistence,
  consumeIdentityTransactionPendingEvidence,
  createIdentitySessionRefreshWorkflow,
  createIdentitySessionRefreshAttemptBoundWorkflow,
  decideIdentitySessionRefresh,
  failIdentitySessionRefreshPersistence,
  failIdentitySessionRefreshLockedLoad,
  inspectIdentitySessionRefreshReusePersistence,
  inspectIdentitySessionRefreshReuseDetectedDecision,
  inspectIdentitySessionRefreshRotatedPersistence,
  inspectIdentitySessionRefreshRotatedDecision,
  InvalidIdentitySessionRefreshWorkflowError,
  promoteIdentityTransactionPendingEvidence,
  revokeIdentityTransactionPendingEvidence,
  type IdentitySessionRefreshDecision,
  type IdentitySessionRefreshDecisionInput,
} from '../src/application/identity-session-refresh-workflow';
import { InvalidIdentityAuthenticatedPrincipalError } from '../src/application/identity-authenticated-principal.errors';
import {
  createIdentitySessionCredentialAttempt,
  retireIdentitySessionCredentialAttempt,
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
import { InvalidIdentitySessionCredentialCandidatesError } from '../src/application/identity-session-credential.errors';
import {
  parseIdentityAccessCredentialWireValue,
  parseIdentityRefreshCredentialWireValue,
} from '../src/application/identity-session-credential-wire.values';
import {
  consumeIdentitySessionRefreshDiscoveryFoundTicket,
  createIdentitySessionRefreshDiscoveryBoundaryAuthority,
  createIdentitySessionRefreshDiscoveryFoundTicket,
  InvalidIdentitySessionRefreshDiscoveryTicketError,
} from '../src/application/identity-session-refresh-discovery';
import * as identityPublicApi from '../src';
import { IdentityAccount } from '../src/domain/identity-account';
import { IdentityAccessCredential } from '../src/domain/identity-access-credential';
import { IdentityRefreshCredential } from '../src/domain/identity-refresh-credential';
import { InvalidIdentityRefreshCredentialIdError } from '../src/domain/identity-refresh-credential.values';
import { InvalidIdentitySessionFamilyRefreshStateError } from '../src/domain/identity-session-family.errors';
import { IdentitySessionFamily } from '../src/domain/identity-session-family';
import { InvalidIdentityInstantError } from '../src/domain/identity-values';
import { InvalidIdentitySecurityEventIdError } from '../src/application/identity-security-event.values';
import type {
  // @ts-expect-error Refresh workflow capabilities remain package-internal.
  IdentitySessionRefreshDecision as LeakedIdentitySessionRefreshDecision,
  // @ts-expect-error Pending transaction evidence remains package-internal.
  IdentityTransactionEvidence as LeakedIdentityTransactionEvidence,
} from '../src';

const ACCOUNT_ID = '01890f3a-8bcd-7def-8abc-0123456789ab';
const OTHER_ACCOUNT_ID = '01890f3a-8bcd-7def-9abc-0123456789ab';
const SESSION_ID = '01890f3a-8bcd-7def-aabc-0123456789ab';
const OTHER_SESSION_ID = '01890f3a-8bcd-7def-babc-0123456789ab';
const CREDENTIAL_ID = '01890f3a-8bcd-7def-8bcd-0123456789ab';
const SUCCESSOR_CREDENTIAL_ID = '01890f3a-8bcd-7def-9bcd-0123456789ab';
const ACCESS_CREDENTIAL_ID = '01890f3a-8bcd-7def-abcd-0123456789ab';
const OTHER_ACCESS_CREDENTIAL_ID = '01890f3a-8bcd-7def-bbcd-0123456789ab';
const SECURITY_EVENT_ID = '01890f3a-8bcd-7def-8cde-0123456789ab';
const OTHER_SECURITY_EVENT_ID = '01890f3a-8bcd-7def-9cde-0123456789ab';
const ACCOUNT_CREATED_AT = '2026-08-23T09:00:00.000001Z';
const FAMILY_CREATED_AT = '2026-08-23T10:00:00.000001Z';
const INITIAL_IDLE_EXPIRES_AT = '2026-08-23T10:15:00.000001Z';
const ABSOLUTE_EXPIRES_AT = '2026-08-24T10:00:00.000001Z';
const ROTATED_AT = '2026-08-23T10:05:00.000002Z';
const REUSE_DETECTED_AT = '2026-08-23T10:06:00.000003Z';
const WORKFLOW_ERROR_MESSAGE = 'Expected a valid Identity session refresh workflow transition';
const ACCESS_WIRE = `oms_at_v1_${'A'.repeat(42)}E`;
const REFRESH_WIRE = `oms_rt_v1_${'E'.repeat(42)}M`;

type ErrorClass = abstract new (...arguments_: never[]) => Error;
type CommandReadCounts = Record<keyof IdentitySessionRefreshDecisionInput, number>;

void (undefined as unknown as LeakedIdentitySessionRefreshDecision);
void (undefined as unknown as LeakedIdentityTransactionEvidence);

function account(overrides: Readonly<Record<string, unknown>> = {}): IdentityAccount {
  return IdentityAccount.rehydrate({
    id: ACCOUNT_ID,
    loginName: 'system.admin',
    status: 'ACTIVE',
    version: 1,
    createdAt: ACCOUNT_CREATED_AT,
    updatedAt: ACCOUNT_CREATED_AT,
    suspendedAt: null,
    deactivatedAt: null,
    ...overrides,
  });
}

function sessionFamily(overrides: Readonly<Record<string, unknown>> = {}): IdentitySessionFamily {
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
    ...overrides,
  });
}

function refreshCredential(
  overrides: Readonly<Record<string, unknown>> = {},
): IdentityRefreshCredential {
  return IdentityRefreshCredential.rehydrate({
    id: CREDENTIAL_ID,
    sessionId: SESSION_ID,
    sequence: 1,
    issuedAt: FAMILY_CREATED_AT,
    expiresAt: INITIAL_IDLE_EXPIRES_AT,
    consumedAt: null,
    successorId: null,
    ...overrides,
  });
}

function digest(fill = 23) {
  const value = new Uint8Array(32);
  value.fill(fill);
  return createIdentityRefreshCredentialDigestFromBytes(value);
}

function bytes(fill: number): Uint8Array<ArrayBuffer> {
  const value = new Uint8Array(32);
  value.fill(fill);
  return value;
}

type AuthenticCredentialAttempt = Readonly<{
  attempt: Awaited<ReturnType<typeof createIdentitySessionCredentialAttempt>>;
  candidates: IdentitySessionCredentialCandidates;
  accessCredentialDigest: IdentityAccessCredentialDigest;
  refreshCredentialDigest: IdentityRefreshCredentialDigest;
}>;

async function authenticCredentialAttempt(
  accessFill = 31,
  refreshFill = 32,
): Promise<AuthenticCredentialAttempt> {
  const accessCredentialDigest = createIdentityAccessCredentialDigestFromBytes(bytes(accessFill));
  const refreshCredentialDigest = createIdentityRefreshCredentialDigestFromBytes(
    bytes(refreshFill),
  );
  const accessWireValue = parseIdentityAccessCredentialWireValue(ACCESS_WIRE);
  const refreshWireValue = parseIdentityRefreshCredentialWireValue(REFRESH_WIRE);
  const candidates = createIdentitySessionCredentialCandidates({
    access: { wireValue: accessWireValue, digest: accessCredentialDigest },
    refresh: { wireValue: refreshWireValue, digest: refreshCredentialDigest },
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

function authorityProjection(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    actorId: ACCOUNT_ID,
    sessionId: SESSION_ID,
    activeRoleCount: 1,
    permissions: ['catalog.products.read'],
    ...overrides,
  };
}

function discoveryTicket(
  authority = createIdentitySessionRefreshDiscoveryBoundaryAuthority(),
  fill = 23,
) {
  return {
    authority,
    ticket: createIdentitySessionRefreshDiscoveryFoundTicket(authority, digest(fill), {
      accountId: ACCOUNT_ID,
      sessionId: SESSION_ID,
      presentedRefreshCredentialId: CREDENTIAL_ID,
    }),
  };
}

function activeWorkflow(dbNow: string = ROTATED_AT) {
  const boundary = createIdentitySessionRefreshWorkflow();
  const context = activateIdentitySessionRefreshWorkflow(boundary.controller);
  return { boundary, context, dbNow };
}

function beginLoad(dbNow: string = ROTATED_AT) {
  const workflow = activeWorkflow(dbNow);
  const discovery = discoveryTicket();
  const operation = beginIdentitySessionRefreshLockedLoad(
    workflow.boundary.controller,
    workflow.context.scope,
    discovery.authority,
    discovery.ticket,
  );
  return { ...workflow, ...discovery, operation };
}

function foundLoad(
  dbNow: string = ROTATED_AT,
  loadedAccount = account(),
  loadedFamily = sessionFamily(),
  loadedCredential = refreshCredential(),
) {
  const workflow = beginLoad(dbNow);
  const load = completeIdentitySessionRefreshLockedLoadFound(
    workflow.boundary.controller,
    workflow.operation,
    loadedAccount,
    loadedFamily,
    loadedCredential,
    dbNow,
  );
  return {
    ...workflow,
    load,
    loadedAccount,
    loadedFamily,
    loadedCredential,
  };
}

async function attemptBoundBeginLoad(dbNow: string = ROTATED_AT) {
  const credentialAttempt = await authenticCredentialAttempt();
  const boundary = createIdentitySessionRefreshAttemptBoundWorkflow(credentialAttempt.attempt);
  const context = activateIdentitySessionRefreshWorkflow(boundary.controller);
  const authority = createIdentitySessionRefreshDiscoveryBoundaryAuthority();
  const ticket = createIdentitySessionRefreshDiscoveryFoundTicket(authority, digest(), {
    accountId: ACCOUNT_ID,
    sessionId: SESSION_ID,
    presentedRefreshCredentialId: CREDENTIAL_ID,
  });
  const operation = beginIdentitySessionRefreshLockedLoad(
    boundary.controller,
    context.scope,
    authority,
    ticket,
  );

  return { ...credentialAttempt, boundary, context, authority, ticket, operation, dbNow };
}

async function attemptBoundFoundLoad(
  dbNow: string = ROTATED_AT,
  loadedAccount = account(),
  loadedFamily = sessionFamily(),
  loadedCredential = refreshCredential(),
) {
  const workflow = await attemptBoundBeginLoad(dbNow);
  const load = completeIdentitySessionRefreshLockedLoadFound(
    workflow.boundary.controller,
    workflow.operation,
    loadedAccount,
    loadedFamily,
    loadedCredential,
    dbNow,
  );

  return {
    ...workflow,
    load,
    loadedAccount,
    loadedFamily,
    loadedCredential,
  };
}

function command(): IdentitySessionRefreshDecisionInput {
  return Object.freeze({
    successorRefreshCredentialId: SUCCESSOR_CREDENTIAL_ID,
    refreshIdleLifetimeSeconds: 900,
    issuedAccessCredentialId: ACCESS_CREDENTIAL_ID,
    accessLifetimeSeconds: 300,
  });
}

function trackedCommand(
  values: IdentitySessionRefreshDecisionInput = command(),
): Readonly<{ input: IdentitySessionRefreshDecisionInput; reads: CommandReadCounts }> {
  const reads: CommandReadCounts = {
    successorRefreshCredentialId: 0,
    refreshIdleLifetimeSeconds: 0,
    issuedAccessCredentialId: 0,
    accessLifetimeSeconds: 0,
  };
  const input = {} as Record<keyof IdentitySessionRefreshDecisionInput, unknown>;

  for (const key of Object.keys(reads) as (keyof IdentitySessionRefreshDecisionInput)[]) {
    Object.defineProperty(input, key, {
      enumerable: true,
      configurable: true,
      get(): unknown {
        reads[key] += 1;
        return values[key];
      },
    });
  }

  return Object.freeze({
    input: Object.freeze(input),
    reads,
  });
}

function trappedCommand(): Readonly<{
  input: IdentitySessionRefreshDecisionInput;
  trapCalls: () => number;
}> {
  let calls = 0;
  const fail = (): never => {
    calls += 1;
    throw new Error('issuance-input-trap-secret');
  };
  const input = new Proxy(command(), {
    get: fail,
    getOwnPropertyDescriptor: fail,
    getPrototypeOf: fail,
    isExtensible: fail,
    ownKeys: fail,
  });

  return Object.freeze({ input, trapCalls: (): number => calls });
}

function noCommandReads(): CommandReadCounts {
  return {
    successorRefreshCredentialId: 0,
    refreshIdleLifetimeSeconds: 0,
    issuedAccessCredentialId: 0,
    accessLifetimeSeconds: 0,
  };
}

function assertDecisionKind<Kind extends IdentitySessionRefreshDecision['kind']>(
  decision: IdentitySessionRefreshDecision,
  kind: Kind,
): asserts decision is Extract<IdentitySessionRefreshDecision, Readonly<{ kind: Kind }>> {
  expect(decision.kind).toBe(kind);

  if (decision.kind !== kind) {
    throw new Error('Unexpected Identity session refresh decision kind');
  }
}

function captureError(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }

  throw new Error('Expected action to throw');
}

function expectFixedError(
  action: () => unknown,
  ErrorType: ErrorClass = InvalidIdentitySessionRefreshWorkflowError,
  message = WORKFLOW_ERROR_MESSAGE,
  forbidden: readonly string[] = [],
): void {
  const error = captureError(action);
  expect(error).toBeInstanceOf(ErrorType);
  expect(error).toMatchObject({ name: ErrorType.name, message });
  expect(error).not.toHaveProperty('cause');

  const rendered = inspect(error, { showHidden: true });
  for (const value of forbidden) {
    expect(rendered).not.toContain(value);
  }
}

describe('Identity refresh workflow boundary', (): void => {
  it('creates distinct empty capabilities and activates one exact frozen context', (): void => {
    const boundary = createIdentitySessionRefreshWorkflow();

    expect(boundary).toEqual({ controller: boundary.controller, scope: boundary.scope });
    expect(Object.keys(boundary)).toEqual(['controller', 'scope']);
    expect(Reflect.ownKeys(boundary.controller)).toEqual([]);
    expect(Reflect.ownKeys(boundary.scope)).toEqual([]);
    expect(boundary.controller).not.toBe(boundary.scope);
    expect(Object.isFrozen(boundary)).toBe(true);
    expect(Object.isFrozen(boundary.controller)).toBe(true);
    expect(Object.isFrozen(boundary.scope)).toBe(true);

    const context = activateIdentitySessionRefreshWorkflow(boundary.controller);
    expect(context).toEqual({ scope: boundary.scope });
    expect(Reflect.ownKeys(context)).toEqual(['scope']);
    expect(Object.isFrozen(context)).toBe(true);
    expectFixedError(() => activateIdentitySessionRefreshWorkflow(boundary.controller));
  });

  it('fails an authentic invalid post-lock writer time permanently while preserving the domain error', (): void => {
    const workflow = beginLoad();

    expectFixedError(
      () =>
        completeIdentitySessionRefreshLockedLoadNotFound(
          workflow.boundary.controller,
          workflow.operation,
          'writer-time-secret',
        ),
      InvalidIdentityInstantError,
      'Expected a valid UTC Identity instant with exactly six fractional digits',
      ['writer-time-secret'],
    );
    expectFixedError(() =>
      completeIdentitySessionRefreshLockedLoadNotFound(
        workflow.boundary.controller,
        workflow.operation,
        ROTATED_AT,
      ),
    );
  });

  it('invalidates escaped context and scope capabilities before settlement', (): void => {
    const { boundary, context } = activeWorkflow();
    const discovery = discoveryTicket();

    closeIdentitySessionRefreshWorkflow(boundary.controller);
    expectFixedError(() =>
      beginIdentitySessionRefreshLockedLoad(
        boundary.controller,
        context.scope,
        discovery.authority,
        discovery.ticket,
      ),
    );
    expectFixedError((): void => {
      closeIdentitySessionRefreshWorkflow(boundary.controller);
    });
  });

  it('remains absent from the package root', (): void => {
    expect(identityPublicApi).not.toHaveProperty('createIdentitySessionRefreshWorkflow');
    expect(identityPublicApi).not.toHaveProperty('decideIdentitySessionRefresh');
  });
});

describe('Identity refresh locked-load registration', (): void => {
  it('consumes one discovery ticket before returning its exact query binding', (): void => {
    const workflow = beginLoad();

    expect(workflow.operation).toEqual({
      refreshCredentialDigest: workflow.operation.refreshCredentialDigest,
      accountId: ACCOUNT_ID,
      sessionId: SESSION_ID,
      presentedRefreshCredentialId: CREDENTIAL_ID,
    });
    expect(Object.keys(workflow.operation)).toEqual([
      'refreshCredentialDigest',
      'accountId',
      'sessionId',
      'presentedRefreshCredentialId',
    ]);
    expect(Object.isFrozen(workflow.operation)).toBe(true);
    expectFixedError(
      () => consumeIdentitySessionRefreshDiscoveryFoundTicket(workflow.authority, workflow.ticket),
      InvalidIdentitySessionRefreshDiscoveryTicketError,
      'Expected a valid Identity session refresh discovery ticket',
    );
    expectFixedError(() =>
      beginIdentitySessionRefreshLockedLoad(
        workflow.boundary.controller,
        workflow.context.scope,
        workflow.authority,
        workflow.ticket,
      ),
    );
  });

  it('registers exact frozen found rows without snapshots or digest leakage', (): void => {
    const workflow = foundLoad();

    expect(workflow.load).toEqual({
      kind: 'found',
      account: workflow.loadedAccount,
      sessionFamily: workflow.loadedFamily,
      presentedRefreshCredential: workflow.loadedCredential,
    });
    expect(Reflect.ownKeys(workflow.load)).toEqual([
      'kind',
      'account',
      'sessionFamily',
      'presentedRefreshCredential',
    ]);
    expect(Object.isFrozen(workflow.load)).toBe(true);
    expect(JSON.stringify(workflow.load)).not.toContain(CREDENTIAL_ID);
  });

  it('registers one scope-bound locked not-found result', (): void => {
    const workflow = beginLoad();
    const load = completeIdentitySessionRefreshLockedLoadNotFound(
      workflow.boundary.controller,
      workflow.operation,
      workflow.dbNow,
    );

    expect(load).toEqual({ kind: 'not-found' });
    expect(Reflect.ownKeys(load)).toEqual(['kind']);
    expect(Object.isFrozen(load)).toBe(true);
    expectFixedError(() =>
      completeIdentitySessionRefreshLockedLoadNotFound(
        workflow.boundary.controller,
        workflow.operation,
        workflow.dbNow,
      ),
    );
  });

  it('keeps a rightful load live after foreign and forged completion attempts', (): void => {
    const rightful = beginLoad();
    const foreign = beginLoad();
    const operationClone = Object.freeze({ ...rightful.operation });

    expectFixedError(() =>
      completeIdentitySessionRefreshLockedLoadNotFound(
        foreign.boundary.controller,
        rightful.operation,
        rightful.dbNow,
      ),
    );
    expectFixedError(() =>
      completeIdentitySessionRefreshLockedLoadNotFound(
        rightful.boundary.controller,
        operationClone,
        rightful.dbNow,
      ),
    );
    expect(
      completeIdentitySessionRefreshLockedLoadNotFound(
        rightful.boundary.controller,
        rightful.operation,
        rightful.dbNow,
      ),
    ).toEqual({ kind: 'not-found' });
  });

  it.each([
    [
      'ticket Account',
      (): readonly [IdentityAccount, IdentitySessionFamily, IdentityRefreshCredential] => [
        account({ id: OTHER_ACCOUNT_ID }),
        sessionFamily(),
        refreshCredential(),
      ],
    ],
    [
      'family Account',
      (): readonly [IdentityAccount, IdentitySessionFamily, IdentityRefreshCredential] => [
        account(),
        sessionFamily({ accountId: OTHER_ACCOUNT_ID }),
        refreshCredential(),
      ],
    ],
    [
      'ticket Session',
      (): readonly [IdentityAccount, IdentitySessionFamily, IdentityRefreshCredential] => [
        account(),
        sessionFamily({ id: OTHER_SESSION_ID }),
        refreshCredential({ sessionId: OTHER_SESSION_ID }),
      ],
    ],
    [
      'ticket credential',
      (): readonly [IdentityAccount, IdentitySessionFamily, IdentityRefreshCredential] => [
        account(),
        sessionFamily(),
        refreshCredential({ id: SUCCESSOR_CREDENTIAL_ID }),
      ],
    ],
    [
      'credential family',
      (): readonly [IdentityAccount, IdentitySessionFamily, IdentityRefreshCredential] => [
        account(),
        sessionFamily(),
        refreshCredential({ sessionId: OTHER_SESSION_ID }),
      ],
    ],
  ] as const)(
    'fails permanently when authentic loaded rows mismatch the %s relationship',
    (_scenario, loaded): void => {
      const workflow = beginLoad();
      const [loadedAccount, loadedFamily, loadedCredential] = loaded();

      expectFixedError(() =>
        completeIdentitySessionRefreshLockedLoadFound(
          workflow.boundary.controller,
          workflow.operation,
          loadedAccount,
          loadedFamily,
          loadedCredential,
          workflow.dbNow,
        ),
      );
      expectFixedError(() =>
        completeIdentitySessionRefreshLockedLoadNotFound(
          workflow.boundary.controller,
          workflow.operation,
          workflow.dbNow,
        ),
      );
    },
  );

  it('permanently fails after an authentic query or mapping failure', (): void => {
    const workflow = beginLoad();
    failIdentitySessionRefreshLockedLoad(workflow.boundary.controller, workflow.operation);

    expectFixedError(() =>
      completeIdentitySessionRefreshLockedLoadFound(
        workflow.boundary.controller,
        workflow.operation,
        account(),
        sessionFamily(),
        refreshCredential(),
        workflow.dbNow,
      ),
    );
  });
});

describe('Identity refresh one-decision workflow', (): void => {
  it('rotates once with exact locked objects, dbNow, and one read per issuance input', (): void => {
    const workflow = foundLoad();
    const tracked = trackedCommand();
    const decision = decideIdentitySessionRefresh(workflow.context, workflow.load, tracked.input);

    expect(decision).toEqual({ kind: 'rotated' });
    assertDecisionKind(decision, 'rotated');
    expect(Reflect.ownKeys(decision)).toEqual(['kind']);
    expect(Object.isFrozen(decision)).toBe(true);
    expect(JSON.stringify(decision)).toBe('{"kind":"rotated"}');
    expect(tracked.reads).toEqual({
      successorRefreshCredentialId: 1,
      refreshIdleLifetimeSeconds: 1,
      issuedAccessCredentialId: 1,
      accessLifetimeSeconds: 1,
    });

    const result = inspectIdentitySessionRefreshRotatedDecision(
      workflow.boundary.controller,
      decision,
    );
    expect(result.basis).toEqual({
      accountId: ACCOUNT_ID,
      accountVersion: 1,
      sessionId: SESSION_ID,
      sessionFamilyVersion: 1,
      presentedRefreshCredentialId: CREDENTIAL_ID,
      presentedRefreshCredentialSequence: 1,
    });
    expect(result.sessionFamily.toSnapshot()).toMatchObject({
      version: 2,
      lastRotatedAt: ROTATED_AT,
      refreshIdleExpiresAt: '2026-08-23T10:20:00.000002Z',
    });
    expect(result.consumedRefreshCredential.toSnapshot()).toMatchObject({
      consumedAt: ROTATED_AT,
      successorId: SUCCESSOR_CREDENTIAL_ID,
    });
    expect(result.successorRefreshCredential.toSnapshot()).toMatchObject({
      id: SUCCESSOR_CREDENTIAL_ID,
      sequence: 2,
      issuedAt: ROTATED_AT,
      expiresAt: '2026-08-23T10:20:00.000002Z',
    });
    expect(result.issuedAccessCredential.toSnapshot()).toMatchObject({
      id: ACCESS_CREDENTIAL_ID,
      sequence: 2,
      issuedAt: ROTATED_AT,
      expiresAt: '2026-08-23T10:10:00.000002Z',
    });
    expect(result.facts[0].occurredAt).toBe(ROTATED_AT);
    expectFixedError(() =>
      decideIdentitySessionRefresh(workflow.context, workflow.load, command()),
    );
  });

  it('detects reuse without reading or exposing new issuance material', (): void => {
    const workflow = foundLoad(
      REUSE_DETECTED_AT,
      account(),
      sessionFamily({
        version: 2,
        lastRotatedAt: ROTATED_AT,
        refreshIdleExpiresAt: '2026-08-23T10:20:00.000002Z',
      }),
      refreshCredential({
        consumedAt: ROTATED_AT,
        successorId: SUCCESSOR_CREDENTIAL_ID,
      }),
    );
    const trapped = trappedCommand();
    const decision = decideIdentitySessionRefresh(workflow.context, workflow.load, trapped.input);

    expect(decision).toEqual({ kind: 'reuse-detected' });
    assertDecisionKind(decision, 'reuse-detected');
    expect(Reflect.ownKeys(decision)).toEqual(['kind']);
    expect(trapped.trapCalls()).toBe(0);

    const result = inspectIdentitySessionRefreshReuseDetectedDecision(
      workflow.boundary.controller,
      decision,
    );
    expect(result.reusedRefreshCredential).toBe(workflow.loadedCredential);
    expect(result.sessionFamily.toSnapshot()).toMatchObject({
      version: 3,
      revokedAt: REUSE_DETECTED_AT,
      closedReason: 'REFRESH_REUSE_DETECTED',
    });
    expect(result.facts[0].occurredAt).toBe(REUSE_DETECTED_AT);
  });

  it('rejects terminal locked state without reading issuance input', (): void => {
    const workflow = foundLoad(
      ROTATED_AT,
      account(),
      sessionFamily({
        version: 2,
        revokedAt: '2026-08-23T10:04:00.000002Z',
        closedReason: 'LOGOUT',
      }),
      refreshCredential(),
    );
    const trapped = trappedCommand();
    const decision = decideIdentitySessionRefresh(workflow.context, workflow.load, trapped.input);

    expect(decision).toEqual({ kind: 'rejected' });
    expect(Reflect.ownKeys(decision)).toEqual(['kind']);
    expect(trapped.trapCalls()).toBe(0);
    expect(inspect(decision, { showHidden: true })).not.toContain(CREDENTIAL_ID);
  });

  it('maps locked not-found to rejection without touching even a revoked input Proxy', (): void => {
    const workflow = beginLoad();
    const load = completeIdentitySessionRefreshLockedLoadNotFound(
      workflow.boundary.controller,
      workflow.operation,
      workflow.dbNow,
    );
    const revoked = Proxy.revocable(command(), {});
    revoked.revoke();

    expect(decideIdentitySessionRefresh(workflow.context, load, revoked.proxy)).toEqual({
      kind: 'rejected',
    });
  });

  it('keeps the rightful decision eligible after foreign load and controller inspection', (): void => {
    const rightful = foundLoad();
    const foreign = foundLoad();

    expectFixedError(() => decideIdentitySessionRefresh(rightful.context, foreign.load, command()));
    const decision = decideIdentitySessionRefresh(rightful.context, rightful.load, command());
    assertDecisionKind(decision, 'rotated');
    expectFixedError(() =>
      inspectIdentitySessionRefreshRotatedDecision(foreign.boundary.controller, decision),
    );
    expect(
      inspectIdentitySessionRefreshRotatedDecision(rightful.boundary.controller, decision).kind,
    ).toBe('rotated');
  });

  it('keeps the rightful decision eligible after cloned context and load attempts', (): void => {
    const workflow = foundLoad();
    const contextClone = structuredClone(workflow.context);
    const loadClone = Object.freeze({ ...workflow.load });

    expectFixedError(() => decideIdentitySessionRefresh(contextClone, workflow.load, command()));
    expectFixedError(() => decideIdentitySessionRefresh(workflow.context, loadClone, command()));
    expect(decideIdentitySessionRefresh(workflow.context, workflow.load, command())).toEqual({
      kind: 'rotated',
    });
  });

  it('fails permanently on malformed decision input with one cause-free workflow error', (): void => {
    const workflow = foundLoad();

    expectFixedError(
      () => decideIdentitySessionRefresh(workflow.context, workflow.load, Object.freeze({})),
      InvalidIdentitySessionRefreshWorkflowError,
      WORKFLOW_ERROR_MESSAGE,
    );
    expectFixedError(() =>
      decideIdentitySessionRefresh(workflow.context, workflow.load, command()),
    );
  });

  it('preserves fixed domain errors, conditional reads, and closes after a domain failure', (): void => {
    const workflow = foundLoad();
    const tracked = trackedCommand(
      Object.freeze({
        ...command(),
        successorRefreshCredentialId: 'successor-secret',
      }),
    );

    expectFixedError(
      () => decideIdentitySessionRefresh(workflow.context, workflow.load, tracked.input),
      InvalidIdentityRefreshCredentialIdError,
      'Expected a canonical lowercase UUIDv7 Identity Refresh Credential identifier',
      ['successor-secret'],
    );
    expect(tracked.reads).toEqual({
      successorRefreshCredentialId: 1,
      refreshIdleLifetimeSeconds: 0,
      issuedAccessCredentialId: 0,
      accessLifetimeSeconds: 0,
    });
    expectFixedError(() =>
      decideIdentitySessionRefresh(workflow.context, workflow.load, command()),
    );
  });

  it('closes after a domain relationship failure before reading issuance fields', (): void => {
    const workflow = foundLoad(
      ROTATED_AT,
      account({
        createdAt: '2026-08-23T10:00:00.000002Z',
        updatedAt: '2026-08-23T10:00:00.000002Z',
      }),
    );
    const tracked = trackedCommand();

    expectFixedError(
      () => decideIdentitySessionRefresh(workflow.context, workflow.load, tracked.input),
      InvalidIdentitySessionFamilyRefreshStateError,
      'Expected a valid Identity Session Family refresh state',
    );
    expect(tracked.reads).toEqual(noCommandReads());
    expectFixedError(() =>
      decideIdentitySessionRefresh(workflow.context, workflow.load, command()),
    );
  });

  it('keeps closed absorbing when an issuance getter settles the scope re-entrantly', (): void => {
    const workflow = foundLoad();
    const input = Object.freeze({
      successorRefreshCredentialId: SUCCESSOR_CREDENTIAL_ID,
      refreshIdleLifetimeSeconds: 900,
      issuedAccessCredentialId: ACCESS_CREDENTIAL_ID,
      get accessLifetimeSeconds(): number {
        closeIdentitySessionRefreshWorkflow(workflow.boundary.controller);
        return 300;
      },
    });

    expectFixedError(() => decideIdentitySessionRefresh(workflow.context, workflow.load, input));
    expectFixedError((): void => {
      closeIdentitySessionRefreshWorkflow(workflow.boundary.controller);
    });
    expectFixedError(() =>
      decideIdentitySessionRefresh(workflow.context, workflow.load, command()),
    );
  });

  it('rejects a generated credential not bound to the exact command identifier', (): void => {
    const workflow = foundLoad();
    const wrongCredential = IdentityAccessCredential.rehydrate({
      id: OTHER_ACCESS_CREDENTIAL_ID,
      sessionId: SESSION_ID,
      sequence: 2,
      issuedAt: ROTATED_AT,
      expiresAt: '2026-08-23T10:10:00.000002Z',
    });
    const descriptor = Object.getOwnPropertyDescriptor(
      IdentityAccessCredential,
      'issueForSessionFamily',
    );

    Object.defineProperty(IdentityAccessCredential, 'issueForSessionFamily', {
      configurable: true,
      value: (): IdentityAccessCredential => wrongCredential,
    });

    try {
      expectFixedError(() =>
        decideIdentitySessionRefresh(workflow.context, workflow.load, command()),
      );
    } finally {
      if (descriptor !== undefined) {
        Object.defineProperty(IdentityAccessCredential, 'issueForSessionFamily', descriptor);
      }
    }
  });

  it('collapses an unexpected downstream domain failure without leaking its cause', (): void => {
    const workflow = foundLoad();
    const descriptor = Object.getOwnPropertyDescriptor(
      IdentityAccessCredential,
      'issueForSessionFamily',
    );

    Object.defineProperty(IdentityAccessCredential, 'issueForSessionFamily', {
      configurable: true,
      value: (): never => {
        throw new Error('downstream-domain-secret');
      },
    });

    try {
      expectFixedError(
        () => decideIdentitySessionRefresh(workflow.context, workflow.load, command()),
        InvalidIdentitySessionRefreshWorkflowError,
        WORKFLOW_ERROR_MESSAGE,
        ['downstream-domain-secret'],
      );
    } finally {
      if (descriptor !== undefined) {
        Object.defineProperty(IdentityAccessCredential, 'issueForSessionFamily', descriptor);
      }
    }
  });

  it('recreates an allowlisted domain error instead of rethrowing contaminated state', (): void => {
    const workflow = foundLoad();
    const descriptor = Object.getOwnPropertyDescriptor(
      IdentityAccessCredential,
      'issueForSessionFamily',
    );
    const contaminated = Object.assign(new InvalidIdentityRefreshCredentialIdError(), {
      name: 'contaminated-error-secret',
      message: 'contaminated-message-secret',
      cause: new Error('contaminated-cause-secret'),
    });

    Object.defineProperty(IdentityAccessCredential, 'issueForSessionFamily', {
      configurable: true,
      value: (): never => {
        throw contaminated;
      },
    });

    try {
      expectFixedError(
        () => decideIdentitySessionRefresh(workflow.context, workflow.load, command()),
        InvalidIdentityRefreshCredentialIdError,
        'Expected a canonical lowercase UUIDv7 Identity Refresh Credential identifier',
        ['contaminated-error-secret', 'contaminated-message-secret', 'contaminated-cause-secret'],
      );
    } finally {
      if (descriptor !== undefined) {
        Object.defineProperty(IdentityAccessCredential, 'issueForSessionFamily', descriptor);
      }
    }
  });

  it('rejects structural decision clones while retaining the authentic writer capability', (): void => {
    const workflow = foundLoad();
    const decision = decideIdentitySessionRefresh(workflow.context, workflow.load, command());
    assertDecisionKind(decision, 'rotated');
    const clone = structuredClone(decision);

    expectFixedError(() =>
      inspectIdentitySessionRefreshRotatedDecision(workflow.boundary.controller, clone),
    );
    expect(
      inspectIdentitySessionRefreshRotatedDecision(workflow.boundary.controller, decision).kind,
    ).toBe('rotated');
  });

  it('invalidates authentic decisions when the scope closes', (): void => {
    const workflow = foundLoad();
    const decision = decideIdentitySessionRefresh(workflow.context, workflow.load, command());
    assertDecisionKind(decision, 'rotated');
    closeIdentitySessionRefreshWorkflow(workflow.boundary.controller);

    expectFixedError(() =>
      inspectIdentitySessionRefreshRotatedDecision(workflow.boundary.controller, decision),
    );
  });
});

describe('Identity refresh pending transaction evidence', (): void => {
  it('claims one authentic credential attempt and rejects raw, cloned, or already-claimed values', async (): Promise<void> => {
    const authentic = await authenticCredentialAttempt();
    const boundary = createIdentitySessionRefreshAttemptBoundWorkflow(authentic.attempt);

    expect(boundary).toEqual({ controller: boundary.controller, scope: boundary.scope });
    expect(Object.isFrozen(boundary)).toBe(true);
    expect(Reflect.ownKeys(boundary.controller)).toEqual([]);
    expect(Reflect.ownKeys(boundary.scope)).toEqual([]);
    expectFixedError(
      () => createIdentitySessionRefreshAttemptBoundWorkflow(authentic.attempt),
      InvalidIdentitySessionCredentialCandidatesError,
      'Expected valid Identity session credential candidates',
    );
    expectFixedError(
      () => createIdentitySessionRefreshAttemptBoundWorkflow(structuredClone(authentic.attempt)),
      InvalidIdentitySessionCredentialCandidatesError,
      'Expected valid Identity session credential candidates',
    );
    expectFixedError(
      () =>
        createIdentitySessionRefreshAttemptBoundWorkflow(
          authentic.candidates as unknown as typeof authentic.attempt,
        ),
      InvalidIdentitySessionCredentialCandidatesError,
      'Expected valid Identity session credential candidates',
      [ACCESS_WIRE, REFRESH_WIRE],
    );
    expectFixedError(
      () =>
        createIdentitySessionRefreshAttemptBoundWorkflow(
          Object.freeze({ raw: 'raw-attempt-secret' }) as unknown as typeof authentic.attempt,
        ),
      InvalidIdentitySessionCredentialCandidatesError,
      'Expected valid Identity session credential candidates',
      ['raw-attempt-secret'],
    );

    expect(activateIdentitySessionRefreshWorkflow(boundary.controller).scope).toBe(boundary.scope);
  });

  it('requires an attempt-bound workflow before any terminal evidence can be minted', (): void => {
    const workflow = beginLoad();
    const load = completeIdentitySessionRefreshLockedLoadNotFound(
      workflow.boundary.controller,
      workflow.operation,
      workflow.dbNow,
    );
    const decision = decideIdentitySessionRefresh(workflow.context, load, command());
    assertDecisionKind(decision, 'rejected');

    expectFixedError(() =>
      completeIdentitySessionRefreshRejected(
        workflow.boundary.controller,
        workflow.context.scope,
        decision,
      ),
    );
  });

  it('returns exact frozen kind-only rejected evidence and consumes it once', async (): Promise<void> => {
    const workflow = await attemptBoundBeginLoad();
    const load = completeIdentitySessionRefreshLockedLoadNotFound(
      workflow.boundary.controller,
      workflow.operation,
      workflow.dbNow,
    );
    const decision = decideIdentitySessionRefresh(workflow.context, load, command());
    assertDecisionKind(decision, 'rejected');
    const evidence = completeIdentitySessionRefreshRejected(
      workflow.boundary.controller,
      workflow.context.scope,
      decision,
    );

    expect(evidence).toEqual({ kind: 'rejected' });
    expect(Reflect.ownKeys(evidence)).toEqual(['kind']);
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(JSON.stringify(evidence)).toBe('{"kind":"rejected"}');
    expect(inspect(evidence, { showHidden: true })).not.toContain(ACCESS_WIRE);
    expect(inspect(evidence, { showHidden: true })).not.toContain(REFRESH_WIRE);
    expect(consumeIdentityTransactionPendingEvidence(workflow.boundary.controller, evidence)).toBe(
      evidence,
    );
    expectFixedError(() =>
      consumeIdentityTransactionPendingEvidence(workflow.boundary.controller, evidence),
    );
  });

  it('exposes exact rotation writes with the authentic candidate digest identities only', async (): Promise<void> => {
    const workflow = await attemptBoundFoundLoad();
    const decision = decideIdentitySessionRefresh(workflow.context, workflow.load, command());
    assertDecisionKind(decision, 'rotated');
    const action = beginIdentitySessionRefreshRotatedPersistence(
      workflow.boundary.controller,
      workflow.context.scope,
      decision,
      SECURITY_EVENT_ID,
    );

    expect(Reflect.ownKeys(action)).toEqual([]);
    expect(Object.isFrozen(action)).toBe(true);
    expect(JSON.stringify(action)).toBe('{}');

    const plan = inspectIdentitySessionRefreshRotatedPersistence(
      workflow.boundary.controller,
      action,
    );
    expect(Reflect.ownKeys(plan)).toEqual([
      'result',
      'accessCredentialDigest',
      'refreshCredentialDigest',
      'securityEventId',
    ]);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(plan.result.kind).toBe('rotated');
    expect(plan.accessCredentialDigest).toBe(workflow.accessCredentialDigest);
    expect(plan.refreshCredentialDigest).toBe(workflow.refreshCredentialDigest);
    expect(plan.accessCredentialDigest).toBe(workflow.candidates.access.digest);
    expect(plan.refreshCredentialDigest).toBe(workflow.candidates.refresh.digest);
    expect(plan.securityEventId).toBe(SECURITY_EVENT_ID);

    const evidence = completeIdentitySessionRefreshRotatedPersistence(
      workflow.boundary.controller,
      action,
      authorityProjection(),
    );
    expect(evidence).toEqual({
      kind: 'rotated',
      principal: {
        actorId: ACCOUNT_ID,
        sessionId: SESSION_ID,
        permissions: ['catalog.products.read'],
      },
      accessCredentialIssuedAt: ROTATED_AT,
      accessCredentialExpiresAt: '2026-08-23T10:10:00.000002Z',
      refreshIdleExpiresAt: '2026-08-23T10:20:00.000002Z',
      refreshAbsoluteExpiresAt: ABSOLUTE_EXPIRES_AT,
    });
    expect(Reflect.ownKeys(evidence)).toEqual([
      'kind',
      'principal',
      'accessCredentialIssuedAt',
      'accessCredentialExpiresAt',
      'refreshIdleExpiresAt',
      'refreshAbsoluteExpiresAt',
    ]);
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(Object.isFrozen(evidence.principal)).toBe(true);
    expect(Object.isFrozen(evidence.principal.permissions)).toBe(true);
    expect(evidence).not.toHaveProperty('accessCredentialDigest');
    expect(evidence).not.toHaveProperty('refreshCredentialDigest');
    expect(inspect(evidence, { showHidden: true })).not.toContain(ACCESS_WIRE);
    expect(inspect(evidence, { showHidden: true })).not.toContain(REFRESH_WIRE);
    expect(consumeIdentityTransactionPendingEvidence(workflow.boundary.controller, evidence)).toBe(
      evidence,
    );
  });

  it('exposes exact reuse writes and evidence without any credential digest material', async (): Promise<void> => {
    const workflow = await attemptBoundFoundLoad(
      REUSE_DETECTED_AT,
      account(),
      sessionFamily({
        version: 2,
        lastRotatedAt: ROTATED_AT,
        refreshIdleExpiresAt: '2026-08-23T10:20:00.000002Z',
      }),
      refreshCredential({ consumedAt: ROTATED_AT, successorId: SUCCESSOR_CREDENTIAL_ID }),
    );
    const decision = decideIdentitySessionRefresh(
      workflow.context,
      workflow.load,
      trappedCommand().input,
    );
    assertDecisionKind(decision, 'reuse-detected');
    const action = beginIdentitySessionRefreshReusePersistence(
      workflow.boundary.controller,
      workflow.context.scope,
      decision,
      SECURITY_EVENT_ID,
    );

    expect(Reflect.ownKeys(action)).toEqual([]);
    expect(Object.isFrozen(action)).toBe(true);
    expect(JSON.stringify(action)).toBe('{}');
    const plan = inspectIdentitySessionRefreshReusePersistence(
      workflow.boundary.controller,
      action,
    );
    expect(Reflect.ownKeys(plan)).toEqual(['result', 'securityEventId']);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(plan.result.kind).toBe('reuse-detected');
    expect(plan.securityEventId).toBe(SECURITY_EVENT_ID);
    expect(plan).not.toHaveProperty('accessCredentialDigest');
    expect(plan).not.toHaveProperty('refreshCredentialDigest');

    const evidence = completeIdentitySessionRefreshReusePersistence(
      workflow.boundary.controller,
      action,
    );
    expect(evidence).toEqual({ kind: 'reuse-detected' });
    expect(Reflect.ownKeys(evidence)).toEqual(['kind']);
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(evidence).not.toHaveProperty('accessCredentialDigest');
    expect(evidence).not.toHaveProperty('refreshCredentialDigest');
    expect(consumeIdentityTransactionPendingEvidence(workflow.boundary.controller, evidence)).toBe(
      evidence,
    );
  });

  it('validates event identifiers before starting rotation or reuse persistence', async (): Promise<void> => {
    const rotation = await attemptBoundFoundLoad();
    const rotated = decideIdentitySessionRefresh(rotation.context, rotation.load, command());
    assertDecisionKind(rotated, 'rotated');

    expectFixedError(
      () =>
        beginIdentitySessionRefreshRotatedPersistence(
          rotation.boundary.controller,
          rotation.context.scope,
          rotated,
          'rotation-event-secret',
        ),
      InvalidIdentitySecurityEventIdError,
      'Expected a canonical lowercase UUIDv7 Identity SecurityEvent identifier',
      ['rotation-event-secret'],
    );
    expect(
      beginIdentitySessionRefreshRotatedPersistence(
        rotation.boundary.controller,
        rotation.context.scope,
        rotated,
        SECURITY_EVENT_ID,
      ),
    ).toEqual({});

    const reuse = await attemptBoundFoundLoad(
      REUSE_DETECTED_AT,
      account(),
      sessionFamily({
        version: 2,
        lastRotatedAt: ROTATED_AT,
        refreshIdleExpiresAt: '2026-08-23T10:20:00.000002Z',
      }),
      refreshCredential({ consumedAt: ROTATED_AT, successorId: SUCCESSOR_CREDENTIAL_ID }),
    );
    const reused = decideIdentitySessionRefresh(reuse.context, reuse.load, trappedCommand().input);
    assertDecisionKind(reused, 'reuse-detected');

    expectFixedError(
      () =>
        beginIdentitySessionRefreshReusePersistence(
          reuse.boundary.controller,
          reuse.context.scope,
          reused,
          'reuse-event-secret',
        ),
      InvalidIdentitySecurityEventIdError,
      'Expected a canonical lowercase UUIDv7 Identity SecurityEvent identifier',
      ['reuse-event-secret'],
    );
    expect(
      beginIdentitySessionRefreshReusePersistence(
        reuse.boundary.controller,
        reuse.context.scope,
        reused,
        OTHER_SECURITY_EVENT_ID,
      ),
    ).toEqual({});
  });

  it('rejects foreign scope, wrong kind, and structural clones without consuming rightful authority', async (): Promise<void> => {
    const rightful = await attemptBoundFoundLoad();
    const rightfulDecision = decideIdentitySessionRefresh(
      rightful.context,
      rightful.load,
      command(),
    );
    assertDecisionKind(rightfulDecision, 'rotated');
    const foreign = await attemptBoundBeginLoad();
    const foreignLoad = completeIdentitySessionRefreshLockedLoadNotFound(
      foreign.boundary.controller,
      foreign.operation,
      foreign.dbNow,
    );
    const foreignDecision = decideIdentitySessionRefresh(foreign.context, foreignLoad, command());
    assertDecisionKind(foreignDecision, 'rejected');

    expectFixedError(() =>
      beginIdentitySessionRefreshRotatedPersistence(
        rightful.boundary.controller,
        foreign.context.scope,
        rightfulDecision,
        SECURITY_EVENT_ID,
      ),
    );
    expectFixedError(() =>
      beginIdentitySessionRefreshRotatedPersistence(
        rightful.boundary.controller,
        rightful.context.scope,
        structuredClone(rightfulDecision),
        SECURITY_EVENT_ID,
      ),
    );
    expectFixedError(() =>
      beginIdentitySessionRefreshRotatedPersistence(
        rightful.boundary.controller,
        rightful.context.scope,
        foreignDecision as unknown as typeof rightfulDecision,
        SECURITY_EVENT_ID,
      ),
    );

    const action = beginIdentitySessionRefreshRotatedPersistence(
      rightful.boundary.controller,
      rightful.context.scope,
      rightfulDecision,
      SECURITY_EVENT_ID,
    );
    expectFixedError(() =>
      inspectIdentitySessionRefreshRotatedPersistence(foreign.boundary.controller, action),
    );
    expectFixedError(() =>
      inspectIdentitySessionRefreshRotatedPersistence(
        rightful.boundary.controller,
        structuredClone(action),
      ),
    );
    expectFixedError(() =>
      inspectIdentitySessionRefreshReusePersistence(
        rightful.boundary.controller,
        action as unknown as Parameters<typeof inspectIdentitySessionRefreshReusePersistence>[1],
      ),
    );
    expect(
      inspectIdentitySessionRefreshRotatedPersistence(rightful.boundary.controller, action)
        .securityEventId,
    ).toBe(SECURITY_EVENT_ID);

    const evidence = completeIdentitySessionRefreshRotatedPersistence(
      rightful.boundary.controller,
      action,
      authorityProjection(),
    );
    const foreignEvidence = completeIdentitySessionRefreshRejected(
      foreign.boundary.controller,
      foreign.context.scope,
      foreignDecision,
    );
    expectFixedError(() =>
      consumeIdentityTransactionPendingEvidence(foreign.boundary.controller, evidence),
    );
    expectFixedError(() =>
      consumeIdentityTransactionPendingEvidence(
        rightful.boundary.controller,
        structuredClone(evidence),
      ),
    );
    expectFixedError(() =>
      consumeIdentityTransactionPendingEvidence(rightful.boundary.controller, foreignEvidence),
    );
    expect(consumeIdentityTransactionPendingEvidence(rightful.boundary.controller, evidence)).toBe(
      evidence,
    );
  });

  it.each([
    [
      'malformed projection',
      authorityProjection({ permissions: ['projection-secret'] }),
      ['projection-secret'],
    ],
    ['foreign actor', authorityProjection({ actorId: OTHER_ACCOUNT_ID }), [OTHER_ACCOUNT_ID]],
    ['foreign Session', authorityProjection({ sessionId: OTHER_SESSION_ID }), [OTHER_SESSION_ID]],
  ] as const)(
    'makes %s an absorbing rotation completion failure',
    async (_scenario, projection, secrets): Promise<void> => {
      const workflow = await attemptBoundFoundLoad();
      const decision = decideIdentitySessionRefresh(workflow.context, workflow.load, command());
      assertDecisionKind(decision, 'rotated');
      const action = beginIdentitySessionRefreshRotatedPersistence(
        workflow.boundary.controller,
        workflow.context.scope,
        decision,
        SECURITY_EVENT_ID,
      );

      expectFixedError(
        () =>
          completeIdentitySessionRefreshRotatedPersistence(
            workflow.boundary.controller,
            action,
            projection,
          ),
        InvalidIdentityAuthenticatedPrincipalError,
        'Expected valid Identity authenticated-principal authority evidence',
        secrets,
      );
      expectFixedError(() =>
        inspectIdentitySessionRefreshRotatedPersistence(workflow.boundary.controller, action),
      );
      expectFixedError(() =>
        completeIdentitySessionRefreshRotatedPersistence(
          workflow.boundary.controller,
          action,
          authorityProjection(),
        ),
      );
    },
  );

  it('rejects raw decisions, actions, and evidence without reading or leaking their values', async (): Promise<void> => {
    const workflow = await attemptBoundFoundLoad();
    const decision = decideIdentitySessionRefresh(workflow.context, workflow.load, command());
    assertDecisionKind(decision, 'rotated');
    const rawDecision = Object.freeze({ kind: 'rotated', secret: 'raw-decision-secret' });

    expectFixedError(
      () =>
        beginIdentitySessionRefreshRotatedPersistence(
          workflow.boundary.controller,
          workflow.context.scope,
          rawDecision as unknown as typeof decision,
          SECURITY_EVENT_ID,
        ),
      InvalidIdentitySessionRefreshWorkflowError,
      WORKFLOW_ERROR_MESSAGE,
      ['raw-decision-secret'],
    );
    const action = beginIdentitySessionRefreshRotatedPersistence(
      workflow.boundary.controller,
      workflow.context.scope,
      decision,
      SECURITY_EVENT_ID,
    );
    const rawAction = Object.freeze({ secret: 'raw-action-secret' });
    expectFixedError(
      () =>
        inspectIdentitySessionRefreshRotatedPersistence(
          workflow.boundary.controller,
          rawAction as unknown as typeof action,
        ),
      InvalidIdentitySessionRefreshWorkflowError,
      WORKFLOW_ERROR_MESSAGE,
      ['raw-action-secret'],
    );
    const evidence = completeIdentitySessionRefreshRotatedPersistence(
      workflow.boundary.controller,
      action,
      authorityProjection(),
    );
    const rawEvidence = Object.freeze({ kind: 'rotated', secret: 'raw-evidence-secret' });
    expectFixedError(
      () =>
        consumeIdentityTransactionPendingEvidence(
          workflow.boundary.controller,
          rawEvidence as unknown as typeof evidence,
        ),
      InvalidIdentitySessionRefreshWorkflowError,
      WORKFLOW_ERROR_MESSAGE,
      ['raw-evidence-secret'],
    );
    expect(consumeIdentityTransactionPendingEvidence(workflow.boundary.controller, evidence)).toBe(
      evidence,
    );
  });

  it('revokes still-pending evidence when the transaction scope closes', async (): Promise<void> => {
    const workflow = await attemptBoundBeginLoad();
    const load = completeIdentitySessionRefreshLockedLoadNotFound(
      workflow.boundary.controller,
      workflow.operation,
      workflow.dbNow,
    );
    const decision = decideIdentitySessionRefresh(workflow.context, load, command());
    assertDecisionKind(decision, 'rejected');
    const evidence = completeIdentitySessionRefreshRejected(
      workflow.boundary.controller,
      workflow.context.scope,
      decision,
    );

    closeIdentitySessionRefreshWorkflow(workflow.boundary.controller);
    expect(promoteIdentityTransactionPendingEvidence(workflow.boundary.controller, evidence)).toBe(
      undefined,
    );
    expect(revokeIdentityTransactionPendingEvidence(workflow.boundary.controller, evidence)).toBe(
      false,
    );
    expectFixedError(() =>
      consumeIdentityTransactionPendingEvidence(workflow.boundary.controller, evidence),
    );
    expectFixedError(
      (): void => {
        retireIdentitySessionCredentialAttempt(workflow.attempt, workflow.boundary.controller);
      },
      InvalidIdentitySessionCredentialCandidatesError,
      'Expected valid Identity session credential candidates',
    );
  });

  it('preserves consumed evidence across scope close only until explicit outer revocation', async (): Promise<void> => {
    const workflow = await attemptBoundBeginLoad();
    const load = completeIdentitySessionRefreshLockedLoadNotFound(
      workflow.boundary.controller,
      workflow.operation,
      workflow.dbNow,
    );
    const decision = decideIdentitySessionRefresh(workflow.context, load, command());
    assertDecisionKind(decision, 'rejected');
    const evidence = completeIdentitySessionRefreshRejected(
      workflow.boundary.controller,
      workflow.context.scope,
      decision,
    );

    expect(consumeIdentityTransactionPendingEvidence(workflow.boundary.controller, evidence)).toBe(
      evidence,
    );
    closeIdentitySessionRefreshWorkflow(workflow.boundary.controller);
    expect(revokeIdentityTransactionPendingEvidence(workflow.boundary.controller, evidence)).toBe(
      true,
    );
    expect(revokeIdentityTransactionPendingEvidence(workflow.boundary.controller, evidence)).toBe(
      false,
    );
    expectFixedError(
      (): void => {
        retireIdentitySessionCredentialAttempt(workflow.attempt, workflow.boundary.controller);
      },
      InvalidIdentitySessionCredentialCandidatesError,
      'Expected valid Identity session credential candidates',
    );
  });

  it('makes an authentic writer failure absorbing without minting evidence', async (): Promise<void> => {
    const workflow = await attemptBoundFoundLoad();
    const decision = decideIdentitySessionRefresh(workflow.context, workflow.load, command());
    assertDecisionKind(decision, 'rotated');
    const action = beginIdentitySessionRefreshRotatedPersistence(
      workflow.boundary.controller,
      workflow.context.scope,
      decision,
      SECURITY_EVENT_ID,
    );

    failIdentitySessionRefreshPersistence(workflow.boundary.controller, action);

    expectFixedError(() =>
      inspectIdentitySessionRefreshRotatedPersistence(workflow.boundary.controller, action),
    );
    expectFixedError(() =>
      completeIdentitySessionRefreshRotatedPersistence(
        workflow.boundary.controller,
        action,
        authorityProjection(),
      ),
    );
    expectFixedError((): void => {
      failIdentitySessionRefreshPersistence(workflow.boundary.controller, action);
    });
  });

  it('re-authenticates the admitted attempt after hostile authority projection reads', async (): Promise<void> => {
    const workflow = await attemptBoundFoundLoad();
    const decision = decideIdentitySessionRefresh(workflow.context, workflow.load, command());
    assertDecisionKind(decision, 'rotated');
    const action = beginIdentitySessionRefreshRotatedPersistence(
      workflow.boundary.controller,
      workflow.context.scope,
      decision,
      SECURITY_EVENT_ID,
    );
    const projection = authorityProjection();
    Object.defineProperty(projection, 'actorId', {
      configurable: true,
      enumerable: true,
      get(): string {
        retireIdentitySessionCredentialAttempt(workflow.attempt, workflow.boundary.controller);
        return ACCOUNT_ID;
      },
    });

    expectFixedError(() =>
      completeIdentitySessionRefreshRotatedPersistence(
        workflow.boundary.controller,
        action,
        projection,
      ),
    );
    expectFixedError(() =>
      inspectIdentitySessionRefreshRotatedPersistence(workflow.boundary.controller, action),
    );
    closeIdentitySessionRefreshWorkflow(workflow.boundary.controller);
    expectFixedError((): void => {
      closeIdentitySessionRefreshWorkflow(workflow.boundary.controller);
    });
  });

  it('keeps every pending-evidence capability absent from the package root', (): void => {
    expect(identityPublicApi).not.toHaveProperty(
      'createIdentitySessionRefreshAttemptBoundWorkflow',
    );
    expect(identityPublicApi).not.toHaveProperty('consumeIdentityTransactionPendingEvidence');
    expect(identityPublicApi).not.toHaveProperty('revokeIdentityTransactionPendingEvidence');
    expect(identityPublicApi).not.toHaveProperty('promoteIdentityTransactionPendingEvidence');
    expect(identityPublicApi).not.toHaveProperty(
      'inspectIdentitySessionRefreshCommittedCompletion',
    );
  });
});
