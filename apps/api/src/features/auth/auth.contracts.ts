import type { Request } from 'express';
import { ApiProperty } from '@nestjs/swagger';

export type AuthRole = 'ADMIN' | 'CUSTOMER';

export interface AuthPrincipal {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: AuthRole;
  readonly sessionId: string;
}

export interface AuthenticatedRequest extends Request {
  user: AuthPrincipal;
}

export class AuthUserResponse {
  @ApiProperty({ format: 'uuid' })
  public readonly id!: string;

  @ApiProperty({ format: 'email' })
  public readonly email!: string;

  @ApiProperty()
  public readonly name!: string;

  @ApiProperty({ type: [String] })
  public readonly permissions!: readonly string[];

  @ApiProperty({ enum: ['ADMIN', 'CUSTOMER'] })
  public readonly role!: AuthRole;

  @ApiProperty({ enum: ['ADMIN', 'CUSTOMER'], isArray: true })
  public readonly roles!: readonly AuthRole[];
}

export class AuthSessionResponse {
  @ApiProperty({ description: 'Short-lived opaque bearer token.' })
  public readonly accessToken!: string;

  @ApiProperty({ format: 'date-time' })
  public readonly accessTokenExpiresAt!: string;

  @ApiProperty({ description: 'Required for refresh and logout requests.' })
  public readonly csrfToken!: string;

  @ApiProperty({ enum: ['Bearer'] })
  public readonly tokenType!: 'Bearer';

  @ApiProperty({ type: () => AuthUserResponse })
  public readonly user!: AuthUserResponse;
}

export interface IssuedAuthSession {
  readonly response: AuthSessionResponse;
  readonly refreshToken: string;
  readonly refreshExpiresAt: Date;
}
