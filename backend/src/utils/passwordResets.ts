import { randomBytes } from 'node:crypto'
import { prisma } from './prisma'
import { AppError } from '../middleware/errorHandler'
import { notifyUser } from './notifications'

/** Reset tokens are short, URL-safe and unguessable. */
export function generateResetToken(): string {
  return randomBytes(16).toString('base64url')
}

/** A reset link stays valid for 24 hours. */
export const RESET_TOKEN_TTL_MS = 24 * 60 * 60 * 1000

export interface PasswordResetRecord {
  id: string
  token: string
  userId: string
  expiresAt: Date
  usedAt: Date | null
  createdAt: Date
}

/** Creates a pending reset request for a user. */
export async function createPasswordReset(
  userId: string
): Promise<PasswordResetRecord> {
  const record = await prisma.passwordReset.create({
    data: {
      token: generateResetToken(),
      userId,
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    },
  })

  // The user is told a reset was prepared, since the link itself is handed
  // over by an administrator rather than sent to them.
  await notifyUser({
    userId,
    type: 'PASSWORD_RESET',
    title: '',
    targetType: 'USER',
    targetId: userId,
  })

  return record
}

/**
 * Validates a reset token. Throws when the token is unknown, expired
 * or already used, so the caller can answer with a single error.
 */
export async function validatePasswordReset(
  token: string
): Promise<PasswordResetRecord> {
  const record = await prisma.passwordReset.findUnique({ where: { token } })
  if (!record) {
    throw new AppError(404, 'That reset link is invalid')
  }
  if (record.usedAt) {
    throw new AppError(410, 'That reset link has already been used')
  }
  if (record.expiresAt < new Date()) {
    throw new AppError(410, 'That reset link has expired')
  }
  return record
}

/** Marks a token as used so the link cannot be replayed. */
export async function consumePasswordReset(token: string): Promise<void> {
  await prisma.passwordReset.update({
    where: { token },
    data: { usedAt: new Date() },
  })
}
