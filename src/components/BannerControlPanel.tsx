import { useCallback, useEffect, useState } from 'react'
import { bannersAPI, apiErrorMessage } from '../utils/api'
import { useI18n } from '../i18n'
import UserAvatar from './UserAvatar'
import type {
  BannerAd,
  BannerCounterStats,
  BannerPollVoter,
} from '../types'
import './BannerControlPanel.css'

/** A poll banner on the home page, with everyone who voted in it. */
interface PollBoard {
  ad: BannerAd
  slot: string
  voters: BannerPollVoter[]
}

interface PollOption {
  id: string
  text: string
}

/**
 * The banner control panel of the Status tab. It appears when the home page
 * shows a counter or a poll banner: a counter's current value can be changed
 * here and its copies read off, a poll's votes are broken down per option.
 */
export default function BannerControlPanel() {
  const { t, locale } = useI18n()
  const [counters, setCounters] = useState<BannerCounterStats[]>([])
  const [polls, setPolls] = useState<PollBoard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const list = await bannersAPI.list()
      const slots = list.data.slots ?? []

      const counterAds: { ad: BannerAd; slot: string }[] = []
      const pollAds: { ad: BannerAd; slot: string }[] = []
      for (const slot of slots) {
        for (const ad of slot.ads ?? []) {
          if (ad.type === 'COUNTER') counterAds.push({ ad, slot: slot.slot })
          if (ad.type === 'POLL') pollAds.push({ ad, slot: slot.slot })
        }
      }

      const [counterStats, pollBoards] = await Promise.all([
        Promise.all(counterAds.map(({ ad }) => bannersAPI.counterStats(ad.id).then((r) => r.data))),
        Promise.all(
          pollAds.map(async ({ ad, slot }) => {
            const votes = await bannersAPI.voters(ad.id)
            return { ad, slot, voters: votes.data.voters ?? [] }
          })
        ),
      ])

      setCounters(counterStats)
      setPolls(pollBoards)
      setDrafts(Object.fromEntries(counterStats.map((stats) => [stats.ad.id, String(stats.ad.current)])))
    } catch (err) {
      setError(apiErrorMessage(err, t('banners.panel.loadFailed')))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const saveCurrent = async (stats: BannerCounterStats) => {
    const draft = drafts[stats.ad.id]
    const next = Number(draft)
    if (!Number.isFinite(next) || next < 0) return
    setSavingId(stats.ad.id)
    try {
      // The stored config already holds everything the counter needs; only
      // the current value changes, and the existing update validates it.
      const ad = (await bannersAPI.get(stats.ad.id)).data.ad
      await bannersAPI.update(stats.ad.id, { config: { ...ad.config, current: Math.round(next) } })
      setSavedId(stats.ad.id)
      window.setTimeout(() => setSavedId((id) => (id === stats.ad.id ? null : id)), 2000)
      await load()
    } catch (err) {
      window.alert(apiErrorMessage(err, t('banners.panel.saveFailed')))
    } finally {
      setSavingId(null)
    }
  }

  const optionsOf = (ad: BannerAd): PollOption[] => {
    const config = ad.config as { options?: PollOption[] }
    return config.options ?? []
  }

  const votersByOption = (voters: BannerPollVoter[]): Record<string, BannerPollVoter[]> => {
    const byOption: Record<string, BannerPollVoter[]> = {}
    for (const voter of voters) {
      const list = byOption[voter.optionId] ?? []
      list.push(voter)
      byOption[voter.optionId] = list
    }
    return byOption
  }

  if (loading) {
    return (
      <section className="bcp-section">
        <div className="bcp-loading">
          <div className="spinner" />
          <p>{t('banners.panel.loading')}</p>
        </div>
      </section>
    )
  }

  // Nothing to control: the home page shows neither a counter nor a poll.
  if (counters.length === 0 && polls.length === 0) return null

  return (
    <section className="bcp-section">
      <header className="bcp-header">
        <div>
          <h3>{t('banners.panel.title')}</h3>
          <p className="admin-hint">{t('banners.panel.hint')}</p>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void load()}>
          {t('banners.panel.refresh')}
        </button>
      </header>

      {error && <p className="admin-muted">{error}</p>}

      {counters.map((stats) => {
        const byReference = new Map<string, BannerCounterStats['copies']>()
        for (const copy of stats.copies) {
          const list = byReference.get(copy.reference) ?? []
          list.push(copy)
          byReference.set(copy.reference, list)
        }
        const groups = [...byReference.entries()].sort(
          (a, b) => b[1].reduce((sum, c) => sum + c.count, 0) - a[1].reduce((sum, c) => sum + c.count, 0)
        )
        const totalCopies = stats.copies.reduce((sum, c) => sum + c.count, 0)

        return (
          <article key={stats.ad.id} className="bcp-card">
            <header className="bcp-card-head">
              <h4>
                {stats.ad.slot ? `${t(`banners.slot${stats.ad.slot.charAt(0)}${stats.ad.slot.slice(1).toLowerCase()}`)} · ` : ''}
                {stats.ad.label || t('banners.panel.counterFallback')}
              </h4>
              <span className="bcp-total">
                {t('banners.panel.copiesTotal', { n: totalCopies })}
              </span>
            </header>

            <div className="bcp-current">
              <label htmlFor={`bcp-current-${stats.ad.id}`}>{t('banners.panel.currentValue')}</label>
              <input
                id={`bcp-current-${stats.ad.id}`}
                type="number"
                min={0}
                max={1000000000}
                value={drafts[stats.ad.id] ?? ''}
                onChange={(e) => setDrafts((d) => ({ ...d, [stats.ad.id]: e.target.value }))}
              />
              <span className="bcp-target">
                / {stats.ad.target}
                {stats.ad.currency}
              </span>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={savingId === stats.ad.id}
                onClick={() => void saveCurrent(stats)}
              >
                {savingId === stats.ad.id ? t('banners.panel.saving') : t('banners.panel.save')}
              </button>
              {savedId === stats.ad.id && (
                <span className="bcp-saved">{t('banners.panel.saved')}</span>
              )}
            </div>

            {groups.length === 0 ? (
              <p className="bcp-empty">{t('banners.panel.noCopies')}</p>
            ) : (
              <div className="bcp-references">
                {groups.map(([reference, copies]) => (
                  <div key={reference} className="bcp-reference">
                    <div className="bcp-reference-head">
                      <span className="bcp-reference-code">@{reference}</span>
                      <span className="bcp-reference-count">
                        {t('banners.panel.referenceCopies', {
                          n: copies.reduce((sum, c) => sum + c.count, 0),
                        })}
                      </span>
                    </div>
                    <ul className="bcp-people">
                      {copies.map((copy) => (
                        <li key={copy.userId} className="bcp-person">
                          <UserAvatar name={copy.name} avatar={copy.avatar} size={24} />
                          <span className="bcp-person-name">{copy.name}</span>
                          <span className="bcp-person-contact" title={copy.email || copy.phone || undefined}>
                            {copy.email || copy.phone || ''}
                          </span>
                          {copy.count > 1 && (
                            <span className="bcp-person-count">×{copy.count}</span>
                          )}
                          <time
                            className="bcp-person-time"
                            dateTime={copy.updatedAt}
                            title={new Date(copy.updatedAt).toLocaleString(locale)}
                          >
                            {new Date(copy.updatedAt).toLocaleString(locale)}
                          </time>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </article>
        )
      })}

      {polls.map((poll) => {
        const options = optionsOf(poll.ad)
        const byOption = votersByOption(poll.voters)
        const config = poll.ad.config as { question?: string }
        const totalVotes = poll.voters.length

        return (
          <article key={poll.ad.id} className="bcp-card">
            <header className="bcp-card-head">
              <h4>
                {poll.slot ? `${t(`banners.slot${poll.slot.charAt(0)}${poll.slot.slice(1).toLowerCase()}`)} · ` : ''}
                {config.question || t('banners.panel.pollFallback')}
              </h4>
              <span className="bcp-total">
                {t('banners.panel.votesTotal', { n: totalVotes })}
              </span>
            </header>

            {totalVotes === 0 ? (
              <p className="bcp-empty">{t('banners.panel.noVotes')}</p>
            ) : (
              <div className="bcp-options">
                {options.map((option) => {
                  const voters = byOption[option.id] ?? []
                  if (voters.length === 0) return null
                  return (
                    <div key={option.id} className="bcp-option">
                      <div className="bcp-option-head">
                        <span className="bcp-option-text">{option.text}</span>
                        <span className="bcp-option-count">
                          {t('banners.panel.optionVotes', { n: voters.length })}
                        </span>
                      </div>
                      <ul className="bcp-people">
                        {voters.map((voter) => (
                          <li key={voter.userId} className="bcp-person">
                            <span className="bcp-person-name">{voter.name}</span>
                            <span className="bcp-person-contact" title={voter.email || voter.phone || undefined}>
                              {voter.email || voter.phone || ''}
                            </span>
                            {voter.createdAt && (
                              <time
                                className="bcp-person-time"
                                dateTime={voter.createdAt}
                                title={new Date(voter.createdAt).toLocaleString(locale)}
                              >
                                {new Date(voter.createdAt).toLocaleString(locale)}
                              </time>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                })}
              </div>
            )}
          </article>
        )
      })}
    </section>
  )
}
