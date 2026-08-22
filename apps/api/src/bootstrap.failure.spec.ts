import { reportBootstrapFailure } from './bootstrap.failure';

describe('API bootstrap failure reporting', (): void => {
  it('writes one sanitized structured fatal record and sets a non-zero exit code', (): void => {
    const sensitiveFailure =
      'mysql://oms_app:bootstrap-password@private-db.example/oms with private stack';
    const records: string[] = [];
    const previousExitCode = process.exitCode;

    try {
      reportBootstrapFailure(new Error(sensitiveFailure), (record): void => {
        records.push(record);
      });

      expect(process.exitCode).toBe(1);
      expect(records).toHaveLength(1);
      expect(records[0]?.endsWith('\n')).toBe(true);

      const parsed = JSON.parse(records[0] ?? '') as unknown;

      expect(parsed).toMatchObject({
        err: {
          code: 'BOOTSTRAP_FAILED',
          type: 'BootstrapError',
        },
        event: 'application.bootstrap.failed',
        level: 'fatal',
        msg: 'Application bootstrap failed',
        service: 'oms-api',
      });
      expect(parsed).toHaveProperty('time', expect.any(String));
      expect(records[0]).not.toContain(sensitiveFailure);
      expect(records[0]).not.toContain('bootstrap-password');
      expect(records[0]).not.toContain('private-db.example');
      expect(records[0]).not.toContain('stack');
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it('keeps the bootstrap rejection handled when standard error is unavailable', (): void => {
    const previousExitCode = process.exitCode;

    try {
      expect((): void => {
        reportBootstrapFailure(new Error('sensitive failure'), (): never => {
          throw new Error('standard error unavailable');
        });
      }).not.toThrow();
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = previousExitCode;
    }
  });
});
