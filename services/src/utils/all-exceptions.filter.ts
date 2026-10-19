import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | object = 'Internal server error';
    let errorName = 'InternalServerError';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const resObj = res as Record<string, unknown>;
        message = (resObj.message as string | object) || exception.message;
        errorName = (resObj.error as string) || exception.name;
      }
    } else if (exception instanceof Error) {
      errorName = exception.name;
      // In production/dev, mask internal database or server stack traces from user response
      message =
        status === HttpStatus.INTERNAL_SERVER_ERROR
          ? 'An unexpected error occurred. Please try again later.'
          : exception.message;
    }

    // Safe logging: sanitize sensitive headers and URL query parameters
    const safeUrl = request.url?.replace(
      /([?&](key|secret|token)=)[^&]+/gi,
      '$1***',
    );
    const rawIp = request.ip || request.headers['x-forwarded-for'] || 'unknown';
    const clientIp = Array.isArray(rawIp) ? rawIp.join(',') : String(rawIp);

    this.logger.error(
      `[${request.method}] ${safeUrl} - Status: ${status} - Client: ${clientIp} - Error: ${
        exception instanceof Error
          ? exception.message
          : JSON.stringify(exception)
      }`,
    );

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: safeUrl,
      error: errorName,
      message,
    });
  }
}
