import type {NextFunction, Request, Response} from 'express';

/**
 * Method decorator to catch async errors in OvernightJS controllers
 * Wraps async controller methods to ensure errors are passed to Express error handler
 *
 * Usage:
 * @Post('route')
 * @CatchAsync
 * public async myMethod(req: Request, res: Response) { ... }
 *
 * This decorator ensures all errors (sync and async) thrown in the method
 * are caught and passed to the Express error middleware, fixing the hanging
 * request issue when Zod validation fails.
 */
export function CatchAsync(target: object, propertyKey: string, descriptor: PropertyDescriptor) {
  const originalMethod = descriptor.value;

  descriptor.value = function (req: Request, res: Response, next: NextFunction) {
    return Promise.resolve(originalMethod.call(this, req, res, next)).catch(next);
  };

  return descriptor;
}
