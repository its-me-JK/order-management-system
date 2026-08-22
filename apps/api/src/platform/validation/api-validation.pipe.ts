import { BadRequestException, ValidationPipe, type ValidationPipeOptions } from '@nestjs/common';

const VALIDATION_ERROR_OPTIONS = Object.freeze({
  target: false,
  value: false,
});

function invalidRequestException(): BadRequestException {
  return new BadRequestException();
}

export const API_VALIDATION_PIPE_OPTIONS: Readonly<ValidationPipeOptions> = Object.freeze({
  disableErrorMessages: true,
  dismissDefaultMessages: true,
  enableDebugMessages: false,
  exceptionFactory: invalidRequestException,
  forbidNonWhitelisted: true,
  forbidUnknownValues: true,
  skipMissingProperties: false,
  skipNullProperties: false,
  skipUndefinedProperties: false,
  stopAtFirstError: true,
  transform: false,
  validateCustomDecorators: false,
  validationError: VALIDATION_ERROR_OPTIONS,
  whitelist: true,
});

export function createApiValidationPipe(): ValidationPipe {
  return new ValidationPipe(API_VALIDATION_PIPE_OPTIONS);
}
