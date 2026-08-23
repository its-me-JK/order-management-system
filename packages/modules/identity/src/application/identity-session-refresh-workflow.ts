import { IdentityAccount, type IdentityAccountSnapshot } from '../domain/identity-account';
import { IdentityAccessCredential } from '../domain/identity-access-credential';
import {
  InvalidIdentityAccessCredentialIdError,
  InvalidIdentityAccessLifetimeSecondsError,
} from '../domain/identity-access-credential.values';
import {
  IdentityRefreshCredential,
  type IdentityRefreshCredentialSnapshot,
} from '../domain/identity-refresh-credential';
import { InvalidIdentityRefreshCredentialIdError } from '../domain/identity-refresh-credential.values';
import {
  IdentitySessionFamily,
  type IdentitySessionFamilyRefreshRejectedResult,
  type IdentitySessionFamilyRefreshResult,
  type IdentitySessionFamilyRefreshReuseDetectedResult,
  type IdentitySessionFamilyRefreshRotatedResult,
  type IdentitySessionFamilySnapshot,
} from '../domain/identity-session-family';
import {
  IdentitySessionFamilyRefreshCapacityExhaustedError,
  IdentitySessionFamilyRefreshSuccessorConflictError,
  IdentitySessionFamilyRefreshTimestampRegressionError,
  InvalidIdentitySessionFamilyRefreshStateError,
} from '../domain/identity-session-family.errors';
import { InvalidIdentityRefreshIdleLifetimeSecondsError } from '../domain/identity-session-family.values';
import {
  compareIdentityInstants,
  parseIdentityInstant,
  tryAddIdentitySeconds,
  type IdentityInstant,
} from '../domain/identity-values';
import type { IdentityRefreshCredentialDigest } from './identity-session-credential-digest.values';
import {
  consumeIdentitySessionRefreshDiscoveryFoundTicket,
  type IdentitySessionRefreshDiscoveryBoundaryAuthority,
  type IdentitySessionRefreshDiscoveryFoundTicket,
} from './identity-session-refresh-discovery';

const objectPrototype = Object.prototype;
const capturedFreeze = Object.freeze;
const capturedGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const capturedGetPrototypeOf = Object.getPrototypeOf;
const capturedIsArray = Array.isArray;
const capturedIsFrozen = Object.isFrozen;
const capturedOwnKeys = Reflect.ownKeys;
const capturedReflectApply = Reflect.apply;
const capturedReflectGet = Reflect.get;
// Capturing these references prevents later prototype mutation from changing the trust boundary.
// eslint-disable-next-line @typescript-eslint/unbound-method
const accountSnapshot = IdentityAccount.prototype.toSnapshot;
// eslint-disable-next-line @typescript-eslint/unbound-method
const accessCredentialSnapshot = IdentityAccessCredential.prototype.toSnapshot;
// eslint-disable-next-line @typescript-eslint/unbound-method
const refreshCredentialSnapshot = IdentityRefreshCredential.prototype.toSnapshot;
// eslint-disable-next-line @typescript-eslint/unbound-method
const sessionFamilySnapshot = IdentitySessionFamily.prototype.toSnapshot;
// eslint-disable-next-line @typescript-eslint/unbound-method
const presentRefreshCredential = IdentitySessionFamily.prototype.presentRefreshCredential;
const invalidSessionFamilyRefreshStateErrorPrototype =
  InvalidIdentitySessionFamilyRefreshStateError.prototype;
const refreshTimestampRegressionErrorPrototype =
  IdentitySessionFamilyRefreshTimestampRegressionError.prototype;
const refreshSuccessorConflictErrorPrototype =
  IdentitySessionFamilyRefreshSuccessorConflictError.prototype;
const refreshCapacityExhaustedErrorPrototype =
  IdentitySessionFamilyRefreshCapacityExhaustedError.prototype;
const invalidRefreshCredentialIdErrorPrototype = InvalidIdentityRefreshCredentialIdError.prototype;
const invalidRefreshIdleLifetimeErrorPrototype =
  InvalidIdentityRefreshIdleLifetimeSecondsError.prototype;
const invalidAccessCredentialIdErrorPrototype = InvalidIdentityAccessCredentialIdError.prototype;
const invalidAccessLifetimeErrorPrototype = InvalidIdentityAccessLifetimeSecondsError.prototype;
const DECISION_INPUT_KEYS = capturedFreeze([
  'successorRefreshCredentialId',
  'refreshIdleLifetimeSeconds',
  'issuedAccessCredentialId',
  'accessLifetimeSeconds',
] as const);

