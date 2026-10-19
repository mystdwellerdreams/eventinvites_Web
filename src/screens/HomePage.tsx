import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { useAuthModal } from '../context/AuthModalContext'
import EventCard from '../components/EventCard'
import BannerHero from '../components/BannerHero'
import { eventsAPI, apiErrorMessage } from '../utils/api'
import { useI18n } from '../i18n'
import type { Event } from '../types'
import './HomePage.css'

export interface HomeSectionProps {
  events: Event[]
  loading: boolean
  error: string
  onJoinList: (eventId: string, listId: string) => Promise<void>
  onParticipate: () => void
}

function UpcomingEventsSection({
  events,
  loading,
  error,
  onJoinList,
  onParticipate,
}: HomeSectionProps) {
  const { t } = useI18n()

  if (loading) {
    return (
      <div className="home-loading">
        <div className="spinner" />
        <p>{t('home.loading')}</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="empty-state">
        <p>{error}</p>
      </div>
    )
  }

  if (events.length === 0) {
    return (
      <div className="empty-state">
        <p>{t('home.empty')}</p>
      </div>
    )
  }

  return (
    <div className="events-grid">
      {events.map((event) => (
        <EventCard
          key={event.id}
          event={event}
          onParticipate={onParticipate}
          onJoinList={onJoinList}
        />
      ))}
    </div>
  )
}

export interface HomeSectionDefinition {
  id: string
  /** HTML anchor id for in-page links; defaults to the section id. */
  anchor?: string
  /** Translation keys, so the heading follows the selected language. */
  titleKey: string
  descriptionKey?: string
  component: (props: HomeSectionProps) => JSX.Element
}

/**
 * The home page is a list of sections. Only the upcoming-events section exists
 * for now; adding another one is a single entry in this registry.
 */
export const HOME_SECTIONS: HomeSectionDefinition[] = [
  {
    id: 'upcoming-events',
    anchor: 'events',
    titleKey: 'home.upcoming',
    descriptionKey: 'home.sectionUpcomingDesc',
    component: UpcomingEventsSection,
  },
]

export default function HomePage() {
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const { user, loading: authLoading } = useAuth()
  const { open } = useAuthModal()
  const { t } = useI18n()

  const loadEvents = async () => {
    try {
      const response = await eventsAPI.getUpcoming()
      setEvents(response.data.events)
      setError('')
    } catch (err) {
      setError(apiErrorMessage(err, t('home.loadFailed')))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadEvents()
    // Reloads when the viewer signs in or out so join buttons stay in sync.
  }, [user])

  const handleParticipate = () => open('login')

  const handleJoinList = async (eventId: string, listId: string) => {
    if (!user) {
      open('login')
      return
    }
    try {
      await eventsAPI.register(eventId, listId)
      await loadEvents()
    } catch (err) {
      window.alert(apiErrorMessage(err, t('home.joinFailed')))
    }
  }

  return (
    <div className="home-page">
      <BannerHero />

      {HOME_SECTIONS.map((section) => {
        const Section = section.component
        return (
          <section key={section.id} id={section.anchor ?? section.id} className="events-section">
            <h2 className="section-title">{t(section.titleKey)}</h2>
            {section.descriptionKey && (
              <p className="section-description">{t(section.descriptionKey)}</p>
            )}
            {!authLoading && (
              <Section
                events={events}
                loading={loading}
                error={error}
                onJoinList={handleJoinList}
                onParticipate={handleParticipate}
              />
            )}
          </section>
        )
      })}
    </div>
  )
}
