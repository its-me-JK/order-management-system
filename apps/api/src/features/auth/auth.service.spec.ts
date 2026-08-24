import { HttpException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';

import { AuthService } from './auth.service';
import { hashPassword } from './password-hasher';

function dependencies(overrides: Readonly<{ attempts?: number; user?: unknown }> = {}) {
  const createSession = jest.fn((): Promise<unknown> => Promise.resolve({}));
  const findUser = jest.fn((): Promise<unknown> => Promise.resolve(overrides.user ?? null));
  const incrementWithTtl = jest.fn((): Promise<number> => Promise.resolve(overrides.attempts ?? 1));
  const deleteKey = jest.fn((): Promise<void> => Promise.resolve());
  const prisma = {
    sessionRecord: { create: createSession },
    userRecord: { findUnique: findUser },
  };
  const redis = {
    delete: deleteKey,
    incrementWithTtl,
  };

  return {
    createSession,
    deleteKey,
    findUser,
    incrementWithTtl,
    service: new AuthService(prisma as never, redis),
  };
}

describe('AuthService login throttling', (): void => {
  it('rejects the eleventh attempt before querying credentials', async (): Promise<void> => {
    const { findUser, incrementWithTtl, service } = dependencies({ attempts: 11 });
    const operation = service.login({
      email: 'Customer@Example.com',
      password: 'not-the-password',
    });

    await expect(operation).rejects.toBeInstanceOf(HttpException);
    await expect(operation).rejects.toMatchObject({ status: 429 });
    expect(incrementWithTtl).toHaveBeenCalledWith(
      expect.stringMatching(/^oms:auth:login:[0-9a-f]{64}$/u),
      300,
    );
    expect(findUser).not.toHaveBeenCalled();
  });

  it('fails closed when the shared limiter is unavailable', async (): Promise<void> => {
    const { incrementWithTtl, service } = dependencies();

    incrementWithTtl.mockRejectedValueOnce(new Error('unavailable'));

    await expect(
      service.login({ email: 'customer@example.com', password: 'not-the-password' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('keeps the counter after rejected credentials', async (): Promise<void> => {
    const { deleteKey, service } = dependencies();

    await expect(
      service.login({ email: 'customer@example.com', password: 'not-the-password' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(deleteKey).not.toHaveBeenCalled();
  });

  it('clears the bounded key after a successful login', async (): Promise<void> => {
    const password = 'a-production-length-password';
    const passwordHash = await hashPassword(password);
    const { createSession, deleteKey, service } = dependencies({
      user: {
        displayName: 'Customer',
        email: 'customer@example.com',
        id: '1d9235c8-70e7-4993-82db-bc99516df4d6',
        passwordHash,
        role: 'CUSTOMER',
        status: 'ACTIVE',
      },
    });

    const result = await service.login({ email: 'customer@example.com', password });

    expect(result.response.user).toEqual({
      email: 'customer@example.com',
      id: '1d9235c8-70e7-4993-82db-bc99516df4d6',
      name: 'Customer',
      permissions: [],
      role: 'CUSTOMER',
      roles: ['CUSTOMER'],
    });
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(deleteKey).toHaveBeenCalledWith(expect.stringMatching(/^oms:auth:login:[0-9a-f]{64}$/u));
  });
});
