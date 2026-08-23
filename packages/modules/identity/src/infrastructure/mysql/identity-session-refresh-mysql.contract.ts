/** Closed failure vocabulary for Identity's eventual fixed refresh transaction program. */
export type IdentitySessionRefreshMySqlTransactionFailure =
  'credential-collision' | 'conditional-conflict' | 'unavailable' | 'execution-defect';