type DecisionInputKey = (typeof DECISION_INPUT_KEYS)[number];
type WorkflowPhase =
  | 'provisional'
  | 'awaiting-load'
  | 'loading'
  | 'loaded'
  | 'deciding'
  | 'decided-rejected'
  | 'decided-rotated'
  | 'decided-reuse-detected'
  | 'failed'
  | 'closed';

declare const identityTransactionScopeBrand: unique symbol;
declare const identityTransactionContextBrand: unique symbol;
declare const identitySessionRefreshWorkflowControllerBrand: unique symbol;
declare const identitySessionRefreshLockedLoadOperationBrand: unique symbol;
declare const identitySessionRefreshLockedLoadResultBrand: unique symbol;
declare const identitySessionRefreshDecisionBrand: unique symbol;

/** Empty callback-visible identity for one future database transaction. */
export type IdentityTransactionScope = Readonly<{
  readonly [identityTransactionScopeBrand]: true;
}>;

export type IdentityTransactionContext = Readonly<{
  scope: IdentityTransactionScope;
  dbNow: IdentityInstant;
  readonly [identityTransactionContextBrand]: true;
}>;

/** Private capability retained by the future Unit of Work and store adapter. */
export type IdentitySessionRefreshWorkflowController = Readonly<{
  readonly [identitySessionRefreshWorkflowControllerBrand]: true;
}>;

export type IdentitySessionRefreshWorkflowBoundary = Readonly<{
  controller: IdentitySessionRefreshWorkflowController;
  scope: IdentityTransactionScope;
}>;

/** Query binding returned only inside the locked loader call stack. */
export type IdentitySessionRefreshLockedLoadOperation = Readonly<{
  refreshCredentialDigest: IdentityRefreshCredentialDigest;
  accountId: IdentityAccountSnapshot['id'];
  sessionId: IdentitySessionFamilySnapshot['id'];
  presentedRefreshCredentialId: IdentityRefreshCredentialSnapshot['id'];
  readonly [identitySessionRefreshLockedLoadOperationBrand]: true;
}>;

export type IdentitySessionRefreshLockedNotFound = Readonly<{
  kind: 'not-found';
  readonly [identitySessionRefreshLockedLoadResultBrand]: true;
}>;

export type IdentitySessionRefreshLockedFound = Readonly<{
  kind: 'found';
  account: IdentityAccount;
  sessionFamily: IdentitySessionFamily;
  presentedRefreshCredential: IdentityRefreshCredential;
  readonly [identitySessionRefreshLockedLoadResultBrand]: true;
}>;

export type IdentitySessionRefreshLockedLoadResult =
  IdentitySessionRefreshLockedNotFound | IdentitySessionRefreshLockedFound;

export type IdentitySessionRefreshDecisionInput = Readonly<{
  successorRefreshCredentialId: unknown;
  refreshIdleLifetimeSeconds: unknown;
  issuedAccessCredentialId: unknown;
  accessLifetimeSeconds: unknown;
}>;

export type IdentitySessionRefreshRejectedDecision = Readonly<{
  kind: 'rejected';
  readonly [identitySessionRefreshDecisionBrand]: true;
}>;

export type IdentitySessionRefreshRotatedDecision = Readonly<{
  kind: 'rotated';
  readonly [identitySessionRefreshDecisionBrand]: true;
}>;

export type IdentitySessionRefreshReuseDetectedDecision = Readonly<{
  kind: 'reuse-detected';
  readonly [identitySessionRefreshDecisionBrand]: true;
}>;

export type IdentitySessionRefreshDecision =
  | IdentitySessionRefreshRejectedDecision
  | IdentitySessionRefreshRotatedDecision
  | IdentitySessionRefreshReuseDetectedDecision;

export class InvalidIdentitySessionRefreshWorkflowError extends Error {
  public constructor() {
    super('Expected a valid Identity session refresh workflow transition');
    this.name = 'InvalidIdentitySessionRefreshWorkflowError';
  }
}

type LockedState = Readonly<{
  account: IdentityAccount;
  accountSnapshot: IdentityAccountSnapshot;
  sessionFamily: IdentitySessionFamily;
  sessionFamilySnapshot: IdentitySessionFamilySnapshot;
  presentedRefreshCredential: IdentityRefreshCredential;
  presentedRefreshCredentialSnapshot: IdentityRefreshCredentialSnapshot;
}>;

