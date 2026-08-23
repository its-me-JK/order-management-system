export class InvalidIdentitySessionFamilyStateError extends Error {
  public constructor() {
    super('Expected a valid Identity Session Family snapshot');
    this.name = 'InvalidIdentitySessionFamilyStateError';
  }
}

export class IdentitySessionFamilyDeadlineOverflowError extends Error {
  public constructor() {
    super('The Identity Session Family deadline exceeds the supported time range');
    this.name = 'IdentitySessionFamilyDeadlineOverflowError';
  }
}

export class IdentitySessionFamilyTimestampRegressionError extends Error {
  public constructor() {
    super('The Identity Session Family time precedes its current state');
    this.name = 'IdentitySessionFamilyTimestampRegressionError';
  }
}
