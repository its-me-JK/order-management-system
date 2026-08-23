import {
  parseIdentityAccessCredentialId,
  parseIdentityAccessLifetimeSeconds,
  type IdentityAccessCredentialId,
  type IdentityAccessLifetimeSeconds,
} from '../domain/identity-access-credential.values';
import {
  parseIdentityRefreshCredentialId,
  type IdentityRefreshCredentialId,
} from '../domain/identity-refresh-credential.values';
import {
  parseIdentityRefreshIdleLifetimeSeconds,
  type IdentityRefreshIdleLifetimeSeconds,
} from '../domain/identity-session-family.values';
import type { IdentitySessionCredentialAttempt } from './identity-session-credential-attempt';
import type { IdentitySessionRefreshDiscoveryFoundTicket } from './identity-session-refresh-discovery';
import type { IdentitySessionRefreshLockedLoader } from './identity-session-refresh-locked-loader';
import {
  parseIdentitySecurityEventId,
  type IdentitySecurityEventId,
} from './identity-security-event.values';
import {
  activateIdentitySessionRefreshWorkflow,
  closeIdentitySessionRefreshWorkflow,
  completeIdentitySessionRefreshRejected,
  consumeIdentityTransactionPendingEvidence,
  createIdentitySessionRefreshAttemptBoundWorkflow,
  decideIdentitySessionRefresh,
  type IdentitySessionRefreshDecisionInput,
  type IdentitySessionRefreshReuseDetectedDecision,
  type IdentitySessionRefreshRotatedDecision,
  type IdentitySessionRefreshWorkflowBoundary,
  type IdentityTransactionContext,
  type IdentityTransactionEvidence,
  type IdentityTransactionRefreshReuseDetectedEvidence,
  type IdentityTransactionRefreshRotatedEvidence,
  type IdentityTransactionScope,
} from './identity-session-refresh-workflow';

const objectPrototype = Object.prototype;
const capturedFreeze = Object.freeze;
const capturedGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const capturedGetPrototypeOf = Object.getPrototypeOf;
const capturedHasOwn = Object.hasOwn;
const capturedIsArray = Array.isArray;
const capturedOwnKeys = Reflect.ownKeys;
const capturedReflectApply = Reflect.apply;
const capturedReflectGet = Reflect.get;
const COMMAND_INPUT_KEYS = capturedFreeze([
  'discoveryTicket',
  'credentialAttempt',
  'successorRefreshCredentialId',
  'refreshIdleLifetimeSeconds',
  'issuedAccessCredentialId',
  'accessLifetimeSeconds',
  'securityEventId',
] as const);

type CommandInputKey = (typeof COMMAND_INPUT_KEYS)[number];
type CommandStatus =
  | 'ready'
  | 'admitting'
  | 'admitted'
  | 'activating'
  | 'active'
  | 'running'
  | 'settled'
  | 'failed'
  | 'closing'
  | 'closed';

declare const identitySessionRefreshCommandBrand: unique symbol;

/** Opaque, one-shot admission for one package-owned refresh orchestration. */
export type IdentitySessionRefreshCommand = Readonly<{
  readonly [identitySessionRefreshCommandBrand]: true;
}>;

export type CreateIdentitySessionRefreshCommandInput = Readonly<{
  discoveryTicket: IdentitySessionRefreshDiscoveryFoundTicket;
  credentialAttempt: IdentitySessionCredentialAttempt;
  successorRefreshCredentialId: unknown;
  refreshIdleLifetimeSeconds: unknown;
  issuedAccessCredentialId: unknown;
  accessLifetimeSeconds: unknown;
  securityEventId: unknown;
}>;

export type IdentitySessionRefreshRotatedStoreInput = Readonly<{
  decision: IdentitySessionRefreshRotatedDecision;
  securityEventId: IdentitySecurityEventId;
}>;

export type IdentitySessionRefreshReuseDetectedStoreInput = Readonly<{
  decision: IdentitySessionRefreshReuseDetectedDecision;
  securityEventId: IdentitySecurityEventId;
}>;

/**
 * The complete transaction-scoped store surface used by the fixed refresh command.
 * Rejection deliberately has no persistence operation.
 */
