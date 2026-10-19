import type { Prisma } from '../generated/prisma/client'
import { prisma } from './prisma'
import { atLeast } from './roles'

export const VISIBILITY_MODES = ['ALL', 'INCLUDE', 'EXCLUDE'] as const
export type VisibilityMode = (typeof VISIBILITY_MODES)[number]

export const isVisibilityMode = (value: unknown): value is VisibilityMode =>
  typeof value === 'string' && (VISIBILITY_MODES as readonly string[]).includes(value)

export interface Viewer {
  id?: string
  role?: string
}

/**
 * Administrators bypass every tag rule, so they always see every event.
 * `viewer` may be undefined for an anonymous request.
 */
export function viewerBypassesTags(viewer?: Viewer | null): boolean {
  return atLeast(viewer?.role, 'ADMIN')
}

/**
 * A Prisma `where` fragment restricting `Event` rows to those `viewer` may see.
 *
 * ALL      - no tag restriction at all.
 * INCLUDE  - the user must hold at least one of the listed tags.
 * EXCLUDE  - the user must hold none of the listed tags.
 *
 * An INCLUDE event with no tags configured is treated as visible to nobody: it
 * would otherwise silently open up to everyone, which is the opposite of what
 * "only these tags" means.
 */export function tagVisibilityFilter(viewer?: Viewer | null): Prisma.EventWhereInput {
  if (viewerBypassesTags(viewer)) {
    return {}
  }

  const userId = viewer?.id
  // Walks Event -> visibleTags (Tag) -> users, i.e. "this event lists a tag
  // that the viewer holds". Without a signed-in user nothing can match, so an
  // impossible id is used to keep the clause well-formed.
  const holdsListedTag: Prisma.TagWhereInput = userId
    ? { users: { some: { id: userId } } }
    : { users: { some: { id: '__no_user__' } } }

  return {
    OR: [
      { visibilityMode: 'ALL' },
      { visibilityMode: 'INCLUDE', visibleTags: { some: holdsListedTag } },
      { visibilityMode: 'EXCLUDE', visibleTags: { none: holdsListedTag } },
    ],
  }
}

/**
 * Resolves whether one specific event is visible to `viewer`.
 *
 * Used where a full query filter is not possible - fetching a single event by
 * id or key, and guarding registration.
 */
export async function isEventVisibleTo(
  event: { visibilityMode: string; visibleTags: { id: string }[] },
  viewer?: Viewer | null
): Promise<boolean> {
  if (viewerBypassesTags(viewer)) return true

  const mode = event.visibilityMode
  if (!isVisibilityMode(mode) || mode === 'ALL') return true

  const listed = event.visibleTags.map((t) => t.id)

  if (mode === 'INCLUDE') {
    // An anonymous visitor holds no tags, so "only these tags" excludes them.
    if (!viewer?.id) return false
    const held = await prisma.user.findUnique({
      where: { id: viewer.id },
      select: { tags: { select: { id: true } } },
    })
    const heldIds = new Set((held?.tags ?? []).map((t) => t.id))
    return listed.some((id) => heldIds.has(id))
  }

  // EXCLUDE: an anonymous visitor cannot hold a listed tag, so they qualify.
  if (!viewer?.id) return true

  const held = await prisma.user.findUnique({
    where: { id: viewer.id },
    select: { tags: { select: { id: true } } },
  })
  const heldIds = new Set((held?.tags ?? []).map((t) => t.id))
  return !listed.some((id) => heldIds.has(id))
}
