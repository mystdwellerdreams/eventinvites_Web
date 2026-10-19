import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '../context/AuthContext'
import { formatEventTimeRange, isEventLive, isRegistrationOpen } from '../utils/eventTime'
import { resolveAssetUrl } from '../utils/api'
import { useI18n } from '../i18n'
import type { Event } from '../types'
import './EventCard.css'

interface EventCardProps {
  event: Event
  onParticipate: () => void
  onJoinList: (eventId: string, listId: string) => Promise<void>
}

export default function EventCard({ event, onParticipate, onJoinList }: EventCardProps) {
  const { user } = useAuth()
  const { t, locale: BCP47 } = useI18n()
  const router = useRouter()
  const [showLists, setShowLists] = useState(false)

  const eventDate = new Date(event.dateTime)
  const mainList = event.lists?.find((l) => l.isDefault) || event.lists?.[0]
  const otherLists = event.lists?.filter((l) => l.id !== mainList?.id) || []

  // Recomputed each render rather than cached, so a long-lived tab flips to
  // "Happening now" without needing a refresh.
  const live = isEventLive(event)
  const locale = BCP47
  const open = isRegistrationOpen(event)

  const openEvent = () => router.push(`/events/${event.id}`)

  const handleJoin = async (listId: string) => {
    if (!user) {
      onParticipate()
      return
    }
    if (!listId) return
    setShowLists(false)
    await onJoinList(event.id, listId)
  }

  return (
    <div className="event-card" onClick={openEvent}>
      <div className="event-card-cover">
        {event.coverImage ? (
          <img src={resolveAssetUrl(event.coverImage)} alt={event.title} />
        ) : (
          <div className="event-card-cover-placeholder">📅</div>
        )}
        <div className="event-card-date">
          <span className="event-card-day">{eventDate.getDate()}</span>
          <span className="event-card-month">
            {eventDate.toLocaleDateString(locale, { month: 'short' })}
          </span>
        </div>
      </div>

      <div className="event-card-body">
        <div className="event-card-titlerow">
          <h3 className="event-card-title">{event.title}</h3>
          {live && <span className="badge badge-live">{t('card.happeningNow')}</span>}
        </div>
        <p className="event-card-desc">{event.shortDescription}</p>

        <div className="event-card-meta">
          <span>📍 {event.address || t('card.locationTba')}</span>
          <span>
            ⏰{' '}
            {eventDate.toLocaleDateString(locale, {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
            })}{' '}
            · {formatEventTimeRange(event, BCP47)}
          </span>
        </div>

        {event.price != null && event.price > 0 && (
          <div className="event-card-price">
            {event.currency ?? '$'}
            {event.price.toFixed(2)}
          </div>
        )}

        <div className="event-card-actions" onClick={(e) => e.stopPropagation()}>
          {user ? (
            event.userRegistration ? (
              <div className="registration-status">
                <span className="registered-for">{t('card.registeredFor')}</span>
                <span className="badge badge-success">
                  {event.userRegistration.list.name}
                </span>
              </div>
            ) : open ? (
              <>
                <div className="join-actions">
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => handleJoin(mainList?.id || '')}
                  >
                    {t('card.join')} {mainList?.name}
                  </button>
                  {otherLists.length > 0 && (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => setShowLists((s) => !s)}
                    >
                      {showLists ? t('card.close') : t('card.otherLists')}
                    </button>
                  )}
                </div>
                {showLists && otherLists.length > 0 && (
                  <div className="list-options">
                    {otherLists.map((list) => (
                      <button
                        key={list.id}
                        className="list-option"
                        onClick={() => handleJoin(list.id)}
                      >
                        {t('card.join')} {list.name}
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p className="event-card-closed">
                {live ? t('card.closedLive') : t('card.closed')}
              </p>
            )
          ) : open ? (
            <button className="btn btn-primary btn-sm" onClick={onParticipate}>
              {t('card.participate')}
            </button>
          ) : (
            <p className="event-card-closed">
              {live ? t('card.closedLive') : t('card.closed')}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}