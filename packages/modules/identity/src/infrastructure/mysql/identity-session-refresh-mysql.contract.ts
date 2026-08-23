/** Closed failure vocabulary for Identity's fixed refresh transaction program. */
export type IdentitySessionRefreshMySqlTransactionFailure =
  'credential-collision' | 'conditional-conflict' | 'unavailable' | 'execution-defect';