interface WorkflowState {
  phase: WorkflowPhase;
  readonly controller: IdentitySessionRefreshWorkflowController;
  readonly scope: IdentityTransactionScope;
  context: IdentityTransactionContext | undefined;
  dbNow: IdentityInstant | undefined;
  activeLoad: IdentitySessionRefreshLockedLoadOperation | undefined;
  loadResult: IdentitySessionRefreshLockedLoadResult | undefined;
  locked: LockedState | undefined;
  decision: IdentitySessionRefreshDecision | undefined;
}

type LoadRegistration = Readonly<{
  state: WorkflowState;
}>;

type LoadResultRegistration = Readonly<{
  state: WorkflowState;
  locked: LockedState | undefined;
}>;

type DecisionRegistration =
  | Readonly<{
      state: WorkflowState;
      kind: 'rejected';
      domainResult: IdentitySessionFamilyRefreshRejectedResult | undefined;
    }>
  | Readonly<{
      state: WorkflowState;
      kind: 'rotated';
      domainResult: IdentitySessionFamilyRefreshRotatedResult;
    }>
  | Readonly<{
      state: WorkflowState;
      kind: 'reuse-detected';
      domainResult: IdentitySessionFamilyRefreshReuseDetectedResult;
    }>;

const controllerStates = new WeakMap<object, WorkflowState>();
const scopeStates = new WeakMap<object, WorkflowState>();
const contextStates = new WeakMap<object, WorkflowState>();
const loadRegistrations = new WeakMap<object, LoadRegistration>();
const loadResultRegistrations = new WeakMap<object, LoadResultRegistration>();
const decisionRegistrations = new WeakMap<object, DecisionRegistration>();

function invalidWorkflow(): never {
  throw new InvalidIdentitySessionRefreshWorkflowError();
}

