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

export class InvalidIdentitySessionFamilyRefreshStateError extends Error {
  public constructor() {
    super('Expected a valid Identity Session Family refresh state');
    this.name = 'InvalidIdentitySessionFamilyRefreshStateError';
  }
}

export class IdentitySessionFamilyRefreshTimestampRegressionError extends Error {
  public constructor() {
    super('The Identity Session Family refresh time precedes locked state');
    this.name = 'IdentitySessionFamilyRefreshTimestampRegressionError';
  }
}

export class IdentitySessionFamilyRefreshSuccessorConflictError extends Error {
  public constructor() {
    super('The Identity Session Family refresh successor conflicts with its predecessor');
    this.name = 'IdentitySessionFamilyRefreshSuccessorConflictError';
  }
}

export class IdentitySessionFamilyRefreshCapacityExhaustedError extends Error {
  public constructor() {
    super('The Identity Session Family refresh rotation capacity is exhausted');
    this.name = 'IdentitySessionFamilyRefreshCapacityExhaustedError';
  }
}
