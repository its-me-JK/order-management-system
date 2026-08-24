import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class NotificationParametersDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  public readonly notificationId!: string;
}

export class NotificationResponseDto {
  @ApiProperty({ format: 'date-time' })
  public readonly createdAt!: string;

  @ApiProperty({ format: 'uuid' })
  public readonly id!: string;

  @ApiProperty()
  public readonly message!: string;

  @ApiProperty({ format: 'date-time', nullable: true })
  public readonly readAt!: string | null;

  @ApiProperty()
  public readonly title!: string;

  @ApiProperty()
  public readonly type!: string;
}
