import type { IdentityAuthenticatedPrincipal } from './identity-authenticated-principal';
import type { IdentitySessionCredentialCandidates } from './identity-session-credential-candidates';
import type {
  IdentityAccessCredentialWireValue,
  IdentityRefreshCredentialWireValue,
} from './identity-session-credential-wire.values';
import {
  consumeIdentitySessionRefreshCommittedCredentialPair,
  type IdentitySessionRefreshCommittedCompletion,
  type IdentityTransactionRefreshRotatedEvidence,
} from './identity-session-refresh-workflow';
import type { IdentityInstant } from '../domain/identity-values';

const capturedFreeze = Object.freeze;
const capturedReflectApply = Reflect.apply;
// eslint-disable-next-line @typescript-eslint/unbound-method
const capturedWeakMapSet = WeakMap.prototype.set;
const consumeCommittedCredentialPair = consumeIdentitySessionRefreshCommittedCredentialPair;
const DELIVERY_CONSTRUCTION_CAPABILITY = capturedFreeze({});
const DELIVERY_REDACTION = '[IdentitySessionRefreshCredentialDelivery]';

declare const identitySessionRefreshCredentialDeliveryBrand: unique symbol;

export type IdentitySessionRefreshCredentialDelivery =
  IdentitySessionRefreshCredentialDeliveryValue &
    Readonly<{
      [identitySessionRefreshCredentialDeliveryBrand]: true;
    }>;

type DeliveryState = Readonly<{
  accessCredential: IdentityAccessCredentialWireValue;
  refreshCredential: IdentityRefreshCredentialWireValue;
  principal: IdentityAuthenticatedPrincipal;
  accessCredentialIssuedAt: IdentityInstant;
  accessCredentialExpiresAt: IdentityInstant;
  refreshIdleExpiresAt: IdentityInstant;
  refreshAbsoluteExpiresAt: IdentityInstant;
}>;

const deliveryStates = new WeakMap<object, DeliveryState>();

export class InvalidIdentitySessionRefreshCredentialDeliveryError extends Error {
  public constructor() {
    super('Expected an authorized Identity session refresh credential delivery');
    this.name = 'InvalidIdentitySessionRefreshCredentialDeliveryError';
  }
}

function invalidDelivery(): never {
  throw new InvalidIdentitySessionRefreshCredentialDeliveryError();
}

class IdentitySessionRefreshCredentialDeliveryValue {
  public constructor(capability: unknown, state: DeliveryState) {
    if (
      new.target !== IdentitySessionRefreshCredentialDeliveryValue ||
      capability !== DELIVERY_CONSTRUCTION_CAPABILITY
    ) {
      invalidDelivery();
    }

    capturedReflectApply(capturedWeakMapSet, deliveryStates, [this, state]);
    capturedFreeze(this);
  }

  public toString(): string {
    return DELIVERY_REDACTION;
  }

  public toJSON(): string {
    return DELIVERY_REDACTION;
  }

  public [Symbol.toPrimitive](): string {
    return DELIVERY_REDACTION;
  }
}

capturedFreeze(IdentitySessionRefreshCredentialDeliveryValue.prototype);
capturedFreeze(IdentitySessionRefreshCredentialDeliveryValue);

function createDeliveryState(
  candidates: IdentitySessionCredentialCandidates,
  evidence: IdentityTransactionRefreshRotatedEvidence,
): DeliveryState {
  return capturedFreeze({
    accessCredential: candidates.access.wireValue,
    refreshCredential: candidates.refresh.wireValue,
    principal: evidence.principal,
    accessCredentialIssuedAt: evidence.accessCredentialIssuedAt,
    accessCredentialExpiresAt: evidence.accessCredentialExpiresAt,
    refreshIdleExpiresAt: evidence.refreshIdleExpiresAt,
    refreshAbsoluteExpiresAt: evidence.refreshAbsoluteExpiresAt,
  });
}

/**
 * Exchanges an authentic committed rotation and its exact original candidate
 * pair for one opaque, runtime-authentic delivery capability.
 *
 * The capability deliberately exposes no credential serializer yet. A later
 * HTTP composition slice will add purpose-specific access-response and
 * refresh-cookie sinks without exporting this factory or its source values.
 *
 * @internal Identity refresh application composition is the only production caller.
 */
export function createIdentitySessionRefreshCredentialDelivery(
  completionValue: unknown,
  candidatesValue: unknown,
): IdentitySessionRefreshCredentialDelivery {
  try {
    const candidates = consumeCommittedCredentialPair(completionValue, candidatesValue);
    const completion = completionValue as IdentitySessionRefreshCommittedCompletion;
    const evidence = completion.evidence as IdentityTransactionRefreshRotatedEvidence;
    const state = createDeliveryState(candidates, evidence);
    return new IdentitySessionRefreshCredentialDeliveryValue(
      DELIVERY_CONSTRUCTION_CAPABILITY,
      state,
    ) as IdentitySessionRefreshCredentialDelivery;
  } catch {
    throw new InvalidIdentitySessionRefreshCredentialDeliveryError();
  }
}
