import { Test } from '@nestjs/testing';

import { ApiModule } from './api.module';

describe('ApiModule', (): void => {
  it('compiles the API composition root', async (): Promise<void> => {
    const moduleReference = await Test.createTestingModule({
      imports: [ApiModule],
    }).compile();

    try {
      expect(moduleReference).toBeDefined();
    } finally {
      await moduleReference.close();
    }
  });
});
