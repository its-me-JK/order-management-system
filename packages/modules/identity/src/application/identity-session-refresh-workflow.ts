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
import {
  createIdentityAuthenticatedPrincipalFromAuthority,
  type IdentityAuthenticatedPrincipal,
} from './identity-authenticated-principal';
import { InvalidIdentityAuthenticatedPrincipalError } from './identity-authenticated-principal.errors';
import {
  claimIdentitySessionCredentialAttempt,
  inspectIdentitySessionCredentialAttemptDigestView,
  settleIdentitySessionCredentialAttemptAfterRefreshCommit,
  settleIdentitySessionCredentialAttemptAfterRefreshRevocation,
  type IdentitySessionCredentialAttempt,
  type IdentitySessionCredentialAttemptDigestView,
} from './identity-session-credential-attempt';
import type {
  IdentityAccessCredentialDigest,
  IdentityRefreshCredentialDigest,
} from './identity-session-credential-digest.values';
import {
  consumeIdentitySessionRefreshDiscoveryFoundTicket,
  type IdentitySessionRefreshDiscoveryBoundaryAuthority,
  type IdentitySessionRefreshDiscoveryFoundTicket,
} from './identity-session-refresh-discovery';
import {
  parseIdentitySecurityEventId,
  type IdentitySecurityEventId,
} from './identity-security-event.values';

const objectPrototype = Object.prototype;
const capturedFreeze = Object.freeze;
const capturedGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const capturedGetPrototypeOf = Object.getPrototypeOf;
const capturedIsArray = Array.isArray;
const capturedIsFrozen = Object.isFrozen;
const capturedOwnKeys = Reflect.ownKeys;
const capturedReflectApply = Reflect.apply;
const capturedReflectGet = Reflect.get;
// eslint-disable-next-line @typescript-eslint/unbound-method
const capturedWeakMapDelete = WeakMap.prototype.delete;
// eslint-disable-next-line @typescript-eslint/unbound-method
const capturedWeakMapGet = WeakMap.prototype.get;
// eslint-disable-next-line @typescript-eslint/unbound-method
const capturedWeakMapSet = WeakMap.prototype.set;
const createAuthenticatedPrincipal = createIdentityAuthenticatedPrincipalFromAuthority;
const settleCredentialAttemptAfterRefreshCommit =
  settleIdentitySessionCredentialAttemptAfterRefreshCommit;
const settleCredentialAttemptAfterRefreshRevocation =
  settleIdentitySessionCredentialAttemptAfterRefreshRevocation;
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
  | 'attempt-admitted'
  | 'awaiting-load'
  | 'loading'
  | 'loaded'
  | 'deciding'
  | 'decided-rejected'
  | 'decided-rotated'
  | 'decided-reuse-detected'
  | 'terminal-action-started'
  | 'terminal'
  | 'failed'
  | 'closed';

declare const identityTransactionScopeBrand: unique symbol;
declare const identityTransactionContextBrand: unique symbol;
declare const identitySessionRefreshWorkflowControllerBrand: unique symbol;
declare const identitySessionRefreshLockedLoadOperationBrand: unique symbol;
declare const identitySessionRefreshLockedLoadResultBrand: unique symbol;
declare const identitySessionRefreshDecisionBrand: unique symbol;
declare const identitySessionRefreshRotatedPersistenceActionBrand: unique symbol;
declare const identitySessionRefreshReusePersistenceActionBrand: unique symbol;
declare const identityTransactionEvidenceBrand: unique symbol;
declare const identitySessionRefreshCommittedCompletionBrand: unique symbol;

/** Empty callback-visible identity for one package-owned database transaction. */
export type IdentityTransactionScope = Readonly<{
  readonly [identityTransactionScopeBrand]: true;
}>;

export type IdentityTransactionContext = Readonly<{
  scope: IdentityTransactionScope;
  dbNow: IdentityInstant;
  readonly [identityTransactionContextBrand]: true;
}>;

/** Private capability retained by the Unit of Work and store adapter. */
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

/** Empty writer-owned authority for one already-authenticated rotation action. */
export type IdentitySessionRefreshRotatedPersistenceAction = Readonly<{
  readonly [identitySessionRefreshRotatedPersistenceActionBrand]: true;
}>;

