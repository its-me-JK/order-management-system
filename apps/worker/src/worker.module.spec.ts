import { Test } from '@nestjs/testing';

import { WorkerModule } from './worker.module';

describe('WorkerModule', (): void => {
  it('compiles the worker composition root', async (): Promise<void> => {
    const moduleReference = await Test.createTestingModule({
      imports: [WorkerModule],
    }).compile();

    try {
      expect(moduleReference).toBeDefined();
    } finally {
      await moduleReference.close();
    }
  });
});
