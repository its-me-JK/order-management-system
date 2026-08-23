export class IdentityBearerResolutionUnavailableError extends Error {
  public constructor() {
    super('Identity Bearer resolution is temporarily unavailable');
    this.name = 'IdentityBearerResolutionUnavailableError';
  }
}

/** Internal, cause-free failure used when a trusted resolver contract is violated. */
export class IdentityBearerResolutionError extends Error {
  public constructor() {
    super('Identity Bearer resolution failed');
    this.name = 'IdentityBearerResolutionError';
  }
}
