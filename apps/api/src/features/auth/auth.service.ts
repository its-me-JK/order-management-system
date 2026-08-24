import { createHash, randomBytes, randomUUID } from 'node:crypto';

import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { PrismaClient } from '@oms/database/prisma';
import { DATABASE_CLIENT } from '../../platform/database/database.tokens';
import { REDIS_RUNTIME } from '../../platform/redis/redis.tokens';
import type { LoginDto, RegisterDto } from './auth.dto';
import type {
  AuthPrincipal,
  AuthSessionResponse,
  AuthUserResponse,
  IssuedAuthSession,
} from './auth.contracts';
import { hashPassword, verifyPassword } from './password-hasher';

const ACCESS_TOKEN_LIFETIME_MS = 15 * 60 * 1_000;
const REFRESH_TOKEN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1_000;
const TOKEN_BYTES = 32;
const LOGIN_RATE_LIMIT_TTL_SECONDS = 5 * 60;
const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 10;
const DUMMY_PASSWORD_HASH =
  'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$CGfhfRZ0baFLJ72aPm3YeT_bzNdl2f0iuBGF5ApKqaCmDWw9uT9VYOLhYk3v4siF_oV_YnqpnfZP8doIWg4jug';

type LoginRateLimitRuntime = Readonly<{
  delete(key: string): Promise<void>;
  incrementWithTtl(key: string, ttlSeconds: number): Promise<number>;
}>;

type PersistedUser = Readonly<{
  id: string;
  email: string;
  displayName: string;
  role: 'ADMIN' | 'CUSTOMER';
  status: 'ACTIVE' | 'DISABLED';
}>;

type CredentialSet = Readonly<{
  accessToken: string;
  accessTokenHash: string;
  accessExpiresAt: Date;
  refreshToken: string;
  refreshTokenHash: string;
  refreshExpiresAt: Date;
  csrfToken: string;
  csrfTokenHash: string;
}>;