export interface IdentitySessionRefreshStore extends IdentitySessionRefreshLockedLoader {
  persistRotated(
    scope: IdentityTransactionScope,
    input: IdentitySessionRefreshRotatedStoreInput,
  ): Promise<IdentityTransactionRefreshRotatedEvidence>;
  persistReuseDetected(
    scope: IdentityTransactionScope,
    input: IdentitySessionRefreshReuseDetectedStoreInput,
  ): Promise<IdentityTransactionRefreshReuseDetectedEvidence>;
}

export class InvalidIdentitySessionRefreshCommandError extends Error {
  public constructor() {
    super('Expected a valid Identity session refresh command transition');
    this.name = 'InvalidIdentitySessionRefreshCommandError';
  }
}

type ValidatedCommandInput = Readonly<{
  discoveryTicket: IdentitySessionRefreshDiscoveryFoundTicket;
  credentialAttempt: IdentitySessionCredentialAttempt;
  successorRefreshCredentialId: IdentityRefreshCredentialId;
  refreshIdleLifetimeSeconds: IdentityRefreshIdleLifetimeSeconds;
  issuedAccessCredentialId: IdentityAccessCredentialId;
  accessLifetimeSeconds: IdentityAccessLifetimeSeconds;
  securityEventId: IdentitySecurityEventId;
}>;

interface CommandState {
  readonly command: IdentitySessionRefreshCommand;
  status: CommandStatus;
  discoveryTicket: IdentitySessionRefreshDiscoveryFoundTicket | undefined;
  credentialAttempt: IdentitySessionCredentialAttempt | undefined;
  decisionInput: IdentitySessionRefreshDecisionInput | undefined;
  securityEventId: IdentitySecurityEventId | undefined;
  controller: IdentitySessionRefreshWorkflowBoundary['controller'] | undefined;
  scope: IdentityTransactionScope | undefined;
  context: IdentityTransactionContext | undefined;
}

type LoadForUpdate = IdentitySessionRefreshStore['loadForUpdate'];
type PersistRotated = IdentitySessionRefreshStore['persistRotated'];
type PersistReuseDetected = IdentitySessionRefreshStore['persistReuseDetected'];

type CapturedStore = Readonly<{
  receiver: object;
  loadForUpdate: LoadForUpdate;
  persistRotated: PersistRotated;
  persistReuseDetected: PersistReuseDetected;
}>;

const commandStates = new WeakMap<object, CommandState>();
const controllerStates = new WeakMap<object, CommandState>();

function invalidCommand(): never {
  throw new InvalidIdentitySessionRefreshCommandError();
}

