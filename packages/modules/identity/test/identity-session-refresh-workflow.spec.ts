import { inspect } from 'node:util';

import {
  activateIdentitySessionRefreshWorkflow,
  beginIdentitySessionRefreshLockedLoad,
  closeIdentitySessionRefreshWorkflow,
  completeIdentitySessionRefreshLockedLoadFound,
  completeIdentitySessionRefreshLockedLoadNotFound,
  createIdentitySessionRefreshWorkflow,
  decideIdentitySessionRefresh,
  failIdentitySessionRefreshLockedLoad,
  inspectIdentitySessionRefreshReuseDetectedDecision,
  inspectIdentitySessionRefreshRotatedDecision,
  InvalidIdentitySessionRefreshWorkflowError,
  type IdentitySessionRefreshDecision,
  type IdentitySessionRefreshDecisionInput,
} from '../src/application/identity-session-refresh-workflow';
import { createIdentityRefreshCredentialDigestFromBytes } from '../src/application/identity-session-credential-digest.values';
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
import type {
  // @ts-expect-error Refresh workflow capabilities remain package-internal.
  IdentitySessionRefreshDecision as LeakedIdentitySessionRefreshDecision,
} from '../src';

const ACCOUNT_ID = '01890f3a-8bcd-7def-8abc-0123456789ab';
const OTHER_ACCOUNT_ID = '01890f3a-8bcd-7def-9abc-0123456789ab';
const SESSION_ID = '01890f3a-8bcd-7def-aabc-0123456789ab';
const OTHER_SESSION_ID = '01890f3a-8bcd-7def-babc-0123456789ab';
const CREDENTIAL_ID = '01890f3a-8bcd-7def-8bcd-0123456789ab';
const SUCCESSOR_CREDENTIAL_ID = '01890f3a-8bcd-7def-9bcd-0123456789ab';
const ACCESS_CREDENTIAL_ID = '01890f3a-8bcd-7def-abcd-0123456789ab';
const OTHER_ACCESS_CREDENTIAL_ID = '01890f3a-8bcd-7def-bbcd-0123456789ab';
const ACCOUNT_CREATED_AT = '2026-08-23T09:00:00.000001Z';
const FAMILY_CREATED_AT = '2026-08-23T10:00:00.000001Z';
const INITIAL_IDLE_EXPIRES_AT = '2026-08-23T10:15:00.000001Z';
const ABSOLUTE_EXPIRES_AT = '2026-08-24T10:00:00.000001Z';
const ROTATED_AT = '2026-08-23T10:05:00.000002Z';
const REUSE_DETECTED_AT = '2026-08-23T10:06:00.000003Z';
const WORKFLOW_ERROR_MESSAGE = 'Expected a valid Identity session refresh workflow transition';

type ErrorClass = abstract new (...arguments_: never[]) => Error;
type CommandReadCounts = Record<keyof IdentitySessionRefreshDecisionInput, number>;

void (undefined as unknown as LeakedIdentitySessionRefreshDecision);

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
  const context = activateIdentitySessionRefreshWorkflow(boundary.controller, dbNow);
  return { boundary, context };
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

    const context = activateIdentitySessionRefreshWorkflow(boundary.controller, ROTATED_AT);
    expect(context).toEqual({ scope: boundary.scope, dbNow: ROTATED_AT });
    expect(Reflect.ownKeys(context)).toEqual(['scope', 'dbNow']);
    expect(Object.isFrozen(context)).toBe(true);
    expectFixedError(() => activateIdentitySessionRefreshWorkflow(boundary.controller, ROTATED_AT));
  });

  it('fails an authentic invalid activation permanently while preserving the domain error', (): void => {
    const boundary = createIdentitySessionRefreshWorkflow();

    expectFixedError(
      () => activateIdentitySessionRefreshWorkflow(boundary.controller, 'writer-time-secret'),
      InvalidIdentityInstantError,
      'Expected a valid UTC Identity instant with exactly six fractional digits',
      ['writer-time-secret'],
    );
    expectFixedError(() => activateIdentitySessionRefreshWorkflow(boundary.controller, ROTATED_AT));
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
    );

    expect(load).toEqual({ kind: 'not-found' });
    expect(Reflect.ownKeys(load)).toEqual(['kind']);
    expect(Object.isFrozen(load)).toBe(true);
    expectFixedError(() =>
      completeIdentitySessionRefreshLockedLoadNotFound(
        workflow.boundary.controller,
        workflow.operation,
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
      ),
    );
    expectFixedError(() =>
      completeIdentitySessionRefreshLockedLoadNotFound(
        rightful.boundary.controller,
        operationClone,
      ),
    );
    expect(
      completeIdentitySessionRefreshLockedLoadNotFound(
        rightful.boundary.controller,
        rightful.operation,
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
        ),
      );
      expectFixedError(() =>
        completeIdentitySessionRefreshLockedLoadNotFound(
          workflow.boundary.controller,
          workflow.operation,
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
