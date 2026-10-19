import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { randomUUID } from 'crypto'
import { prisma } from '../utils/prisma'
import { DEFAULT_ROLE, atLeast, getRole } from '../utils/roles'
import { ApiRequest } from '../types'

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'
const REFRESH_SECRET = process.env.REFRESH_SECRET || 'your-super-secret-refresh-key-change-in-production'

export interface AuthUser {
  id: string
  email: string | null
  role: string
}

export interface AuthRequest extends ApiRequest {
  user?: AuthUser
}

export const generateTokens = (user: AuthUser) => {
  // `iat` only has second resolution, so a `jti` keeps tokens issued for the
  // same user in the same second distinct. Refresh tokens are stored by value.
  const accessToken = jwt.sign(
    { id: user.id, email: user.email, role: user.role, jti: randomUUID() },
    JWT_SECRET,
    { expiresIn: '15m' }
  )
  const refreshToken = jwt.sign(
    { id: user.id, email: user.email, role: user.role, jti: randomUUID() },
    REFRESH_SECRET,
    { expiresIn: '7d' }
  )
  return { accessToken, refreshToken }
}

export const verifyAccessToken = (token: string) => {
  return jwt.verify(token, JWT_SECRET) as { id: string; email: string; role: string }
}

export const verifyRefreshToken = (token: string) => {
  return jwt.verify(token, REFRESH_SECRET) as { id: string; email: string; role: string }
}

/**
 * The access token is read from the `Authorization: Bearer` header first — the
 * Android app's channel, where Bearer tokens are the auth mechanism — and falls
 * back to the `accessToken` cookie, which is how the browser authenticates.
 * Bearer wins so the two never interfere: the app sends a header and no cookie,
 * the browser sends a cookie and no header.
 */
function extractAccessToken(req: AuthRequest): string | undefined {
  const header = req.headers.authorization
  if (header?.startsWith('Bearer ')) {
    return header.slice(7)
  }
  return req.cookies?.accessToken
}

export const authMiddleware = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const accessToken = extractAccessToken(req)
    if (!accessToken) {
      return res.status(401).json({ error: 'Authentication required' })
    }
    const decoded = verifyAccessToken(accessToken)
    const user = await prisma.user.findUnique({ where: { id: decoded.id } })
    if (!user) {
      return res.status(401).json({ error: 'User not found' })
    }
    req.user = { id: user.id, email: user.email, role: user.role }
    next()
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' })
    }
    return res.status(401).json({ error: 'Invalid token' })
  }
}

export const optionalAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const accessToken = extractAccessToken(req)
    if (accessToken) {
      const decoded = verifyAccessToken(accessToken)
      const user = await prisma.user.findUnique({ where: { id: decoded.id } })
      if (user) {
        req.user = { id: user.id, email: user.email, role: user.role }
      }
    }
    next()
  } catch {
    next()
  }
}

export const requireRole = (minimum: string) => (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' })
  }
  if (!atLeast(req.user.role, minimum)) {
    const role = getRole(minimum)
    return res.status(403).json({ error: `${role?.label ?? minimum} access required` })
  }
  next()
}

export const requireAdmin = requireRole('ADMIN')

export const roleOrDefault = (role: string | null | undefined) => role ?? DEFAULT_ROLE

export { JWT_SECRET, REFRESH_SECRET }