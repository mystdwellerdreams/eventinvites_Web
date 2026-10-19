import { Request, Response, NextFunction } from 'express'
import { ZodError } from 'zod'
import { Prisma } from '../generated/prisma/client'
import { ApiRequest } from '../types'

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public code?: string
  ) {
    super(message)
    Object.setPrototypeOf(this, AppError.prototype)
  }
}

export const errorHandler = (err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Error:', err)

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation error',
      details: err.errors.map(e => ({
        field: e.path.join('.'),
        message: e.message
      }))
    })
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'A record with this value already exists' })
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Record not found' })
    }
  }

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: err.message, code: err.code })
  }

  // Body parsing and other middleware attach a status to their errors. Without
  // this they all collapse into a 500, which hides client mistakes such as
  // malformed JSON (400) or a payload over the size limit (413).
  const carried = Number(
    (err as { status?: unknown }).status ?? (err as { statusCode?: unknown }).statusCode
  )
  if (Number.isInteger(carried) && carried >= 400 && carried < 500) {
    return res.status(carried).json({ error: err.message || 'Request rejected' })
  }

  return res.status(500).json({ error: 'Internal server error' })
}

type AsyncRequestHandler = (
  req: ApiRequest,
  res: Response,
  next: NextFunction
) => Promise<unknown>

export const asyncHandler =
  (fn: AsyncRequestHandler) =>
  (req: ApiRequest, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }