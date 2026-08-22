import { writeSync } from 'node:fs';

const STANDARD_ERROR_FILE_DESCRIPTOR = 2;

export type BootstrapFailureWriter = (record: string) => void;

function writeToStandardError(record: string): void {
  writeSync(STANDARD_ERROR_FILE_DESCRIPTOR, record);
}

export function reportBootstrapFailure(
  _error: unknown,
  write: BootstrapFailureWriter = writeToStandardError,
): void {
  const record = {
    err: {
      code: 'BOOTSTRAP_FAILED',
      type: 'BootstrapError',
    },
    event: 'application.bootstrap.failed',
    level: 'fatal',
    msg: 'Application bootstrap failed',
    service: 'oms-api',
    time: new Date().toISOString(),
  } as const;

  try {
    write(`${JSON.stringify(record)}\n`);
  } catch {
    // A broken stderr must not turn a handled bootstrap failure into a rejection.
  }

  process.exitCode = 1;
}
