import type { IdentityAccountId } from './identity-account.values';
import type { IdentityPasswordAuthenticatorStatus } from './identity-password-authenticator.values';
import type { IdentityAggregateVersion, IdentityInstant } from './identity-values';

type IdentityPasswordAuthenticatorFact<
  FactType extends string,
  ResultingStatus extends IdentityPasswordAuthenticatorStatus,
> = Readonly<{
  type: FactType;
  accountId: IdentityAccountId;
  status: ResultingStatus;
  version: IdentityAggregateVersion;
  occurredAt: IdentityInstant;
}>;

export type IdentityPasswordAuthenticatorCreatedFact = IdentityPasswordAuthenticatorFact<
  'PASSWORD_AUTHENTICATOR_CREATED',
  'ACTIVE'
>;

export type IdentityPasswordVerificationRejectedFact = IdentityPasswordAuthenticatorFact<
  'PASSWORD_VERIFICATION_REJECTED',
  IdentityPasswordAuthenticatorStatus
>;

export type IdentityPasswordAuthenticatorDisabledFact = IdentityPasswordAuthenticatorFact<
  'PASSWORD_AUTHENTICATOR_DISABLED',
  'REBIND_REQUIRED'
>;

export type IdentityPasswordAuthenticatorFailuresResetFact = IdentityPasswordAuthenticatorFact<
  'PASSWORD_AUTHENTICATOR_FAILURES_RESET',
  'ACTIVE'
>;

export type IdentityPasswordAuthenticatorVerifierUpgradedFact = IdentityPasswordAuthenticatorFact<
  'PASSWORD_AUTHENTICATOR_VERIFIER_UPGRADED',
  'ACTIVE'
>;

export type IdentityPasswordAuthenticatorReboundFact = IdentityPasswordAuthenticatorFact<
  'PASSWORD_AUTHENTICATOR_REBOUND',
  'ACTIVE'
>;

export type IdentityPasswordAuthenticatorCreationFacts = readonly [
  IdentityPasswordAuthenticatorCreatedFact,
];

export type IdentityPasswordAuthenticatorFailedVerificationFacts =
  | readonly [IdentityPasswordVerificationRejectedFact & Readonly<{ status: 'ACTIVE' }>]
  | readonly [
      IdentityPasswordVerificationRejectedFact & Readonly<{ status: 'REBIND_REQUIRED' }>,
      IdentityPasswordAuthenticatorDisabledFact,
    ];

export type IdentityPasswordAuthenticatorSuccessfulVerificationFacts =
  | readonly [IdentityPasswordAuthenticatorFailuresResetFact]
  | readonly [IdentityPasswordAuthenticatorVerifierUpgradedFact]
  | readonly [
      IdentityPasswordAuthenticatorFailuresResetFact,
      IdentityPasswordAuthenticatorVerifierUpgradedFact,
    ];

export type IdentityPasswordAuthenticatorRebindFacts = readonly [
  IdentityPasswordAuthenticatorReboundFact,
];

/** In-process facts only; the application layer decides durable security evidence. */
export type IdentityPasswordAuthenticatorDomainFact =
  | IdentityPasswordAuthenticatorCreatedFact
  | IdentityPasswordVerificationRejectedFact
  | IdentityPasswordAuthenticatorDisabledFact
  | IdentityPasswordAuthenticatorFailuresResetFact
  | IdentityPasswordAuthenticatorVerifierUpgradedFact
  | IdentityPasswordAuthenticatorReboundFact;
