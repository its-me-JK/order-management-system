import type { IdentityAccountId, IdentityAccountStatus } from './identity-account.values';
import type { IdentityAggregateVersion, IdentityInstant } from './identity-values';

type IdentityAccountFact<
  FactType extends string,
  ResultingStatus extends IdentityAccountStatus,
> = Readonly<{
  type: FactType;
  accountId: IdentityAccountId;
  status: ResultingStatus;
  version: IdentityAggregateVersion;
  occurredAt: IdentityInstant;
}>;

export type IdentityAccountCreatedFact = IdentityAccountFact<'ACCOUNT_CREATED', 'ACTIVE'>;

export type IdentityAccountSuspendedFact = IdentityAccountFact<'ACCOUNT_SUSPENDED', 'SUSPENDED'> &
  Readonly<{
    previousStatus: 'ACTIVE';
  }>;

export type IdentityAccountResumedFact = IdentityAccountFact<'ACCOUNT_RESUMED', 'ACTIVE'> &
  Readonly<{
    previousStatus: 'SUSPENDED';
  }>;

export type IdentityAccountDeactivatedFact = IdentityAccountFact<
  'ACCOUNT_DEACTIVATED',
  'DEACTIVATED'
> &
  Readonly<{
    previousStatus: Exclude<IdentityAccountStatus, 'DEACTIVATED'>;
  }>;

/** In-process facts only; the application layer decides durable security evidence. */
export type IdentityAccountDomainFact =
  | IdentityAccountCreatedFact
  | IdentityAccountSuspendedFact
  | IdentityAccountResumedFact
  | IdentityAccountDeactivatedFact;