/** Empty writer-owned authority for one already-authenticated reuse action. */
export type IdentitySessionRefreshReusePersistenceAction = Readonly<{
  readonly [identitySessionRefreshReusePersistenceActionBrand]: true;
}>;

export type IdentitySessionRefreshRotatedPersistencePlan = Readonly<{
  result: IdentitySessionFamilyRefreshRotatedResult;
  accessCredentialDigest: IdentityAccessCredentialDigest;
  refreshCredentialDigest: IdentityRefreshCredentialDigest;
  securityEventId: IdentitySecurityEventId;
}>;

export type IdentitySessionRefreshReusePersistencePlan = Readonly<{
  result: IdentitySessionFamilyRefreshReuseDetectedResult;
  securityEventId: IdentitySecurityEventId;
}>;

export type IdentityTransactionRejectedEvidence = Readonly<{
  kind: 'rejected';
  readonly [identityTransactionEvidenceBrand]: true;
}>;

export type IdentityTransactionRefreshReuseDetectedEvidence = Readonly<{
  kind: 'reuse-detected';
  readonly [identityTransactionEvidenceBrand]: true;
}>;

export type IdentityTransactionRefreshRotatedEvidence = Readonly<{
  kind: 'rotated';
  principal: IdentityAuthenticatedPrincipal;
  accessCredentialIssuedAt: IdentityInstant;
  accessCredentialExpiresAt: IdentityInstant;
  refreshIdleExpiresAt: IdentityInstant;
  refreshAbsoluteExpiresAt: IdentityInstant;
  readonly [identityTransactionEvidenceBrand]: true;
}>;

/** Pending callback evidence. It is neither committed nor credential-delivery authority. */
export type IdentityTransactionEvidence =
  | IdentityTransactionRejectedEvidence
  | IdentityTransactionRefreshReuseDetectedEvidence
  | IdentityTransactionRefreshRotatedEvidence;

/** Distinct authority that a concrete adapter may activate only after commit acknowledgement. */
export type IdentitySessionRefreshCommittedCompletion = Readonly<{
  kind: 'committed';
  evidence: IdentityTransactionEvidence;
  readonly [identitySessionRefreshCommittedCompletionBrand]: true;
}>;

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
  attempt: IdentitySessionCredentialAttempt | undefined;
  attemptDigestView: IdentitySessionCredentialAttemptDigestView | undefined;
  terminalAction:
    | IdentitySessionRefreshRotatedPersistenceAction
    | IdentitySessionRefreshReusePersistenceAction
    | undefined;
  evidence: IdentityTransactionEvidence | undefined;
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

type TerminalActionRegistration =
  | Readonly<{
      state: WorkflowState;
      kind: 'rotated';
      decision: IdentitySessionRefreshRotatedDecision;
      result: IdentitySessionFamilyRefreshRotatedResult;
      digestView: IdentitySessionCredentialAttemptDigestView;
      securityEventId: IdentitySecurityEventId;
    }>
  | Readonly<{
      state: WorkflowState;
      kind: 'reuse-detected';
      decision: IdentitySessionRefreshReuseDetectedDecision;
      result: IdentitySessionFamilyRefreshReuseDetectedResult;
      securityEventId: IdentitySecurityEventId;
    }>;

type EvidenceStatus = 'pending' | 'consumed';

interface EvidenceRegistration {
  readonly state: WorkflowState;
  readonly scope: IdentityTransactionScope;
  readonly decision: IdentitySessionRefreshDecision;
  readonly attempt: IdentitySessionCredentialAttempt;
  readonly kind: IdentityTransactionEvidence['kind'];
  committedCompletion: IdentitySessionRefreshCommittedCompletion | undefined;
  status: EvidenceStatus;
}

type CompletionStatus = 'prepared' | 'committed' | 'revoked';

interface CompletionRegistration {
  state: WorkflowState | undefined;
  pendingEvidence: IdentityTransactionEvidence | undefined;
  attempt: IdentitySessionCredentialAttempt | undefined;
  readonly kind: IdentityTransactionEvidence['kind'];
  status: CompletionStatus;
}

