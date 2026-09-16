import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<FastifyReply>();
    const request = host.switchToHttp().getRequest<FastifyRequest>();
    let status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    let detail: unknown = exception instanceof HttpException ? exception.getResponse() : undefined;
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const target = Array.isArray(exception.meta?.target)
        ? exception.meta.target.join(', ')
        : 'This value';
      if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        detail = `${target} already exists. Please use a different value.`;
      } else if (exception.code === 'P2003') {
        status = HttpStatus.BAD_REQUEST;
        detail = 'The selected related record does not exist or cannot be used.';
      } else if (exception.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        detail = 'The requested record was not found.';
      }
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      status = HttpStatus.BAD_REQUEST;
      detail = 'Some submitted values are invalid. Please review the form and try again.';
    } else if (exception instanceof Prisma.PrismaClientInitializationError) {
      status = HttpStatus.SERVICE_UNAVAILABLE;
      detail = 'The database is temporarily unavailable. Please try again shortly.';
    }
    if (status >= 500) {
      const error = exception instanceof Error ? exception : new Error(String(exception));
      this.logger.error(`${request.method} ${request.url}: ${error.message}`, error.stack);
    }
    const message =
      typeof detail === 'string'
        ? detail
        : detail && typeof detail === 'object' && 'message' in detail
          ? (detail as { message: string | string[] }).message
          : status === 500
            ? 'Internal server error'
            : 'Request failed';
    void response.status(status).send({
      statusCode: status,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
      requestId: response.getHeader('x-request-id'),
    });
  }
}
