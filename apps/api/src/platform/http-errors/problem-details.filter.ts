import { Catch, Injectable, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';

import { ProblemDetailsResponseWriter } from './problem-details.response-writer';
import { mapExceptionToProblem } from './problem-mapper';

@Catch()
@Injectable()
export class ProblemDetailsFilter implements ExceptionFilter {
  public constructor(private readonly responseWriter: ProblemDetailsResponseWriter) {}

  public catch(exception: unknown, host: ArgumentsHost): void {
    this.responseWriter.write(host, exception, mapExceptionToProblem(exception));
  }
}
