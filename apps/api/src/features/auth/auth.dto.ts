import { IsEmail, IsString, Length, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

const DISPLAY_NAME_PATTERN = /^(?!\s)(?!.*\s$)[\p{L}\p{M}\p{N} .'-]+$/u;

export class RegisterDto {
  @ApiProperty({ example: 'customer@example.com', format: 'email', maxLength: 191 })
  @IsEmail()
  @Length(3, 191)
  public readonly email!: string;

  @ApiProperty({ example: 'Alex Customer', maxLength: 120, minLength: 2 })
  @IsString()
  @Length(2, 120)
  @Matches(DISPLAY_NAME_PATTERN)
  public readonly displayName!: string;

  @ApiProperty({ maxLength: 128, minLength: 12, writeOnly: true })
  @IsString()
  @Length(12, 128)
  public readonly password!: string;
}

export class LoginDto {
  @ApiProperty({ example: 'customer@example.com', format: 'email', maxLength: 191 })
  @IsEmail()
  @Length(3, 191)
  public readonly email!: string;

  @ApiProperty({ maxLength: 128, minLength: 1, writeOnly: true })
  @IsString()
  @Length(1, 128)
  public readonly password!: string;
}
