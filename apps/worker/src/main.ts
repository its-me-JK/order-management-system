import {
  findWorkerBaseDirectory,
  loadWorkerEnvironment,
  parseWorkerConfiguration,
} from './worker.configuration';
import { createWorkerRuntime, type WorkerRuntime } from './worker.runtime';

async function bootstrap(): Promise<void> {
  const baseDirectory = findWorkerBaseDirectory(process.cwd());

  loadWorkerEnvironment(baseDirectory);

  const configuration = parseWorkerConfiguration(process.env, baseDirectory);
  const runtime = await createWorkerRuntime(configuration);

  await runtime.start();
  installShutdown(runtime);
}

function installShutdown(runtime: WorkerRuntime): void {
  let shutdown: Promise<void> | undefined;

  const stop = (): void => {
    shutdown ??= runtime.close();
    void shutdown.catch((): void => {
      process.exitCode = 1;
    });
  };

  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

void bootstrap().catch((): void => {
  process.stderr.write(
    `${JSON.stringify({ event: 'worker.bootstrap_failed', level: 'error', service: 'oms-worker' })}\n`,
  );
  process.exitCode = 1;
});