function isObject(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

function readExactCommandInput(value: unknown): Readonly<Record<CommandInputKey, unknown>> {
  if (
    typeof value !== 'object' ||
    value === null ||
    capturedIsArray(value) ||
    capturedGetPrototypeOf(value) !== objectPrototype
  ) {
    invalidCommand();
  }

  const keys = capturedOwnKeys(value);

  if (
    keys.length !== COMMAND_INPUT_KEYS.length ||
    keys.some(
      (key) =>
        typeof key !== 'string' || !COMMAND_INPUT_KEYS.some((expectedKey) => expectedKey === key),
    )
  ) {
    invalidCommand();
  }

  const result = {} as Record<CommandInputKey, unknown>;

  for (const key of COMMAND_INPUT_KEYS) {
    const descriptor = capturedGetOwnPropertyDescriptor(value, key);

    if (
      descriptor === undefined ||
      !capturedHasOwn(descriptor, 'value') ||
      descriptor.enumerable !== true
    ) {
      invalidCommand();
    }

    result[key] = descriptor.value;
  }

  return result;
}

function validateCommandInput(value: unknown): ValidatedCommandInput {
  const input = readExactCommandInput(value);
  const discoveryTicket = input.discoveryTicket;
  const credentialAttempt = input.credentialAttempt;

  if (!isObject(discoveryTicket) || !isObject(credentialAttempt)) {
    invalidCommand();
  }

  return capturedFreeze({
    discoveryTicket: discoveryTicket as IdentitySessionRefreshDiscoveryFoundTicket,
    credentialAttempt: credentialAttempt as IdentitySessionCredentialAttempt,
    successorRefreshCredentialId: parseIdentityRefreshCredentialId(
      input.successorRefreshCredentialId,
    ),
    refreshIdleLifetimeSeconds: parseIdentityRefreshIdleLifetimeSeconds(
      input.refreshIdleLifetimeSeconds,
    ),
    issuedAccessCredentialId: parseIdentityAccessCredentialId(input.issuedAccessCredentialId),
    accessLifetimeSeconds: parseIdentityAccessLifetimeSeconds(input.accessLifetimeSeconds),
    securityEventId: parseIdentitySecurityEventId(input.securityEventId),
  });
}

function stateForCommand(value: unknown): CommandState {
  const state = isObject(value) ? commandStates.get(value) : undefined;

  if (state === undefined || state.command !== value) {
    invalidCommand();
  }

  return state;
}

function stateForController(value: unknown): CommandState {
  const state = isObject(value) ? controllerStates.get(value) : undefined;

  if (state === undefined || state.controller !== value) {
    invalidCommand();
  }

  return state;
}

function clearPreExecutionMaterial(state: CommandState): void {
  state.discoveryTicket = undefined;
  state.credentialAttempt = undefined;
  state.decisionInput = undefined;
  state.securityEventId = undefined;
}

function clearCommandBoundary(state: CommandState): void {
  clearPreExecutionMaterial(state);
  state.controller = undefined;
  state.scope = undefined;
  state.context = undefined;
}

function authenticateStatus(state: CommandState, expectedStatus: CommandStatus): void {
  if (state.status !== expectedStatus) {
    invalidCommand();
  }
}

function captureStore(value: unknown): CapturedStore {
  if (typeof value !== 'object' || value === null || capturedIsArray(value)) {
    invalidCommand();
  }

  const loadForUpdate: unknown = capturedReflectGet(value, 'loadForUpdate');
  const persistRotated: unknown = capturedReflectGet(value, 'persistRotated');
  const persistReuseDetected: unknown = capturedReflectGet(value, 'persistReuseDetected');

  if (
    typeof loadForUpdate !== 'function' ||
    typeof persistRotated !== 'function' ||
    typeof persistReuseDetected !== 'function'
  ) {
    invalidCommand();
  }

  return capturedFreeze({
    receiver: value,
    loadForUpdate: loadForUpdate as LoadForUpdate,
    persistRotated: persistRotated as PersistRotated,
    persistReuseDetected: persistReuseDetected as PersistReuseDetected,
  });
}

function invokeStore<Arguments extends readonly unknown[], Result>(
  operation: (...arguments_: Arguments) => Result,
  receiver: object,
  arguments_: Arguments,
): Result {
  return capturedReflectApply(operation, receiver, arguments_);
}

/**
 * Copies one exact server-owned command into an opaque runtime registration.
 * Ticket and attempt authenticity are intentionally checked later by their one-shot owners.
 */
export function createIdentitySessionRefreshCommand(
  inputValue: unknown,
): IdentitySessionRefreshCommand {
  try {
    const input = validateCommandInput(inputValue);
    const command = capturedFreeze({}) as IdentitySessionRefreshCommand;
    const state: CommandState = {
      command,
      status: 'ready',
      discoveryTicket: input.discoveryTicket,
      credentialAttempt: input.credentialAttempt,
      decisionInput: capturedFreeze({
        successorRefreshCredentialId: input.successorRefreshCredentialId,
        refreshIdleLifetimeSeconds: input.refreshIdleLifetimeSeconds,
        issuedAccessCredentialId: input.issuedAccessCredentialId,
        accessLifetimeSeconds: input.accessLifetimeSeconds,
      }),
      securityEventId: input.securityEventId,
      controller: undefined,
      scope: undefined,
      context: undefined,
    };

    commandStates.set(command, state);
    return command;
  } catch {
    invalidCommand();
  }
}

/**
 * Synchronously consumes one command and claims its verified credential attempt.
 * The concrete Unit of Work calls this before its first asynchronous operation.
 */
export function admitIdentitySessionRefreshCommand(
  commandValue: IdentitySessionRefreshCommand,
): IdentitySessionRefreshWorkflowBoundary {
  const state = stateForCommand(commandValue);

  if (state.status !== 'ready' || state.credentialAttempt === undefined) {
    invalidCommand();
  }

  state.status = 'admitting';

  try {
    const boundary = createIdentitySessionRefreshAttemptBoundWorkflow(state.credentialAttempt);

    authenticateStatus(state, 'admitting');

    state.controller = boundary.controller;
    state.scope = boundary.scope;
    state.credentialAttempt = undefined;
    state.status = 'admitted';
    controllerStates.set(boundary.controller, state);
    return boundary;
  } catch {
    state.status = 'failed';
    clearPreExecutionMaterial(state);
    invalidCommand();
  }
}

/** Activates only the workflow admitted by this command and binds its exact context identity. */
export function activateIdentitySessionRefreshCommand(
  controllerValue: IdentitySessionRefreshWorkflowBoundary['controller'],
  dbNowValue: unknown,
): IdentityTransactionContext {
  const state = stateForController(controllerValue);

  if (state.status !== 'admitted') {
    invalidCommand();
  }

  state.status = 'activating';

  try {
    const context = activateIdentitySessionRefreshWorkflow(controllerValue, dbNowValue);

    authenticateStatus(state, 'activating');

    if (context.scope !== state.scope) {
      invalidCommand();
    }

    state.context = context;
    state.status = 'active';
    return context;
  } catch {
    state.status = 'failed';
    clearPreExecutionMaterial(state);
    invalidCommand();
  }
}

/**
 * Runs the sole package-owned refresh orchestration and authenticates its pending evidence.
 * The returned value is still pending; it grants neither commit proof nor credential delivery.
 */
export async function runIdentitySessionRefreshCommand(
  controllerValue: IdentitySessionRefreshWorkflowBoundary['controller'],
  contextValue: IdentityTransactionContext,
  storeValue: IdentitySessionRefreshStore,
): Promise<IdentityTransactionEvidence> {
  const state = stateForController(controllerValue);

  if (
    state.status !== 'active' ||
    state.context !== contextValue ||
    state.scope === undefined ||
    state.discoveryTicket === undefined ||
    state.decisionInput === undefined ||
    state.securityEventId === undefined
  ) {
    invalidCommand();
  }

  const scope = state.scope;
  const discoveryTicket = state.discoveryTicket;
  const decisionInput = state.decisionInput;
  const securityEventId = state.securityEventId;
  state.status = 'running';
  let store: CapturedStore;

  try {
    store = captureStore(storeValue);
  } catch {
    state.status = 'failed';
    clearPreExecutionMaterial(state);
    invalidCommand();
  }

  clearPreExecutionMaterial(state);

  try {
    const load = await invokeStore(store.loadForUpdate, store.receiver, [scope, discoveryTicket]);
    const decision = decideIdentitySessionRefresh(contextValue, load, decisionInput);
    let evidence: IdentityTransactionEvidence;

    switch (decision.kind) {
      case 'rejected':
        evidence = completeIdentitySessionRefreshRejected(controllerValue, scope, decision);
        break;
      case 'rotated':
        evidence = await invokeStore(store.persistRotated, store.receiver, [
          scope,
          capturedFreeze({ decision, securityEventId }),
        ]);
        break;
      case 'reuse-detected':
        evidence = await invokeStore(store.persistReuseDetected, store.receiver, [
          scope,
          capturedFreeze({ decision, securityEventId }),
        ]);
        break;
    }

    const consumedEvidence = consumeIdentityTransactionPendingEvidence(controllerValue, evidence);
    state.status = 'settled';
    state.context = undefined;
    return consumedEvidence;
  } catch (error) {
    state.status = 'failed';
    state.context = undefined;
    throw error;
  }
}

/** Invalidates the admitted workflow and releases all command-owned registrations. */
export function closeIdentitySessionRefreshCommand(
  controllerValue: IdentitySessionRefreshWorkflowBoundary['controller'],
): void {
  const state = stateForController(controllerValue);

  if (
    state.status === 'admitting' ||
    state.status === 'activating' ||
    state.status === 'running' ||
    state.status === 'closing' ||
    state.status === 'closed'
  ) {
    invalidCommand();
  }

  state.status = 'closing';
  let closed = true;

  try {
    closeIdentitySessionRefreshWorkflow(controllerValue);
  } catch {
    closed = false;
  }

  controllerStates.delete(controllerValue);
  state.status = 'closed';
  clearCommandBoundary(state);

  if (!closed) {
    invalidCommand();
  }
}
