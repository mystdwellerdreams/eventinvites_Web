import { prisma } from './prisma'
import { AppError } from '../middleware/errorHandler'
import { isEventVisibleTo } from './visibility'
import { isPubliclyVisibleNow } from './eventPolicy'
import { atLeast } from './roles'

interface Viewer {
  id: string
  role: string
}

/**
 * Opens the event exactly the way its own page does: the same publish, time
 * and tag rules, in the same order. A visitor who cannot open the event page
 * cannot read or write its discussion either — and for the same reason
 * cannot open the conversation that discussion became, so the event's
 * comment thread stays as visible as the event itself.
 */
export async function loadEventForComments(eventId: string, viewer?: Viewer | null) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      title: true,
      isPublished: true,
      dateTime: true,
      endsAt: true,
      afterStartPolicy: true,
      visibilityMode: true,
      visibleTags: { select: { id: true } },
    },
  })
  if (!event) {
    throw new AppError(404, 'Event not found')
  }
  if (!event.isPublished && !atLeast(viewer?.role, 'ADMIN')) {
    throw new AppError(404, 'Event not found')
  }
  if (
    !atLeast(viewer?.role, 'ADMIN') &&
    event.isPublished &&
    !isPubliclyVisibleNow(event)
  ) {
    throw new AppError(404, 'Event not found')
  }
  if (!(await isEventVisibleTo(event, viewer ?? undefined))) {
    throw new AppError(404, 'Event not found')
  }
  return event
}
