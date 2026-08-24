import { Controller, Get, NotFoundException, Param, Patch, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { AuthPrincipal } from '../auth/auth.contracts';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { dataEnvelopeSchema } from '../../platform/openapi/data-envelope.schema';
import { NotificationParametersDto, NotificationResponseDto } from './notification.dto';
import { NotificationNotFoundError } from './notification.errors';
import { NotificationService } from './notification.service';

@ApiTags('Notifications')
@ApiBearerAuth('access-token')
@ApiExtraModels(NotificationResponseDto)
@UseGuards(AuthGuard)
@Controller({ path: 'notifications', version: '1' })
export class NotificationController {
  public constructor(private readonly notifications: NotificationService) {}

  @Get()
  @ApiOperation({ operationId: 'listNotifications', summary: 'List current user notifications' })
  @ApiOkResponse({ schema: dataEnvelopeSchema(NotificationResponseDto, true) })
  public async list(@CurrentUser() principal: AuthPrincipal) {
    return { data: await this.notifications.list(principal.userId) };
  }

  @Patch(':notificationId/read')
  @ApiOperation({ operationId: 'markNotificationRead', summary: 'Mark a notification as read' })
  @ApiOkResponse({ schema: dataEnvelopeSchema(NotificationResponseDto) })
  public async markRead(
    @CurrentUser() principal: AuthPrincipal,
    @Param() parameters: NotificationParametersDto,
  ) {
    try {
      return {
        data: await this.notifications.markRead(principal.userId, parameters.notificationId),
      };
    } catch (error: unknown) {
      if (error instanceof NotificationNotFoundError) {
        throw new NotFoundException();
      }

      throw error;
    }
  }
}