function token(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function issueCredentials(now = new Date()): CredentialSet {
  const accessToken = token();
  const refreshToken = token();
  const csrfToken = token();

  return {
    accessToken,
    accessTokenHash: digest(accessToken),
    accessExpiresAt: new Date(now.getTime() + ACCESS_TOKEN_LIFETIME_MS),
    refreshToken,
    refreshTokenHash: digest(refreshToken),
    refreshExpiresAt: new Date(now.getTime() + REFRESH_TOKEN_LIFETIME_MS),
    csrfToken,
    csrfTokenHash: digest(csrfToken),
  };
}

function normalizeEmail(email: string): string {
  return email.toLowerCase();
}

function loginRateLimitKey(email: string): string {
  return `oms:auth:login:${digest(email)}`;
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && Reflect.get(error, 'code') === 'P2002';
}

function mapUser(user: PersistedUser): AuthUserResponse {
  return {
    id: user.id,
    email: user.email,
    name: user.displayName,
    permissions: [],
    role: user.role,
    roles: [user.role],
  };
}

function issuedSession(user: PersistedUser, credentials: CredentialSet): IssuedAuthSession {
  const response: AuthSessionResponse = {
    accessToken: credentials.accessToken,
    accessTokenExpiresAt: credentials.accessExpiresAt.toISOString(),
    csrfToken: credentials.csrfToken,
    tokenType: 'Bearer',
    user: mapUser(user),
  };

  return {
    response,
    refreshToken: credentials.refreshToken,
    refreshExpiresAt: credentials.refreshExpiresAt,
  };
}

@Injectable()
export class AuthService {
  public constructor(
    @Inject(DATABASE_CLIENT)
    private readonly prisma: PrismaClient,
    @Inject(REDIS_RUNTIME)
    private readonly redis: LoginRateLimitRuntime,
  ) {}

  public async register(input: RegisterDto): Promise<IssuedAuthSession> {
    const credentials = issueCredentials();
    const sessionId = randomUUID();
    const passwordHash = await hashPassword(input.password);

    try {
      const user = await this.prisma.$transaction(async (transaction): Promise<PersistedUser> => {
        const created = await transaction.userRecord.create({
          data: {
            id: randomUUID(),
            email: normalizeEmail(input.email),
            displayName: input.displayName,
            passwordHash,
            role: 'CUSTOMER',
          },
        });

        await transaction.sessionRecord.create({
          data: {
            id: sessionId,
            userId: created.id,
            accessTokenHash: credentials.accessTokenHash,
            refreshTokenHash: credentials.refreshTokenHash,
            csrfTokenHash: credentials.csrfTokenHash,
            accessExpiresAt: credentials.accessExpiresAt,
            refreshExpiresAt: credentials.refreshExpiresAt,
          },
        });

        return created;
      });

      return issuedSession(user, credentials);
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) throw new ConflictException();
      throw error;
    }
  }

  public async login(input: LoginDto): Promise<IssuedAuthSession> {
    const normalizedEmail = normalizeEmail(input.email);
    const rateLimitKey = loginRateLimitKey(normalizedEmail);
    let attemptCount: number;

    try {
      attemptCount = await this.redis.incrementWithTtl(rateLimitKey, LOGIN_RATE_LIMIT_TTL_SECONDS);
    } catch (error: unknown) {
      throw new ServiceUnavailableException(undefined, { cause: error });
    }

    if (attemptCount > LOGIN_RATE_LIMIT_MAX_ATTEMPTS) {
      throw new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS);
    }

    const user = await this.prisma.userRecord.findUnique({
      where: { email: normalizedEmail },
    });
    const passwordMatches = await verifyPassword(
      input.password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );

    if (user?.status !== 'ACTIVE' || !passwordMatches) {
      throw new UnauthorizedException();
    }

    const credentials = issueCredentials();
    const sessionId = randomUUID();

    await this.prisma.sessionRecord.create({
      data: {
        id: sessionId,
        userId: user.id,
        accessTokenHash: credentials.accessTokenHash,
        refreshTokenHash: credentials.refreshTokenHash,
        csrfTokenHash: credentials.csrfTokenHash,
        accessExpiresAt: credentials.accessExpiresAt,
        refreshExpiresAt: credentials.refreshExpiresAt,
      },
    });

    try {
      await this.redis.delete(rateLimitKey);
    } catch {
      // A successful credential check remains authoritative; the short TTL bounds stale state.
    }

    return issuedSession(user, credentials);
  }

  public async refresh(refreshToken: string, csrfToken: string): Promise<IssuedAuthSession> {
    const now = new Date();
    const refreshTokenHash = digest(refreshToken);
    const session = await this.prisma.sessionRecord.findUnique({
      where: { refreshTokenHash },
      include: { user: true },
    });

    if (
      session?.revokedAt !== null ||
      session.refreshExpiresAt <= now ||
      session.user.status !== 'ACTIVE'
    ) {
      throw new UnauthorizedException();
    }

    if (session.csrfTokenHash !== digest(csrfToken)) throw new ForbiddenException();

    const credentials = issueCredentials(now);
    const updated = await this.prisma.sessionRecord.updateMany({
      where: {
        id: session.id,
        refreshTokenHash,
        revokedAt: null,
        refreshExpiresAt: { gt: now },
      },
      data: {
        accessTokenHash: credentials.accessTokenHash,
        refreshTokenHash: credentials.refreshTokenHash,
        csrfTokenHash: credentials.csrfTokenHash,
        accessExpiresAt: credentials.accessExpiresAt,
        refreshExpiresAt: credentials.refreshExpiresAt,
      },
    });

    if (updated.count !== 1) throw new UnauthorizedException();

    return issuedSession(session.user, credentials);
  }

  public async logout(refreshToken: string, csrfToken: string): Promise<void> {
    const session = await this.prisma.sessionRecord.findUnique({
      where: { refreshTokenHash: digest(refreshToken) },
    });

    if (session?.revokedAt !== null) throw new UnauthorizedException();
    if (session.csrfTokenHash !== digest(csrfToken)) throw new ForbiddenException();

    await this.prisma.sessionRecord.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  public async authenticateAccessToken(accessToken: string): Promise<AuthPrincipal> {
    const now = new Date();
    const session = await this.prisma.sessionRecord.findUnique({
      where: { accessTokenHash: digest(accessToken) },
      include: { user: true },
    });

    if (
      session?.revokedAt !== null ||
      session.accessExpiresAt <= now ||
      session.user.status !== 'ACTIVE'
    ) {
      throw new UnauthorizedException();
    }

    return {
      userId: session.user.id,
      email: session.user.email,
      displayName: session.user.displayName,
      role: session.user.role,
      sessionId: session.id,
    };
  }
}
