import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { AuthSessionResponse, AuthUserResponse, type AuthPrincipal } from './auth.contracts';
import { createClearedRefreshCookie, createRefreshCookie, readRefreshCookie } from './auth.cookies';
import { CurrentUser } from './current-user.decorator';
import { LoginDto, RegisterDto } from './auth.dto';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';

function requiredRefreshCookie(request: Request): string {
  const value = readRefreshCookie(request);

  if (value === undefined) throw new UnauthorizedException();
  return value;
}

function requiredCsrfToken(value: string | undefined): string {
  if (value === undefined || !/^[A-Za-z0-9_-]{43}$/u.test(value)) {
    throw new UnauthorizedException();
  }

  return value;
}

@Controller({ path: 'auth', version: '1' })
@ApiTags('Authentication')
export class AuthController {
  public constructor(private readonly authService: AuthService) {}

  @Post('register')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'registerUser' })
  @ApiCreatedResponse({ type: AuthSessionResponse })
  public async register(
    @Body() body: RegisterDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSessionResponse> {
    const session = await this.authService.register(body);

    response.setHeader(
      'Set-Cookie',
      createRefreshCookie(session.refreshToken, session.refreshExpiresAt),
    );
    return session.response;
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'loginUser' })
  @ApiOkResponse({ type: AuthSessionResponse })
  public async login(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSessionResponse> {
    const session = await this.authService.login(body);

    response.setHeader(
      'Set-Cookie',
      createRefreshCookie(session.refreshToken, session.refreshExpiresAt),
    );
    return session.response;
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiCookieAuth('refresh-token')
  @ApiHeader({
    description: 'CSRF token returned with the current access token.',
    name: 'X-CSRF-Token',
    required: true,
  })
  @ApiOperation({ operationId: 'refreshUserSession' })
  @ApiOkResponse({ type: AuthSessionResponse })
  public async refresh(
    @Req() request: Request,
    @Headers('x-csrf-token') csrfToken: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSessionResponse> {
    const session = await this.authService.refresh(
      requiredRefreshCookie(request),
      requiredCsrfToken(csrfToken),
    );

    response.setHeader(
      'Set-Cookie',
      createRefreshCookie(session.refreshToken, session.refreshExpiresAt),
    );
    return session.response;
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Cache-Control', 'no-store')
  @ApiCookieAuth('refresh-token')
  @ApiHeader({
    description: 'CSRF token returned with the current access token.',
    name: 'X-CSRF-Token',
    required: true,
  })
  @ApiOperation({ operationId: 'logoutUser' })
  @ApiNoContentResponse()
  public async logout(
    @Req() request: Request,
    @Headers('x-csrf-token') csrfToken: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.authService.logout(requiredRefreshCookie(request), requiredCsrfToken(csrfToken));
    response.setHeader('Set-Cookie', createClearedRefreshCookie());
  }

  @Get('me')
  @UseGuards(AuthGuard)
  @ApiBearerAuth('access-token')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'getCurrentUser' })
  @ApiOkResponse({ type: AuthUserResponse })
  public me(@CurrentUser() principal: AuthPrincipal): AuthUserResponse {
    return {
      id: principal.userId,
      email: principal.email,
      name: principal.displayName,
      permissions: [],
      role: principal.role,
      roles: [principal.role],
    };
  }
}
