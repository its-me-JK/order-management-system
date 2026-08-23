export class InvalidIdentityRefreshCredentialStateError extends Error {
  public constructor() {
    super('Expected a valid Identity Refresh Credential snapshot');
    this.name = 'InvalidIdentityRefreshCredentialStateError';
  }
}
