
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<{ method: string; url: string }>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'An unexpected error occurred.';
    let kind = 'server';
    let fieldErrors: Record<string, string> | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();

      if (typeof body === 'string') {
        message = body;
      } else if (typeof body === 'object' && body !== null) {
        const obj = body as Record<string, unknown>;
        message = Array.isArray(obj.message)
          ? obj.message.join(', ')
          : String(obj.message ?? message);

        if (typeof obj.kind === 'string') kind = obj.kind;

        if (obj.fieldErrors && typeof obj.fieldErrors === 'object') {
          fieldErrors = obj.fieldErrors as Record<string, string>;
        }
      }

      kind =
        status === 401 ? 'unauthenticated'
        : status === 403 ? 'forbidden'
        : status === 404 ? 'notFound'
        : status === 400 || status === 422 ? 'validation'
        : status === 409 ? 'conflict'
        : status >= 500 ? 'server'
        : 'client';
    } else {
      // Log the actual error only in the backend terminal.
      this.logger.error(
        `${request.method} ${request.url} failed`,
        exception instanceof Error
          ? exception.stack
          : String(exception),
      );
    }

    if (status >= 500 && exception instanceof HttpException) {
      this.logger.error(
        `${request.method} ${request.url} returned HTTP ${status}: ${message}`,
      );
    }

    if (response.headersSent) return;

    response.status(status).json({
      kind,
      message,
      statusCode: status,
      fieldErrors: fieldErrors ?? null,
    });
  }
}
