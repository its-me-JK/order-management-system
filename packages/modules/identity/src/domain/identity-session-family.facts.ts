import type { IdentityAccountId } from './identity-account.values';
import type {
  IdentitySessionFamilyAuthenticationState,
  IdentitySessionFamilyClosedReason,
  IdentitySessionFamilyGenericRevocationReason,
  IdentitySessionId,
} from './identity-session-family.values';
import type { IdentityAggregateVersion, IdentityInstant } from './identity-values';

type IdentitySessionFamilyFact<
  FactType extends string,
  ResultingState extends IdentitySessionFamilyAuthenticationState,
> = Readonly<{
  type: FactType;
  sessionId: IdentitySessionId;
  accountId: IdentityAccountId;
  state: ResultingState;
  version: IdentityAggregateVersion;
  occurredAt: IdentityInstant;
}>;

export type IdentitySessionFamilyCreatedFact = IdentitySessionFamilyFact<
  'SESSION_FAMILY_CREATED',
  'AUTHENTICATING'
>;

export type IdentitySessionFamilyRefreshRotatedFact = IdentitySessionFamilyFact<
  'SESSION_FAMILY_REFRESH_ROTATED',
  'AUTHENTICATING'
>;

export type IdentitySessionFamilyRevokedFact<
  ClosedReason extends IdentitySessionFamilyClosedReason = IdentitySessionFamilyClosedReason,
> = IdentitySessionFamilyFact<'SESSION_FAMILY_REVOKED', 'REVOKED'> &
  Readonly<{
    closedReason: ClosedReason;
  }>;

export type IdentitySessionFamilyDomainFact =
  | IdentitySessionFamilyCreatedFact
  | IdentitySessionFamilyRefreshRotatedFact
  | IdentitySessionFamilyRevokedFact;

export type IdentitySessionFamilyFactTuple = readonly [
  IdentitySessionFamilyDomainFact,
  ...IdentitySessionFamilyDomainFact[],
];

export type IdentitySessionFamilyCreationFacts = readonly [IdentitySessionFamilyCreatedFact];
export type IdentitySessionFamilyRefreshRotationFacts = readonly [
  IdentitySessionFamilyRefreshRotatedFact,
];
export type IdentitySessionFamilyRefreshReuseFacts = readonly [
  IdentitySessionFamilyRevokedFact<'REFRESH_REUSE_DETECTED'>,
];
export type IdentitySessionFamilyGenericRevocationFacts = readonly [
  IdentitySessionFamilyRevokedFact<IdentitySessionFamilyGenericRevocationReason>,
];
