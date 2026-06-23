// src/middlewares/errorHandler.ts

import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

/** A domain error that carries an HTTP status code. */
export class AppError extends Error {
  constructor(
    message: string,
    public statusCode = 400,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/** Wrap an async route handler so thrown errors reach the error handler. */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res, next)).catch(next);

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler = (err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) {
    return res.status(422).json({
      error: 'Validation failed',
      details: err.errors.map((e) => ({ path: e.path.join('.'), message: e.message })),
    });
  }

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: err.message });
  }

  // Prisma "record not found" on update/delete.
  if (err?.code === 'P2025') {
    return res.status(404).json({ error: 'Resource not found' });
  }
  // Prisma unique constraint (e.g. duplicate email).
  if (err?.code === 'P2002') {
    return res.status(409).json({ error: 'Resource already exists' });
  }

  console.error(err);
  res.status(500).json({
    error: 'An unexpected error occurred',
    message: err?.message || 'Internal Server Error',
  });
};
