import type { IdentityAccessCredentialId } from '../domain/identity-access-credential.values';
import type { IdentityRefreshCredentialId } from '../domain/identity-refresh-credential.values';
import type { IdentitySecurityEventId } from './identity-security-event.values';

/** The three separately branded identifiers required before refresh transaction admission. */
export type IdentitySessionRefreshIdentifiers = Readonly<{
  successorRefreshCredentialId: IdentityRefreshCredentialId;
  issuedAccessCredentialId: IdentityAccessCredentialId;
  securityEventId: IdentitySecurityEventId;
}>;

/** Synchronous identifier issuance; it performs no database or network work. */
export interface IdentitySessionRefreshIdentifierIssuer {
  issueSessionRefreshIdentifiers(): IdentitySessionRefreshIdentifiers;
}

export class IdentitySessionRefreshIdentifierIssuanceUnavailableError extends Error {
  public constructor() {
    super('Identity session refresh identifier issuance is temporarily unavailable');
    this.name = 'IdentitySessionRefreshIdentifierIssuanceUnavailableError';
  }
}
