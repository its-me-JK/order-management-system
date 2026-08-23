export class InvalidIdentityRoleStateError extends Error {
  public constructor() {
    super('Expected a valid Identity Role snapshot');
    this.name = 'InvalidIdentityRoleStateError';
  }
}

export class InvalidIdentityRolePermissionSetError extends Error {
  public constructor() {
    super('Expected a valid Identity Role permission set');
    this.name = 'InvalidIdentityRolePermissionSetError';
  }
}

export class IdentityRolePermissionCapacityExceededError extends Error {
  public constructor() {
    super('The Identity Role permission capacity is exceeded');
    this.name = 'IdentityRolePermissionCapacityExceededError';
  }
}

export class IdentityRoleVersionMismatchError extends Error {
  public constructor() {
    super('The Identity Role version does not match the expected version');
    this.name = 'IdentityRoleVersionMismatchError';
  }
}

export class IdentityRoleLifecycleConflictError extends Error {
  public constructor() {
    super('The Identity Role lifecycle operation is not allowed');
    this.name = 'IdentityRoleLifecycleConflictError';
  }
}

export class IdentityRoleTimestampRegressionError extends Error {
  public constructor() {
    super('The Identity Role mutation time precedes its current update time');
    this.name = 'IdentityRoleTimestampRegressionError';
  }
}
