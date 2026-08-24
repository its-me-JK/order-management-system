import { spawn } from 'node:child_process';

import { deployMigrations } from './run-migrations.mjs';

const FORCE_KILL_DELAY_MILLISECONDS = 10_000;

function start(name, entrypoint) {
  const child = spawn(process.execPath, [entrypoint], {
    env: process.env,
    stdio: 'inherit',
  });

  child.once('error', () => {
    process.stderr.write(
      `${JSON.stringify({ event: 'runtime.child_start_failed', level: 'error', process: name })}\n`,
    );
  });

  return { child, name };
}

async function main() {
  await deployMigrations();

  const processes = [
    start('api', 'apps/api/dist/main.js'),
    start('worker', 'apps/worker/dist/main.js'),
  ];
  let stopping = false;
  let exitCode = 0;

  const stop = (signal, requestedExitCode) => {
    if (stopping) {
      return;
    }

    stopping = true;
    exitCode = requestedExitCode;

    for (const process_ of processes) {
      if (process_.child.exitCode === null && process_.child.signalCode === null) {
        process_.child.kill(signal);
      }
    }

    const timer = setTimeout(() => {
      for (const process_ of processes) {
        if (process_.child.exitCode === null && process_.child.signalCode === null) {
          process_.child.kill('SIGKILL');
        }
      }
    }, FORCE_KILL_DELAY_MILLISECONDS);
    timer.unref();
  };

  process.once('SIGINT', () => stop('SIGINT', 0));
  process.once('SIGTERM', () => stop('SIGTERM', 0));

  await Promise.all(
    processes.map(
      (process_) =>
        new Promise((resolve) => {
          process_.child.once('exit', (code, signal) => {
            if (!stopping) {
              process.stderr.write(
                `${JSON.stringify({
                  event: 'runtime.child_exited',
                  level: 'error',
                  process: process_.name,
                  result: signal ?? String(code),
                })}\n`,
              );
              stop('SIGTERM', code === null || code === 0 ? 1 : code);
            }

            resolve();
          });
        }),
    ),
  );

  process.exitCode = exitCode;
}

main().catch(() => {
  process.stderr.write(
    `${JSON.stringify({ event: 'runtime.bootstrap_failed', level: 'error' })}\n`,
  );
  process.exitCode = 1;
});
