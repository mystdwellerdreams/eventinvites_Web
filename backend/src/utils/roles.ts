export interface RoleDefinition {
  key: string
  label: string
  description: string
  /** Roles whose key appears here implicitly pass `requireRole` checks. */
  rank: number
}

export const ROLES: RoleDefinition[] = [
  {
    key: 'GUEST',
    label: 'Guest',
    description:
      'Signed up without an invitation. Can browse events but cannot register for them or see who else is going.',
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
    description:
      'Creates, edits and deletes events, manages participant lists and sign-ups, and grants or revokes roles.',
    rank: 3,
  },
]

export const DEFAULT_ROLE = 'USER'

/** Given to accounts created without a valid invitation link. */
export const GUEST_ROLE = 'GUEST'

export const ROLE_KEYS = ROLES.map((r) => r.key)

export function isRole(value: unknown): value is string {
  return typeof value === 'string' && ROLE_KEYS.includes(value)
}

export function getRole(key: string): RoleDefinition | undefined {
  return ROLES.find((r) => r.key === key)
}

/** True when the role is at least as privileged as `minimum`. */
export function atLeast(role: string | undefined, minimum: string): boolean {
  const current = getRole(role ?? DEFAULT_ROLE)
  const required = getRole(minimum)
  if (!current || !required) return false
  return current.rank >= required.rank
}

/** Guests are approved by an administrator before they can register. */
export function isGuest(role: string | undefined): boolean {
  return getRole(role ?? '')?.key === GUEST_ROLE
}