const controllerStates = new WeakMap<object, WorkflowState>();
const scopeStates = new WeakMap<object, WorkflowState>();
const contextStates = new WeakMap<object, WorkflowState>();
const loadRegistrations = new WeakMap<object, LoadRegistration>();
const loadResultRegistrations = new WeakMap<object, LoadResultRegistration>();
const decisionRegistrations = new WeakMap<object, DecisionRegistration>();
const terminalActionRegistrations = new WeakMap<object, TerminalActionRegistration>();
const evidenceRegistrations = new WeakMap<object, EvidenceRegistration>();
const completionRegistrations = new WeakMap<object, CompletionRegistration>();

function invalidWorkflow(): never {
  throw new InvalidIdentitySessionRefreshWorkflowError();
}

function isObject(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

function readWeakMap<Value>(map: WeakMap<object, Value>, key: object): Value | undefined {
  return capturedReflectApply(capturedWeakMapGet, map, [key]) as Value | undefined;
}

function writeWeakMap<Value>(map: WeakMap<object, Value>, key: object, value: Value): void {
  capturedReflectApply(capturedWeakMapSet, map, [key, value]);
}

function deleteWeakMapValue<Value>(map: WeakMap<object, Value>, key: object): boolean {
  return capturedReflectApply(capturedWeakMapDelete, map, [key]);
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

function authenticateAdmittedAttempt(
  state: WorkflowState,
): IdentitySessionCredentialAttemptDigestView {
  if (state.attempt === undefined || state.attemptDigestView === undefined) {
    invalidWorkflow();
  }

  try {
    return inspectIdentitySessionCredentialAttemptDigestView(
      state.attemptDigestView,
      state.controller,
    );
  } catch {
    state.attempt = undefined;
    state.attemptDigestView = undefined;
    failWorkflow(state);
    invalidWorkflow();
  }
}

function clearTerminalAction(state: WorkflowState): void {
  if (state.terminalAction !== undefined) {
    terminalActionRegistrations.delete(state.terminalAction);
  }

  state.terminalAction = undefined;
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

  clearTerminalAction(state);

  state.activeLoad = undefined;
  state.loadResult = undefined;
  state.locked = undefined;
  state.decision = undefined;
}

function createPreparedCommittedCompletion(
  evidence: IdentityTransactionEvidence,
): IdentitySessionRefreshCommittedCompletion {
  return capturedFreeze({
    kind: 'committed' as const,
    evidence,
  }) as IdentitySessionRefreshCommittedCompletion;
}

function revokePendingEvidence(state: WorkflowState): boolean {
  if (state.evidence === undefined) {
    return true;
  }

  const registration = evidenceRegistrations.get(state.evidence);
  let cleanupSucceeded = true;

  if (registration?.state === state && registration.status === 'pending') {
    cleanupSucceeded = retireAdmittedAttempt(state);
    evidenceRegistrations.delete(state.evidence);
  }

  state.evidence = undefined;
  return cleanupSucceeded;
}

function retireAdmittedAttempt(state: WorkflowState): boolean {
  if (state.attempt === undefined) {
    state.attemptDigestView = undefined;
    return true;
  }

  const attempt = state.attempt;
  const retired = settleCredentialAttemptAfterRefreshRevocation(attempt, state.controller);

  state.attempt = undefined;
  state.attemptDigestView = undefined;
  return retired;
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

function snapshotOfAccessCredential(
  value: unknown,
): ReturnType<IdentityAccessCredential['toSnapshot']> {
  return capturedReflectApply(accessCredentialSnapshot, value, []);
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
    attempt: undefined,
    attemptDigestView: undefined,
    terminalAction: undefined,
    evidence: undefined,
  };

  controllerStates.set(controller, state);
  scopeStates.set(scope, state);

  return capturedFreeze({ controller, scope });
}

/**
 * Creates the only workflow variant eligible to mint transaction evidence.
 * The verified credential attempt is claimed synchronously by the private controller.
 */
export function createIdentitySessionRefreshAttemptBoundWorkflow(
  attemptValue: IdentitySessionCredentialAttempt,
): IdentitySessionRefreshWorkflowBoundary {
  const boundary = createIdentitySessionRefreshWorkflow();
  const state = stateForController(boundary.controller);

  state.phase = 'failed';

  try {
    const digestView = claimIdentitySessionCredentialAttempt(attemptValue, boundary.controller);
    state.attempt = attemptValue;
    state.attemptDigestView = digestView;
    state.phase = 'attempt-admitted';
    return boundary;
  } catch (error) {
    clearWorkflowReferences(state);
    scopeStates.delete(state.scope);
    throw error;
  }
}

/** Activates a provisional workflow only after the future adapter has BEGIN and writer time. */
export function activateIdentitySessionRefreshWorkflow(
  controllerValue: IdentitySessionRefreshWorkflowController,
  dbNowValue: unknown,
): IdentityTransactionContext {
  const state = stateForController(controllerValue);

  if (state.phase !== 'provisional' && state.phase !== 'attempt-admitted') {
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

function registerPendingEvidence<Evidence extends IdentityTransactionEvidence>(
  state: WorkflowState,
  decision: IdentitySessionRefreshDecision,
  evidence: Evidence,
): Evidence {
  if (
    state.evidence !== undefined ||
    state.attempt === undefined ||
    state.decision !== decision ||
    scopeStates.get(state.scope) !== state
  ) {
    invalidWorkflow();
  }

  authenticateAdmittedAttempt(state);
  const registration: EvidenceRegistration = {
    state,
    scope: state.scope,
    decision,
    attempt: state.attempt,
    kind: evidence.kind,
    committedCompletion: undefined,
    status: 'pending',
  };

  evidenceRegistrations.set(evidence, registration);
  state.evidence = evidence;
  state.phase = 'terminal';
  decisionRegistrations.delete(decision);
  state.decision = undefined;
  clearTerminalAction(state);
  return evidence;
}

function authenticateRotatedAction(
  controllerValue: unknown,
  actionValue: unknown,
): Readonly<{
  state: WorkflowState;
  registration: Extract<TerminalActionRegistration, Readonly<{ kind: 'rotated' }>>;
}> {
  const state = stateForController(controllerValue);
  const registration = isObject(actionValue)
    ? terminalActionRegistrations.get(actionValue)
    : undefined;

  if (
    state.phase !== 'terminal-action-started' ||
    state.terminalAction !== actionValue ||
    registration?.state !== state ||
    registration.kind !== 'rotated'
  ) {
    invalidWorkflow();
  }

  return capturedFreeze({ state, registration });
}

function authenticateReuseAction(
  controllerValue: unknown,
  actionValue: unknown,
): Readonly<{
  state: WorkflowState;
  registration: Extract<TerminalActionRegistration, Readonly<{ kind: 'reuse-detected' }>>;
}> {
  const state = stateForController(controllerValue);
  const registration = isObject(actionValue)
    ? terminalActionRegistrations.get(actionValue)
    : undefined;

  if (
    state.phase !== 'terminal-action-started' ||
    state.terminalAction !== actionValue ||
    registration?.state !== state ||
    registration.kind !== 'reuse-detected'
  ) {
    invalidWorkflow();
  }

  return capturedFreeze({ state, registration });
}

function isStillCompletingRotatedAction(
  state: WorkflowState,
  action: IdentitySessionRefreshRotatedPersistenceAction,
  registration: Extract<TerminalActionRegistration, Readonly<{ kind: 'rotated' }>>,
): boolean {
  return (
    state.phase === 'failed' &&
    state.terminalAction === action &&
    terminalActionRegistrations.get(action) === registration
  );
}

/** Completes the only terminal path that deliberately performs no persistence. */
export function completeIdentitySessionRefreshRejected(
  controllerValue: IdentitySessionRefreshWorkflowController,
  scopeValue: IdentityTransactionScope,
  decisionValue: IdentitySessionRefreshRejectedDecision,
): IdentityTransactionRejectedEvidence {
  const state = stateForController(controllerValue);
  const registration = isObject(decisionValue)
    ? decisionRegistrations.get(decisionValue)
    : undefined;

  if (
    state.phase !== 'decided-rejected' ||
    state.decision !== decisionValue ||
    registration?.state !== state ||
    registration.kind !== 'rejected' ||
    state.attempt === undefined ||
    state.attemptDigestView === undefined
  ) {
    invalidWorkflow();
  }

  authenticateActiveScope(state, scopeValue);
  authenticateAdmittedAttempt(state);
  const evidence = capturedFreeze({
    kind: 'rejected' as const,
  }) as IdentityTransactionRejectedEvidence;
  return registerPendingEvidence(state, decisionValue, evidence);
}

/** Authenticates and starts the single rotation persistence action. */
export function beginIdentitySessionRefreshRotatedPersistence(
  controllerValue: IdentitySessionRefreshWorkflowController,
  scopeValue: IdentityTransactionScope,
  decisionValue: IdentitySessionRefreshRotatedDecision,
  securityEventIdValue: unknown,
): IdentitySessionRefreshRotatedPersistenceAction {
  const state = stateForController(controllerValue);
  const registration = isObject(decisionValue)
    ? decisionRegistrations.get(decisionValue)
    : undefined;

  if (
    state.phase !== 'decided-rotated' ||
    state.decision !== decisionValue ||
    registration?.state !== state ||
    registration.kind !== 'rotated' ||
    state.attempt === undefined ||
    state.attemptDigestView === undefined
  ) {
    invalidWorkflow();
  }

  authenticateActiveScope(state, scopeValue);
  const securityEventId = parseIdentitySecurityEventId(securityEventIdValue);
  const digestView = authenticateAdmittedAttempt(state);

  const action = capturedFreeze({}) as IdentitySessionRefreshRotatedPersistenceAction;
  terminalActionRegistrations.set(
    action,
    capturedFreeze({
      state,
      kind: 'rotated' as const,
      decision: decisionValue,
      result: registration.domainResult,
      digestView,
      securityEventId,
    }),
  );
  state.terminalAction = action;
  state.phase = 'terminal-action-started';
  return action;
}

/** Returns the exact write material registered to one authentic rotation action. */
export function inspectIdentitySessionRefreshRotatedPersistence(
  controllerValue: IdentitySessionRefreshWorkflowController,
  actionValue: IdentitySessionRefreshRotatedPersistenceAction,
): IdentitySessionRefreshRotatedPersistencePlan {
  const { state, registration } = authenticateRotatedAction(controllerValue, actionValue);
  let digestView: IdentitySessionCredentialAttemptDigestView;

  try {
    digestView = inspectIdentitySessionCredentialAttemptDigestView(
      registration.digestView,
      state.controller,
    );
  } catch {
    failWorkflow(state);
    invalidWorkflow();
  }

  return capturedFreeze({
    result: registration.result,
    accessCredentialDigest: digestView.accessCredentialDigest,
    refreshCredentialDigest: digestView.refreshCredentialDigest,
    securityEventId: registration.securityEventId,
  });
}

/** Mints pending rotation evidence only after the future writer reports all statements complete. */
export function completeIdentitySessionRefreshRotatedPersistence(
  controllerValue: IdentitySessionRefreshWorkflowController,
  actionValue: IdentitySessionRefreshRotatedPersistenceAction,
  authorityProjectionValue: unknown,
): IdentityTransactionRefreshRotatedEvidence {
  const { state, registration } = authenticateRotatedAction(controllerValue, actionValue);
  authenticateAdmittedAttempt(state);
  state.phase = 'failed';
  let principal: IdentityAuthenticatedPrincipal;

  try {
    principal = createAuthenticatedPrincipal(authorityProjectionValue);
  } catch {
    clearWorkflowReferences(state);
    throw new InvalidIdentityAuthenticatedPrincipalError();
  }

  if (!isStillCompletingRotatedAction(state, actionValue, registration)) {
    invalidWorkflow();
  }

  if (
    principal.actorId !== registration.result.basis.accountId ||
    principal.sessionId !== registration.result.basis.sessionId
  ) {
    clearWorkflowReferences(state);
    throw new InvalidIdentityAuthenticatedPrincipalError();
  }

  let access: ReturnType<typeof snapshotOfAccessCredential>;
  let family: IdentitySessionFamilySnapshot;

  try {
    access = snapshotOfAccessCredential(registration.result.issuedAccessCredential);
    family = snapshotOfSessionFamily(registration.result.sessionFamily);
  } catch {
    failWorkflow(state);
    invalidWorkflow();
  }

  const evidence = capturedFreeze({
    kind: 'rotated' as const,
    principal,
    accessCredentialIssuedAt: access.issuedAt,
    accessCredentialExpiresAt: access.expiresAt,
    refreshIdleExpiresAt: family.refreshIdleExpiresAt,
    refreshAbsoluteExpiresAt: family.refreshAbsoluteExpiresAt,
  }) as IdentityTransactionRefreshRotatedEvidence;

  return registerPendingEvidence(state, registration.decision, evidence);
}

/** Authenticates and starts the single refresh-reuse persistence action. */
export function beginIdentitySessionRefreshReusePersistence(
  controllerValue: IdentitySessionRefreshWorkflowController,
  scopeValue: IdentityTransactionScope,
  decisionValue: IdentitySessionRefreshReuseDetectedDecision,
  securityEventIdValue: unknown,
): IdentitySessionRefreshReusePersistenceAction {
  const state = stateForController(controllerValue);
  const registration = isObject(decisionValue)
    ? decisionRegistrations.get(decisionValue)
    : undefined;

  if (
    state.phase !== 'decided-reuse-detected' ||
    state.decision !== decisionValue ||
    registration?.state !== state ||
    registration.kind !== 'reuse-detected' ||
    state.attempt === undefined ||
    state.attemptDigestView === undefined
  ) {
    invalidWorkflow();
  }

  authenticateActiveScope(state, scopeValue);
  const securityEventId = parseIdentitySecurityEventId(securityEventIdValue);
  authenticateAdmittedAttempt(state);
  const action = capturedFreeze({}) as IdentitySessionRefreshReusePersistenceAction;
  terminalActionRegistrations.set(
    action,
    capturedFreeze({
      state,
      kind: 'reuse-detected' as const,
      decision: decisionValue,
      result: registration.domainResult,
      securityEventId,
    }),
  );
  state.terminalAction = action;
  state.phase = 'terminal-action-started';
  return action;
}

/** Returns one reuse result and event identifier, with no credential digest material. */
export function inspectIdentitySessionRefreshReusePersistence(
  controllerValue: IdentitySessionRefreshWorkflowController,
  actionValue: IdentitySessionRefreshReusePersistenceAction,
): IdentitySessionRefreshReusePersistencePlan {
  const { registration } = authenticateReuseAction(controllerValue, actionValue);
  return capturedFreeze({
    result: registration.result,
    securityEventId: registration.securityEventId,
  });
}

/** Mints pending reuse evidence only after its state and event writes succeed. */
export function completeIdentitySessionRefreshReusePersistence(
  controllerValue: IdentitySessionRefreshWorkflowController,
  actionValue: IdentitySessionRefreshReusePersistenceAction,
): IdentityTransactionRefreshReuseDetectedEvidence {
  const { state, registration } = authenticateReuseAction(controllerValue, actionValue);
  authenticateAdmittedAttempt(state);
  const evidence = capturedFreeze({
    kind: 'reuse-detected' as const,
  }) as IdentityTransactionRefreshReuseDetectedEvidence;
  return registerPendingEvidence(state, registration.decision, evidence);
}

/** Permanently fails an authentic persistence action whose writer did not complete. */
export function failIdentitySessionRefreshPersistence(
  controllerValue: IdentitySessionRefreshWorkflowController,
  actionValue:
    IdentitySessionRefreshRotatedPersistenceAction | IdentitySessionRefreshReusePersistenceAction,
): void {
  const state = stateForController(controllerValue);
  const registration = isObject(actionValue)
    ? terminalActionRegistrations.get(actionValue)
    : undefined;

  if (
    state.phase !== 'terminal-action-started' ||
    state.terminalAction !== actionValue ||
    registration?.state !== state
  ) {
    invalidWorkflow();
  }

  failWorkflow(state);
}

/**
 * Authenticates callback evidence exactly once before scope settlement.
 * Consumption is not commit, outcome, or credential-delivery authority.
 */
export function consumeIdentityTransactionPendingEvidence(
  controllerValue: IdentitySessionRefreshWorkflowController,
  evidenceValue: IdentityTransactionEvidence,
): IdentityTransactionEvidence {
  const state = stateForController(controllerValue);
  const registration = isObject(evidenceValue)
    ? readWeakMap(evidenceRegistrations, evidenceValue)
    : undefined;

  if (
    state.phase !== 'terminal' ||
    readWeakMap(scopeStates, state.scope) !== state ||
    state.evidence !== evidenceValue ||
    registration?.state !== state ||
    registration.scope !== state.scope ||
    registration.attempt !== state.attempt ||
    registration.kind !== evidenceValue.kind ||
    registration.status !== 'pending'
  ) {
    invalidWorkflow();
  }

  let completion: IdentitySessionRefreshCommittedCompletion;

  try {
    completion = createPreparedCommittedCompletion(evidenceValue);
    writeWeakMap(completionRegistrations, completion, {
      state,
      pendingEvidence: evidenceValue,
      attempt: registration.attempt,
      kind: registration.kind,
      status: 'prepared',
    });
  } catch {
    invalidWorkflow();
  }

  registration.committedCompletion = completion;
  registration.status = 'consumed';
  return evidenceValue;
}

function closedEvidenceSettlement(
  controllerValue: unknown,
  evidenceValue: unknown,
): EvidenceRegistration | undefined {
  if (!isObject(controllerValue) || !isObject(evidenceValue)) {
    return undefined;
  }

  const state = readWeakMap(controllerStates, controllerValue);
  const evidenceRegistration = readWeakMap(evidenceRegistrations, evidenceValue);
  const completion = evidenceRegistration?.committedCompletion;
  const completionRegistration =
    completion === undefined ? undefined : readWeakMap(completionRegistrations, completion);

  if (
    state?.controller !== controllerValue ||
    state.phase !== 'closed' ||
    evidenceRegistration?.state !== state ||
    evidenceRegistration.scope !== state.scope ||
    evidenceRegistration.attempt !== state.attempt ||
    evidenceRegistration.status !== 'consumed' ||
    completion === undefined ||
    completionRegistration?.state !== state ||
    completionRegistration.pendingEvidence !== evidenceValue ||
    completionRegistration.attempt !== evidenceRegistration.attempt ||
    completionRegistration.kind !== evidenceRegistration.kind ||
    completionRegistration.status !== 'prepared'
  ) {
    return undefined;
  }

  return evidenceRegistration;
}

/**
 * Promotes consumed evidence after an acknowledged commit and scope close.
 *
 * The completion was allocated before settlement, so this transition performs
 * no extensible call and never throws. Invalid, foreign, or replayed values do
 * not change a rightful registration.
 */
function promoteIdentityTransactionPendingEvidenceInternal(
  controllerValue: unknown,
  evidenceValue: unknown,
): IdentitySessionRefreshCommittedCompletion | undefined {
  const evidenceRegistration = closedEvidenceSettlement(controllerValue, evidenceValue);

  if (evidenceRegistration === undefined) {
    return undefined;
  }

  const state = evidenceRegistration.state;
  const completion = evidenceRegistration.committedCompletion;
  const completionRegistration =
    completion === undefined ? undefined : readWeakMap(completionRegistrations, completion);

  if (completion === undefined || completionRegistration === undefined) {
    return undefined;
  }

  const settled =
    evidenceRegistration.kind === 'rotated'
      ? settleCredentialAttemptAfterRefreshCommit(
          evidenceRegistration.attempt,
          state.controller,
          completion,
        )
      : settleCredentialAttemptAfterRefreshRevocation(
          evidenceRegistration.attempt,
          state.controller,
        );

  if (!settled) {
    return undefined;
  }

  completionRegistration.status = 'committed';
  completionRegistration.state = undefined;
  completionRegistration.pendingEvidence = undefined;
  if (evidenceRegistration.kind !== 'rotated') {
    completionRegistration.attempt = undefined;
  }
  deleteWeakMapValue(evidenceRegistrations, completion.evidence);
  deleteWeakMapValue(controllerStates, state.controller);
  state.evidence = undefined;
  state.attempt = undefined;
  state.attemptDigestView = undefined;
  return completion;
}

export function promoteIdentityTransactionPendingEvidence(
  controllerValue: IdentitySessionRefreshWorkflowController,
  evidenceValue: IdentityTransactionEvidence,
): IdentitySessionRefreshCommittedCompletion | undefined {
  try {
    return promoteIdentityTransactionPendingEvidenceInternal(controllerValue, evidenceValue);
  } catch {
    return undefined;
  }
}

/** Authenticates one exact, active committed completion by runtime identity. */
export function inspectIdentitySessionRefreshCommittedCompletion(
  completionValue: unknown,
): IdentitySessionRefreshCommittedCompletion {
  const registration = isObject(completionValue)
    ? readWeakMap(completionRegistrations, completionValue)
    : undefined;

  if (registration?.status !== 'committed') {
    invalidWorkflow();
  }

  return completionValue as IdentitySessionRefreshCommittedCompletion;
}

/**
 * Permanently revokes pending evidence and retires its admitted credential attempt.
 * This is safe for rollback, failure, and indeterminate outcomes; it cannot promote delivery.
 */
function revokeIdentityTransactionPendingEvidenceInternal(
  controllerValue: unknown,
  evidenceValue: unknown,
): boolean {
  const evidenceRegistration = closedEvidenceSettlement(controllerValue, evidenceValue);

  if (evidenceRegistration === undefined) {
    return false;
  }

  const state = evidenceRegistration.state;
  const completion = evidenceRegistration.committedCompletion;
  const completionRegistration =
    completion === undefined ? undefined : readWeakMap(completionRegistrations, completion);

  if (completion === undefined || completionRegistration === undefined) {
    return false;
  }

  if (
    !settleCredentialAttemptAfterRefreshRevocation(evidenceRegistration.attempt, state.controller)
  ) {
    return false;
  }

  completionRegistration.status = 'revoked';
  completionRegistration.state = undefined;
  completionRegistration.pendingEvidence = undefined;
  completionRegistration.attempt = undefined;
  deleteWeakMapValue(completionRegistrations, completion);
  deleteWeakMapValue(evidenceRegistrations, completion.evidence);
  deleteWeakMapValue(controllerStates, state.controller);
  state.evidence = undefined;
  state.attempt = undefined;
  state.attemptDigestView = undefined;
  return true;
}

export function revokeIdentityTransactionPendingEvidence(
  controllerValue: IdentitySessionRefreshWorkflowController,
  evidenceValue: IdentityTransactionEvidence,
): boolean {
  try {
    return revokeIdentityTransactionPendingEvidenceInternal(controllerValue, evidenceValue);
  } catch {
    return false;
  }
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
    state.attempt !== undefined ||
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
    state.attempt !== undefined ||
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

  const pendingEvidence = state.evidence;
  const evidenceRegistration =
    pendingEvidence === undefined ? undefined : evidenceRegistrations.get(pendingEvidence);
  let preservesConsumedEvidence =
    evidenceRegistration?.state === state && evidenceRegistration.status === 'consumed';
  let cleanupSucceeded = true;

  if (preservesConsumedEvidence) {
    try {
      authenticateAdmittedAttempt(state);
    } catch {
      preservesConsumedEvidence = false;
      cleanupSucceeded = false;
    }
  }

  scopeStates.delete(state.scope);
  cleanupSucceeded = revokePendingEvidence(state) && cleanupSucceeded;
  if (!preservesConsumedEvidence) {
    if (pendingEvidence !== undefined && evidenceRegistration?.state === state) {
      evidenceRegistrations.delete(pendingEvidence);
    }
    cleanupSucceeded = retireAdmittedAttempt(state) && cleanupSucceeded;
  }
  state.phase = 'closed';
  state.context = undefined;
  state.dbNow = undefined;
  clearWorkflowReferences(state);

  if (!cleanupSucceeded) {
    invalidWorkflow();
  }
}
