import type {
  IdentityAccessCredentialDigest,
  IdentityRefreshCredentialDigest,
} from './identity-session-credential-digest.values';
import type { IdentitySessionCredentialCandidates } from './identity-session-credential-candidates';
import type {
  IdentityAccessCredentialWireValue,
  IdentityRefreshCredentialWireValue,
} from './identity-session-credential-wire.values';

/** Framework-free cryptographic capability for opaque session credentials. */
export interface IdentitySessionCredentialCrypto {
  generateSessionCredentialCandidates(): Promise<IdentitySessionCredentialCandidates>;
  digestAccessCredential(
    wireValue: IdentityAccessCredentialWireValue,
  ): Promise<IdentityAccessCredentialDigest>;
  digestRefreshCredential(
    wireValue: IdentityRefreshCredentialWireValue,
  ): Promise<IdentityRefreshCredentialDigest>;
}
