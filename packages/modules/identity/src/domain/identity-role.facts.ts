import type { IdentityPermissionCode } from './identity-permission.values';
import type { IdentityRoleId, IdentityRoleStatus } from './identity-role.values';
import type { IdentityAggregateVersion, IdentityInstant } from './identity-values';

type IdentityRoleFact<
  FactType extends string,
  ResultingStatus extends IdentityRoleStatus,
> = Readonly<{
  type: FactType;
  roleId: IdentityRoleId;
  status: ResultingStatus;
  version: IdentityAggregateVersion;
  occurredAt: IdentityInstant;
}>;

export type IdentityRoleCreatedFact = IdentityRoleFact<'ROLE_CREATED', 'ACTIVE'>;

export type IdentityRoleRenamedFact = IdentityRoleFact<'ROLE_RENAMED', 'ACTIVE'>;

export type IdentityRolePermissionGrantedFact = IdentityRoleFact<
  'ROLE_PERMISSION_GRANTED',
  'ACTIVE'
> &
  Readonly<{
    permissionCode: IdentityPermissionCode;
  }>;

export type IdentityRolePermissionRevokedFact = IdentityRoleFact<
  'ROLE_PERMISSION_REVOKED',
  'ACTIVE'
> &
  Readonly<{
    permissionCode: IdentityPermissionCode;
  }>;

export type IdentityRoleRetiredFact = IdentityRoleFact<'ROLE_RETIRED', 'RETIRED'> &
  Readonly<{
    previousStatus: 'ACTIVE';
  }>;

/** In-process facts only; the application layer decides durable security evidence. */
export type IdentityRoleDomainFact =
  | IdentityRoleCreatedFact
  | IdentityRoleRenamedFact
  | IdentityRolePermissionGrantedFact
  | IdentityRolePermissionRevokedFact
  | IdentityRoleRetiredFact;

export type IdentityRoleFactTuple = readonly [IdentityRoleDomainFact, ...IdentityRoleDomainFact[]];

export type IdentityRoleCreationFacts = readonly [
  IdentityRoleCreatedFact,
  ...IdentityRolePermissionGrantedFact[],
];

export type IdentityRoleRenamedFacts = readonly [IdentityRoleRenamedFact];
export type IdentityRolePermissionGrantedFacts = readonly [IdentityRolePermissionGrantedFact];
export type IdentityRolePermissionRevokedFacts = readonly [IdentityRolePermissionRevokedFact];
export type IdentityRoleRetiredFacts = readonly [IdentityRoleRetiredFact];