function isObject(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

function stateForController(value: unknown): WorkflowState {
  const state = isObject(value) ? controllerStates.get(value) : undefined;

  if (state === undefined || state.controller !== value) {
    invalidWorkflow();
  }

  return state;
}

function stateForContext(value: unknown): WorkflowState {
  const state = isObject(value) ? contextStates.get(value) : undefined;

  if (
    state === undefined ||
    state.context !== value ||
    state.dbNow === undefined ||
    scopeStates.get(state.scope) !== state
  ) {
    invalidWorkflow();
  }

  return state;
}

function authenticateActiveScope(state: WorkflowState, value: unknown): void {
  if (state.scope !== value || scopeStates.get(state.scope) !== state) {
    invalidWorkflow();
  }
}

function clearWorkflowReferences(state: WorkflowState): void {
  if (state.activeLoad !== undefined) {
    loadRegistrations.delete(state.activeLoad);
  }

  if (state.loadResult !== undefined) {
    loadResultRegistrations.delete(state.loadResult);
  }

  if (state.decision !== undefined) {
    decisionRegistrations.delete(state.decision);
  }

  state.activeLoad = undefined;
  state.loadResult = undefined;
  state.locked = undefined;
  state.decision = undefined;
}

function failWorkflow(state: WorkflowState): void {
  if (state.phase === 'closed') {
    return;
  }

  state.phase = 'failed';
  clearWorkflowReferences(state);
}

function snapshotOfAccount(value: unknown): IdentityAccountSnapshot {
  return capturedReflectApply(accountSnapshot, value, []);
}

function snapshotOfSessionFamily(value: unknown): IdentitySessionFamilySnapshot {
  return capturedReflectApply(sessionFamilySnapshot, value, []);
}

function snapshotOfRefreshCredential(value: unknown): IdentityRefreshCredentialSnapshot {
  return capturedReflectApply(refreshCredentialSnapshot, value, []);
}

function assertLoadedRelationships(
  operation: IdentitySessionRefreshLockedLoadOperation,
  accountValue: unknown,
  sessionFamilyValue: unknown,
  presentedRefreshCredentialValue: unknown,
): LockedState {
  const account = snapshotOfAccount(accountValue);
  const family = snapshotOfSessionFamily(sessionFamilyValue);
  const credential = snapshotOfRefreshCredential(presentedRefreshCredentialValue);

  if (
    account.id !== operation.accountId ||
    family.id !== operation.sessionId ||
    family.accountId !== operation.accountId ||
    family.accountId !== account.id ||
    credential.id !== operation.presentedRefreshCredentialId ||
    credential.sessionId !== operation.sessionId ||
    credential.sessionId !== family.id
  ) {
    invalidWorkflow();
  }

  return capturedFreeze({
    account: accountValue as IdentityAccount,
    accountSnapshot: account,
    sessionFamily: sessionFamilyValue as IdentitySessionFamily,
    sessionFamilySnapshot: family,
    presentedRefreshCredential: presentedRefreshCredentialValue as IdentityRefreshCredential,
    presentedRefreshCredentialSnapshot: credential,
  });
}

function authenticateActiveLoad(controllerValue: unknown, operationValue: unknown): WorkflowState {
  const state = stateForController(controllerValue);
  const registration = isObject(operationValue) ? loadRegistrations.get(operationValue) : undefined;

  if (
    state.phase !== 'loading' ||
    registration?.state !== state ||
    state.activeLoad !== operationValue
  ) {
    invalidWorkflow();
  }

  return state;
}

function authenticateDecisionInput(value: unknown): Readonly<Record<DecisionInputKey, unknown>> {
  if (
    typeof value !== 'object' ||
    value === null ||
    capturedIsArray(value) ||
    capturedGetPrototypeOf(value) !== objectPrototype ||
    !capturedIsFrozen(value)
  ) {
    invalidWorkflow();
  }

  const keys = capturedOwnKeys(value);

  if (
    keys.length !== DECISION_INPUT_KEYS.length ||
    !keys.every(
      (key) =>
        typeof key === 'string' && DECISION_INPUT_KEYS.some((expectedKey) => expectedKey === key),
    )
  ) {
    invalidWorkflow();
  }

  for (const key of DECISION_INPUT_KEYS) {
    const descriptor = capturedGetOwnPropertyDescriptor(value, key);

    if (
      descriptor?.enumerable !== true ||
      descriptor.configurable !== false ||
      ('value' in descriptor
        ? descriptor.writable !== false
        : typeof descriptor.get !== 'function' || descriptor.set !== undefined)
    ) {
      invalidWorkflow();
    }
  }

  return value as Readonly<Record<DecisionInputKey, unknown>>;
}

function hasMatchingBasis(
  result:
    IdentitySessionFamilyRefreshRotatedResult | IdentitySessionFamilyRefreshReuseDetectedResult,
  locked: LockedState,
): boolean {
  return (
    result.basis.accountId === locked.accountSnapshot.id &&
    result.basis.accountVersion === locked.accountSnapshot.version &&
    result.basis.sessionId === locked.sessionFamilySnapshot.id &&
    result.basis.sessionFamilyVersion === locked.sessionFamilySnapshot.version &&
    result.basis.presentedRefreshCredentialId === locked.presentedRefreshCredentialSnapshot.id &&
    result.basis.presentedRefreshCredentialSequence ===
      locked.presentedRefreshCredentialSnapshot.sequence
  );
}

function cappedDeadline(
  dbNow: IdentityInstant,
  lifetime: unknown,
  absoluteDeadline: IdentityInstant,
): IdentityInstant {
  const configuredDeadline = tryAddIdentitySeconds(dbNow, lifetime);

  if (
    configuredDeadline === null ||
    compareIdentityInstants(configuredDeadline, absoluteDeadline) > 0
  ) {
    return absoluteDeadline;
  }

  return configuredDeadline;
}

function assertRotatedResult(
  result: IdentitySessionFamilyRefreshRotatedResult,
  locked: LockedState,
  dbNow: IdentityInstant,
  inputValues: Readonly<Partial<Record<DecisionInputKey, unknown>>>,
): void {
  const family = snapshotOfSessionFamily(result.sessionFamily);
  const consumed = snapshotOfRefreshCredential(result.consumedRefreshCredential);
  const successor = snapshotOfRefreshCredential(result.successorRefreshCredential);
  const access = capturedReflectApply(accessCredentialSnapshot, result.issuedAccessCredential, []);
  const expectedRefreshDeadline = cappedDeadline(
    dbNow,
    inputValues.refreshIdleLifetimeSeconds,
    locked.sessionFamilySnapshot.refreshAbsoluteExpiresAt,
  );
  const expectedAccessDeadline = cappedDeadline(
    dbNow,
    inputValues.accessLifetimeSeconds,
    locked.sessionFamilySnapshot.refreshAbsoluteExpiresAt,
  );
  const fact = result.facts[0];

  if (
    !hasMatchingBasis(result, locked) ||
    family.id !== locked.sessionFamilySnapshot.id ||
    family.accountId !== locked.accountSnapshot.id ||
    family.version !== locked.sessionFamilySnapshot.version + 1 ||
    family.createdAt !== locked.sessionFamilySnapshot.createdAt ||
    family.lastRotatedAt !== dbNow ||
    family.refreshIdleExpiresAt !== expectedRefreshDeadline ||
    family.refreshAbsoluteExpiresAt !== locked.sessionFamilySnapshot.refreshAbsoluteExpiresAt ||
    family.revokedAt !== null ||
    family.closedReason !== null ||
    consumed.id !== locked.presentedRefreshCredentialSnapshot.id ||
    consumed.sessionId !== locked.sessionFamilySnapshot.id ||
    consumed.sequence !== locked.presentedRefreshCredentialSnapshot.sequence ||
    consumed.issuedAt !== locked.presentedRefreshCredentialSnapshot.issuedAt ||
    consumed.expiresAt !== locked.presentedRefreshCredentialSnapshot.expiresAt ||
    consumed.consumedAt !== dbNow ||
    consumed.successorId !== successor.id ||
    successor.id !== inputValues.successorRefreshCredentialId ||
    successor.sessionId !== locked.sessionFamilySnapshot.id ||
    successor.sequence !== locked.presentedRefreshCredentialSnapshot.sequence + 1 ||
    successor.issuedAt !== dbNow ||
    successor.expiresAt !== expectedRefreshDeadline ||
    successor.consumedAt !== null ||
    successor.successorId !== null ||
    access.id !== inputValues.issuedAccessCredentialId ||
    access.sessionId !== locked.sessionFamilySnapshot.id ||
    access.sequence !== successor.sequence ||
    access.issuedAt !== dbNow ||
    access.expiresAt !== expectedAccessDeadline ||
    fact.sessionId !== locked.sessionFamilySnapshot.id ||
    fact.accountId !== locked.accountSnapshot.id ||
    fact.version !== family.version ||
    fact.occurredAt !== dbNow
  ) {
    invalidWorkflow();
  }
}

function assertReuseResult(
  result: IdentitySessionFamilyRefreshReuseDetectedResult,
  locked: LockedState,
  dbNow: IdentityInstant,
): void {
  const family = snapshotOfSessionFamily(result.sessionFamily);
  const fact = result.facts[0];

  if (
    !hasMatchingBasis(result, locked) ||
    result.reusedRefreshCredential !== locked.presentedRefreshCredential ||
    family.id !== locked.sessionFamilySnapshot.id ||
    family.accountId !== locked.accountSnapshot.id ||
    family.version !== locked.sessionFamilySnapshot.version + 1 ||
    family.createdAt !== locked.sessionFamilySnapshot.createdAt ||
    family.lastRotatedAt !== locked.sessionFamilySnapshot.lastRotatedAt ||
    family.refreshIdleExpiresAt !== locked.sessionFamilySnapshot.refreshIdleExpiresAt ||
    family.refreshAbsoluteExpiresAt !== locked.sessionFamilySnapshot.refreshAbsoluteExpiresAt ||
    family.revokedAt !== dbNow ||
    family.closedReason !== 'REFRESH_REUSE_DETECTED' ||
    fact.sessionId !== locked.sessionFamilySnapshot.id ||
    fact.accountId !== locked.accountSnapshot.id ||
    fact.version !== family.version ||
    fact.occurredAt !== dbNow
  ) {
    invalidWorkflow();
  }
}

function assertRejectedResult(
  result: IdentitySessionFamilyRefreshRejectedResult,
  locked: LockedState,
): void {
  if (
    result.sessionFamily !== locked.sessionFamily ||
    result.presentedRefreshCredential !== locked.presentedRefreshCredential
  ) {
    invalidWorkflow();
  }
}

function createDecision(
  state: WorkflowState,
  result: IdentitySessionFamilyRefreshResult | undefined,
): IdentitySessionRefreshDecision {
  if (state.phase !== 'deciding') {
    invalidWorkflow();
  }

  const kind = result?.kind ?? 'rejected';
  const decision = capturedFreeze({ kind }) as IdentitySessionRefreshDecision;

  if (kind === 'rotated') {
    state.phase = 'decided-rotated';
    decisionRegistrations.set(
      decision,
      capturedFreeze({
        state,
        kind,
        domainResult: result as IdentitySessionFamilyRefreshRotatedResult,
      }),
    );
  } else if (kind === 'reuse-detected') {
    state.phase = 'decided-reuse-detected';
    decisionRegistrations.set(
      decision,
      capturedFreeze({
        state,
        kind,
        domainResult: result as IdentitySessionFamilyRefreshReuseDetectedResult,
      }),
    );
  } else {
    state.phase = 'decided-rejected';
    decisionRegistrations.set(
      decision,
      capturedFreeze({
        state,
        kind: 'rejected',
        domainResult: undefined,
      }),
    );
  }

  state.decision = decision;
  if (state.loadResult !== undefined) {
    loadResultRegistrations.delete(state.loadResult);
  }
  state.loadResult = undefined;
  state.locked = undefined;
  return decision;
}

function isStillDeciding(
  state: WorkflowState,
  context: IdentityTransactionContext,
  load: IdentitySessionRefreshLockedLoadResult,
  locked: LockedState,
  dbNow: IdentityInstant,
): boolean {
  return (
    state.phase === 'deciding' &&
    state.context === context &&
    contextStates.get(context) === state &&
    state.scope === context.scope &&
    scopeStates.get(state.scope) === state &&
    state.loadResult === load &&
    state.locked === locked &&
    state.dbNow === dbNow
  );
}

function assertStillDeciding(
  state: WorkflowState,
  context: IdentityTransactionContext,
  load: IdentitySessionRefreshLockedLoadResult,
  locked: LockedState,
  dbNow: IdentityInstant,
): void {
  if (!isStillDeciding(state, context, load, locked, dbNow)) {
    invalidWorkflow();
  }
}

function recreateExpectedRefreshDomainError(value: unknown): Error | undefined {
  if (!isObject(value)) {
    return undefined;
  }

  let prototype: object | null;

  try {
    const candidatePrototype: unknown = capturedGetPrototypeOf(value);

    if (candidatePrototype !== null && !isObject(candidatePrototype)) {
      return undefined;
    }

    prototype = candidatePrototype;
  } catch {
    return undefined;
  }

  if (prototype === invalidSessionFamilyRefreshStateErrorPrototype) {
    return new InvalidIdentitySessionFamilyRefreshStateError();
  }

  if (prototype === refreshTimestampRegressionErrorPrototype) {
    return new IdentitySessionFamilyRefreshTimestampRegressionError();
  }

  if (prototype === refreshSuccessorConflictErrorPrototype) {
    return new IdentitySessionFamilyRefreshSuccessorConflictError();
  }

  if (prototype === refreshCapacityExhaustedErrorPrototype) {
    return new IdentitySessionFamilyRefreshCapacityExhaustedError();
  }

  if (prototype === invalidRefreshCredentialIdErrorPrototype) {
    return new InvalidIdentityRefreshCredentialIdError();
  }

  if (prototype === invalidRefreshIdleLifetimeErrorPrototype) {
    return new InvalidIdentityRefreshIdleLifetimeSecondsError();
  }

  if (prototype === invalidAccessCredentialIdErrorPrototype) {
    return new InvalidIdentityAccessCredentialIdError();
  }

  if (prototype === invalidAccessLifetimeErrorPrototype) {
    return new InvalidIdentityAccessLifetimeSecondsError();
  }

  return undefined;
}

/** Creates a provisional private controller and its distinct callback-visible scope. */
export function createIdentitySessionRefreshWorkflow(): IdentitySessionRefreshWorkflowBoundary {
  const controller = capturedFreeze({}) as IdentitySessionRefreshWorkflowController;
  const scope = capturedFreeze({}) as IdentityTransactionScope;
  const state: WorkflowState = {
    phase: 'provisional',
    controller,
    scope,
    context: undefined,
    dbNow: undefined,
    activeLoad: undefined,
    loadResult: undefined,
    locked: undefined,
    decision: undefined,
  };

  controllerStates.set(controller, state);
  scopeStates.set(scope, state);

  return capturedFreeze({ controller, scope });
}

/** Activates a provisional workflow only after the future adapter has BEGIN and writer time. */
export function activateIdentitySessionRefreshWorkflow(
  controllerValue: IdentitySessionRefreshWorkflowController,
  dbNowValue: unknown,
): IdentityTransactionContext {
  const state = stateForController(controllerValue);

  if (state.phase !== 'provisional') {
    invalidWorkflow();
  }

  state.phase = 'failed';
  let dbNow: IdentityInstant;

  try {
    dbNow = parseIdentityInstant(dbNowValue);
  } catch (error) {
    clearWorkflowReferences(state);
    throw error;
  }

  const context = capturedFreeze({ scope: state.scope, dbNow }) as IdentityTransactionContext;
  state.context = context;
  state.dbNow = dbNow;
  state.phase = 'awaiting-load';
  contextStates.set(context, state);

  return context;
}

/** Consumes one authentic discovery ticket before the locked adapter may issue SQL. */
export function beginIdentitySessionRefreshLockedLoad(
  controllerValue: IdentitySessionRefreshWorkflowController,
  scopeValue: IdentityTransactionScope,
  discoveryAuthority: IdentitySessionRefreshDiscoveryBoundaryAuthority,
  ticket: IdentitySessionRefreshDiscoveryFoundTicket,
): IdentitySessionRefreshLockedLoadOperation {
  const state = stateForController(controllerValue);

  if (state.phase !== 'awaiting-load') {
    invalidWorkflow();
  }

  authenticateActiveScope(state, scopeValue);
  const consumed = consumeIdentitySessionRefreshDiscoveryFoundTicket(discoveryAuthority, ticket);
  const operation = capturedFreeze({
    refreshCredentialDigest: consumed.refreshCredentialDigest,
    accountId: consumed.accountId,
    sessionId: consumed.sessionId,
    presentedRefreshCredentialId: consumed.presentedRefreshCredentialId,
  }) as IdentitySessionRefreshLockedLoadOperation;

  state.phase = 'loading';
  state.activeLoad = operation;
  loadRegistrations.set(operation, capturedFreeze({ state }));

  return operation;
}

export function completeIdentitySessionRefreshLockedLoadNotFound(
  controllerValue: IdentitySessionRefreshWorkflowController,
  operationValue: IdentitySessionRefreshLockedLoadOperation,
): IdentitySessionRefreshLockedNotFound {
  const state = authenticateActiveLoad(controllerValue, operationValue);
  const result = capturedFreeze({
    kind: 'not-found' as const,
  }) as IdentitySessionRefreshLockedNotFound;

  state.phase = 'loaded';
  loadRegistrations.delete(operationValue);
  state.activeLoad = undefined;
  state.loadResult = result;
  loadResultRegistrations.set(result, capturedFreeze({ state, locked: undefined }));

  return result;
}

export function completeIdentitySessionRefreshLockedLoadFound(
  controllerValue: IdentitySessionRefreshWorkflowController,
  operationValue: IdentitySessionRefreshLockedLoadOperation,
  account: unknown,
  sessionFamily: unknown,
  presentedRefreshCredential: unknown,
): IdentitySessionRefreshLockedFound {
  const state = authenticateActiveLoad(controllerValue, operationValue);
  state.phase = 'failed';

  try {
    const locked = assertLoadedRelationships(
      operationValue,
      account,
      sessionFamily,
      presentedRefreshCredential,
    );
    const result = capturedFreeze({
      kind: 'found' as const,
      account: locked.account,
      sessionFamily: locked.sessionFamily,
      presentedRefreshCredential: locked.presentedRefreshCredential,
    }) as IdentitySessionRefreshLockedFound;

    state.phase = 'loaded';
    loadRegistrations.delete(operationValue);
    state.activeLoad = undefined;
    state.loadResult = result;
    state.locked = locked;
    loadResultRegistrations.set(result, capturedFreeze({ state, locked }));

    return result;
  } catch {
    failWorkflow(state);
    invalidWorkflow();
  }
}

/** Permanently fails a workflow whose authentic locked query or mapping failed. */
export function failIdentitySessionRefreshLockedLoad(
  controllerValue: IdentitySessionRefreshWorkflowController,
  operationValue: IdentitySessionRefreshLockedLoadOperation,
): void {
  const state = authenticateActiveLoad(controllerValue, operationValue);
  failWorkflow(state);
}

/** Performs the one refresh decision with the registered rows and transaction time. */
export function decideIdentitySessionRefresh(
  contextValue: IdentityTransactionContext,
  loadValue: IdentitySessionRefreshLockedLoadResult,
  inputValue: unknown,
): IdentitySessionRefreshDecision {
  const state = stateForContext(contextValue);
  const loadRegistration = isObject(loadValue) ? loadResultRegistrations.get(loadValue) : undefined;

  if (
    state.phase !== 'loaded' ||
    state.loadResult !== loadValue ||
    loadRegistration?.state !== state ||
    loadRegistration.locked !== state.locked
  ) {
    invalidWorkflow();
  }

  state.phase = 'deciding';

  if (loadValue.kind === 'not-found') {
    return createDecision(state, undefined);
  }

  const locked = state.locked;
  const dbNow = state.dbNow;

  if (locked === undefined || dbNow === undefined) {
    failWorkflow(state);
    invalidWorkflow();
  }

  let decisionInput: Readonly<Record<DecisionInputKey, unknown>> | undefined;
  const inputValues: Partial<Record<DecisionInputKey, unknown>> = {};
  const inputReads = new Set<DecisionInputKey>();
  const readInput = (key: DecisionInputKey): unknown => {
    if (!inputReads.has(key)) {
      try {
        decisionInput ??= authenticateDecisionInput(inputValue);
        inputValues[key] = capturedReflectGet(decisionInput, key, decisionInput);
        inputReads.add(key);
      } catch {
        invalidWorkflow();
      }
    }

    return inputValues[key];
  };
  const domainInput = capturedFreeze({
    account: locked.account,
    presentedRefreshCredential: locked.presentedRefreshCredential,
    occurredAt: dbNow,
    get successorRefreshCredentialId(): unknown {
      return readInput('successorRefreshCredentialId');
    },
    get refreshIdleLifetimeSeconds(): unknown {
      return readInput('refreshIdleLifetimeSeconds');
    },
    get issuedAccessCredentialId(): unknown {
      return readInput('issuedAccessCredentialId');
    },
    get accessLifetimeSeconds(): unknown {
      return readInput('accessLifetimeSeconds');
    },
  });
  let result: IdentitySessionFamilyRefreshResult;

  try {
    result = capturedReflectApply(presentRefreshCredential, locked.sessionFamily, [domainInput]);
  } catch (error) {
    assertStillDeciding(state, contextValue, loadValue, locked, dbNow);
    const recreatedError = recreateExpectedRefreshDomainError(error);
    assertStillDeciding(state, contextValue, loadValue, locked, dbNow);
    failWorkflow(state);

    if (recreatedError !== undefined) {
      throw recreatedError;
    }

    invalidWorkflow();
  }

  assertStillDeciding(state, contextValue, loadValue, locked, dbNow);

  try {
    switch (result.kind) {
      case 'rotated':
        assertRotatedResult(result, locked, dbNow, inputValues);
        break;
      case 'reuse-detected':
        assertReuseResult(result, locked, dbNow);
        break;
      case 'rejected':
        assertRejectedResult(result, locked);
        break;
      default:
        invalidWorkflow();
    }
  } catch {
    if (isStillDeciding(state, contextValue, loadValue, locked, dbNow)) {
      failWorkflow(state);
    }
    invalidWorkflow();
  }

  assertStillDeciding(state, contextValue, loadValue, locked, dbNow);
  return createDecision(state, result);
}

/** Privileged writer-only extractor; the callback-visible decision remains kind-only. */
export function inspectIdentitySessionRefreshRotatedDecision(
  controllerValue: IdentitySessionRefreshWorkflowController,
  decisionValue: IdentitySessionRefreshRotatedDecision,
): IdentitySessionFamilyRefreshRotatedResult {
  const state = stateForController(controllerValue);
  const registration = isObject(decisionValue)
    ? decisionRegistrations.get(decisionValue)
    : undefined;

  if (
    state.phase !== 'decided-rotated' ||
    state.decision !== decisionValue ||
    registration?.state !== state ||
    registration.kind !== 'rotated'
  ) {
    invalidWorkflow();
  }

  return registration.domainResult;
}

/** Privileged writer-only extractor for the reuse terminal action. */
export function inspectIdentitySessionRefreshReuseDetectedDecision(
  controllerValue: IdentitySessionRefreshWorkflowController,
  decisionValue: IdentitySessionRefreshReuseDetectedDecision,
): IdentitySessionFamilyRefreshReuseDetectedResult {
  const state = stateForController(controllerValue);
  const registration = isObject(decisionValue)
    ? decisionRegistrations.get(decisionValue)
    : undefined;

  if (
    state.phase !== 'decided-reuse-detected' ||
    state.decision !== decisionValue ||
    registration?.state !== state ||
    registration.kind !== 'reuse-detected'
  ) {
    invalidWorkflow();
  }

  return registration.domainResult;
}

/** Invalidates escaped capabilities and clears strong aggregate references before settlement. */
export function closeIdentitySessionRefreshWorkflow(
  controllerValue: IdentitySessionRefreshWorkflowController,
): void {
  const state = stateForController(controllerValue);

  if (state.phase === 'closed') {
    invalidWorkflow();
  }

  if (state.context !== undefined) {
    contextStates.delete(state.context);
  }

  state.phase = 'closed';
  state.context = undefined;
  state.dbNow = undefined;
  clearWorkflowReferences(state);
}
