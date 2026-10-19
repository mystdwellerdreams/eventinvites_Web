import { randomBytes } from 'node:crypto'
import { prisma } from './prisma'

/** Invite tokens are short, URL-safe and unguessable enough for this purpose. */
export function generateInviteToken(): string {
  return randomBytes(12).toString('base64url')
}

export interface CreateInviteInput {
  createdById: string
  note?: string
  maxUses?: number
  expiresInDays?: number
}

export async function createInvite(input: CreateInviteInput) {
  const expiresAt =
    input.expiresInDays && input.expiresInDays > 0
      ? new Date(Date.now() + input.expiresInDays * 86_400_000)
      : null

  return prisma.invite.create({
    data: {
      token: generateInviteToken(),
      createdById: input.createdById,
      note: input.note?.trim() || null,
      maxUses: input.maxUses && input.maxUses > 0 ? Math.floor(input.maxUses) : 0,
      expiresAt,
    },
  })
}

export type InviteCheck =
  | { ok: true; inviteId: string }
  | { ok: false; reason: string }

/**
 * Validates an invitation without consuming a use, so the registration form
 * can tell an invited visitor they will be approved immediately.
 */
export async function checkInvite(token: string | undefined): Promise<InviteCheck> {
  if (!token) return { ok: false, reason: 'No invitation was supplied' }

  const invite = await prisma.invite.findUnique({ where: { token } })
  if (!invite) return { ok: false, reason: 'That invitation does not exist' }
  if (invite.revoked) return { ok: false, reason: 'That invitation has been withdrawn' }
  if (invite.expiresAt && invite.expiresAt < new Date()) {
    return { ok: false, reason: 'That invitation has expired' }
  }
  if (invite.maxUses > 0 && invite.uses >= invite.maxUses) {
    return { ok: false, reason: 'That invitation has already been used' }
  }

  return { ok: true, inviteId: invite.id }
}

/** Records a use against the invitation. Call after the user is created. */
export async function consumeInvite(inviteId: string): Promise<void> {
  await prisma.invite.update({
    where: { id: inviteId },
    data: { uses: { increment: 1 } },
  })
}