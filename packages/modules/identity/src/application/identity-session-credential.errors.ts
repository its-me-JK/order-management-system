export class InvalidIdentityAccessCredentialWireValueError extends Error {
  public constructor() {
    super('Expected a canonical Identity access credential wire value');
    this.name = 'InvalidIdentityAccessCredentialWireValueError';
  }
}

export class InvalidIdentityRefreshCredentialWireValueError extends Error {
  public constructor() {
    super('Expected a canonical Identity refresh credential wire value');
    this.name = 'InvalidIdentityRefreshCredentialWireValueError';
  }
}

export class InvalidIdentityAccessCredentialDigestError extends Error {
  public constructor() {
    super('Expected a valid Identity access credential digest');
    this.name = 'InvalidIdentityAccessCredentialDigestError';
  }
}

export class InvalidIdentityRefreshCredentialDigestError extends Error {
  public constructor() {
    super('Expected a valid Identity refresh credential digest');
    this.name = 'InvalidIdentityRefreshCredentialDigestError';
  }
}

export class InvalidIdentitySessionCredentialCandidatesError extends Error {
  public constructor() {
    super('Expected valid Identity session credential candidates');
    this.name = 'InvalidIdentitySessionCredentialCandidatesError';
  }
}

export class IdentitySessionCredentialCryptoUnavailableError extends Error {
  public constructor() {
    super('Identity session credential cryptography is temporarily unavailable');
    this.name = 'IdentitySessionCredentialCryptoUnavailableError';
  }
}
