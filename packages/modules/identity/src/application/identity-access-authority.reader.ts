import type { IdentityAuthenticatedPrincipal } from './identity-authenticated-principal';
import type { IdentityAccessCredentialDigest } from './identity-session-credential-digest.values';

export type IdentityAccessAuthorityResolved = Readonly<{
  kind: 'resolved';
  principal: IdentityAuthenticatedPrincipal;
}>;

export type IdentityAccessAuthorityRejected = Readonly<{
  kind: 'rejected';
}>;

export type IdentityAccessAuthorityResult =
  IdentityAccessAuthorityRejected | IdentityAccessAuthorityResolved;

export const IDENTITY_ACCESS_AUTHORITY_REJECTED: IdentityAccessAuthorityRejected = Object.freeze({
  kind: 'rejected',
});

/**
 * Digest-level persistence port for current access authority.
 *
 * Unknown credentials and ordinary lifecycle ineligibility are deliberately
 * indistinguishable. Credential parsing and hashing belong to the application
 * resolver use case, not this persistence boundary. Implementations return
 * exact frozen data records and may resolve only a principal created by
 * Identity's trusted authority factory.
 */
export interface IdentityAccessAuthorityReader {
  resolveByAccessCredentialDigest(
    accessCredentialDigest: IdentityAccessCredentialDigest,
  ): Promise<IdentityAccessAuthorityResult>;
}
