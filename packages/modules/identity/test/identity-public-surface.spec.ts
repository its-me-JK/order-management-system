import {
  IdentityBearerResolutionUnavailableError,
  ResolveIdentityBearerPrincipal,
  type IdentityAuthenticatedPrincipal,
  type IdentityBearerPrincipalRejected,
  type IdentityBearerPrincipalResolution,
  type IdentityBearerPrincipalResolved,
} from '../src';
import type {
  // @ts-expect-error Internal resolver failures are not part of the package root.
  IdentityBearerResolutionError as LeakedIdentityBearerResolutionError,
  // @ts-expect-error Refresh transaction ports remain package-internal.
  IdentitySessionRefreshUnitOfWork as LeakedIdentitySessionRefreshUnitOfWork,
  // @ts-expect-error Committed refresh capabilities remain package-internal.
  IdentitySessionRefreshCommittedCompletion as LeakedIdentitySessionRefreshCommittedCompletion,
  // @ts-expect-error Refresh identifier issuance remains package-internal.
  IdentitySessionRefreshIdentifierIssuer as LeakedIdentitySessionRefreshIdentifierIssuer,
} from '../src';
import * as identityPublicSurface from '../src';
import { createIdentityAuthenticatedPrincipalFromAuthority } from '../src/application/identity-authenticated-principal';

const ACTOR_ID = '01890f3a-8bcd-7def-8abc-0123456789ab';
const SESSION_ID = '01890f3a-8bcd-7def-9abc-0123456789ab';

describe('@oms/identity public surface', (): void => {
  it('exports only the Bearer resolver entry point and its public unavailable error', (): void => {
    expect(Object.keys(identityPublicSurface)).toEqual([
      'IdentityBearerResolutionUnavailableError',
      'ResolveIdentityBearerPrincipal',
    ]);
    expect(identityPublicSurface.IdentityBearerResolutionUnavailableError).toBe(
      IdentityBearerResolutionUnavailableError,
    );
    expect(identityPublicSurface.ResolveIdentityBearerPrincipal).toBe(
      ResolveIdentityBearerPrincipal,
    );

    for (const internalName of [
      'IdentityBearerResolutionError',
      'IDENTITY_BEARER_PRINCIPAL_REJECTED',
      'IDENTITY_ACCESS_AUTHORITY_REJECTED',
      'IdentityAccessAuthorityReader',
      'createIdentityAuthenticatedPrincipalFromAuthority',
      'parseIdentityAccessCredentialWireValue',
      'createIdentityAccessCredentialDigestFromBytes',
      'createNodeIdentitySessionCredentialCrypto',
      'createNodeIdentitySessionRefreshIdentifierIssuer',
      'IdentitySessionRefreshIdentifierIssuanceUnavailableError',
    ]) {
      expect(identityPublicSurface).not.toHaveProperty(internalName);
    }
  });

  it('publishes closed resolver outcome types around only an authentic nominal principal', (): void => {
    const principal: IdentityAuthenticatedPrincipal =
      createIdentityAuthenticatedPrincipalFromAuthority({
        actorId: ACTOR_ID,
        sessionId: SESSION_ID,
        activeRoleCount: 1,
        permissions: ['catalog.products.read'],
      });
    const resolved: IdentityBearerPrincipalResolved = {
      kind: 'resolved',
      principal,
    };
    const rejected: IdentityBearerPrincipalRejected = { kind: 'rejected' };
    const outcomes: readonly IdentityBearerPrincipalResolution[] = [resolved, rejected];

    expect(principal).toEqual({
      actorId: ACTOR_ID,
      sessionId: SESSION_ID,
      permissions: ['catalog.products.read'],
    });
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(['resolved', 'rejected']);
  });
});

// @ts-expect-error A structural object cannot self-assert authenticated authority.
const _structurallyForgedPrincipal: IdentityAuthenticatedPrincipal = {
  actorId: ACTOR_ID,
  sessionId: SESSION_ID,
  permissions: [],
};
void _structurallyForgedPrincipal;

export type _LeakedIdentityBearerResolutionError = LeakedIdentityBearerResolutionError;
export type _LeakedIdentitySessionRefreshUnitOfWork = LeakedIdentitySessionRefreshUnitOfWork;
export type _LeakedIdentitySessionRefreshCommittedCompletion =
  LeakedIdentitySessionRefreshCommittedCompletion;
export type _LeakedIdentitySessionRefreshIdentifierIssuer =
  LeakedIdentitySessionRefreshIdentifierIssuer;
