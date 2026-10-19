import type { Role } from '../types'
import { authAPI } from './api'

/**
 * Roles are data, not code: the backend owns the registry so that a new role
 * only has to be added there. This list is only used until the API answers.
 */
export const FALLBACK_ROLES: Role[] = [
  {
    key: 'GUEST',
    label: 'Guest',
    description:
      'Signed up without an invitation. Can browse events but cannot register or see participants.',
    rank: 1,
  },
  {
    key: 'USER',
    label: 'Regular user',
    description: 'Signs up for events and manages their own profile.',
    rank: 2,
  },
  {
    key: 'ADMIN',
    label: 'Administrator',
    description: 'Manages events, participant lists, sign-ups and roles.',
    rank: 3,
  },
]

export const ADMIN_ROLE = 'ADMIN'
export const GUEST_ROLE = 'GUEST'

/** A guest awaiting approval: cannot register, and cannot see participants. */
export function isGuest(user: { role?: string } | null | undefined): boolean {
  return user?.role === GUEST_ROLE
}

export async function fetchRoles(): Promise<Role[]> {
  try {
    const response = await authAPI.roles()
    return response.data.roles as Role[]
  } catch {
    return FALLBACK_ROLES
  }
}

export function hasRole(user: { role?: string } | null, minimum: string = ADMIN_ROLE): boolean {
  const current = FALLBACK_ROLES.find((r) => r.key === user?.role)
  const required = FALLBACK_ROLES.find((r) => r.key === minimum)
  if (!current || !required) return false
  return current.rank >= required.rank
}
