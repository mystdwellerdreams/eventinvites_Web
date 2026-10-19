import { useEffect, useMemo, useRef, useState } from 'react'
import { commentsAPI, apiErrorMessage } from '../utils/api'
import { useAuth } from '../context/AuthContext'
import { useAuthModal } from '../context/AuthModalContext'
import { isGuest } from '../utils/roles'
import { useI18n } from '../i18n'
import type { Comment, CommentBlock, ElementType, Event } from '../types'
import UserAvatar from './UserAvatar'
import './EventComments.css'

/** Text quoted from the page, or from another comment, waiting in the composer. */
interface ComposerQuote {
  text: string
  /** Set when the quote comes from a comment. */
  commentId?: string
  authorName?: string
  /** Set when the quote comes from an element of the page. */
  sourceKey?: ElementType
}

interface EventCommentsProps {
  event: Event
  /** Set by the event page when a page element's quote button is used. */
  pageQuote?: { source: ElementType; text: string } | null
  onPageQuoteConsumed?: () => void
}

interface CommentNode {
  comment: Comment
  children: CommentNode[]
}

/** Pinned first, everything else in the order it was written. */
function sortComments(list: Comment[]): Comment[] {
  return [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  })
}

/** Turns the flat list into reply trees. A reply whose parent is missing
 *  becomes a root, so nothing disappears from view. */
function buildThreads(comments: Comment[]): CommentNode[] {
  const present = new Set(comments.map((c) => c.id))
  const childrenOf = new Map<string | null, Comment[]>()
  for (const comment of comments) {
    const parent = comment.parentId && present.has(comment.parentId) ? comment.parentId : null
    const list = childrenOf.get(parent) ?? []
    list.push(comment)
    childrenOf.set(parent, list)
  }
  const build = (parentId: string | null): CommentNode[] =>
    (childrenOf.get(parentId) ?? []).map((comment) => ({
      comment,
      children: build(comment.id),
    }))
  return build(null)
}

/** Which special roles a commenter holds on this event. An administrator who
 *  is also the host keeps both badges. */
function badgesFor(comment: Comment, event: Event): string[] {
  const badges: string[] = []
  if (comment.author.role === 'ADMIN') badges.push('admin')
  const hosts = event.hosts?.length ? event.hosts : event.host ? [event.host] : []
  if (hosts.some((h) => h.id === comment.authorId)) badges.push('host')
  if (event.organizer && event.organizer.id === comment.authorId) badges.push('organizer')
  return badges
}

function timeAgo(iso: string, locale: string): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const divisions: { amount: number; unit: Intl.RelativeTimeFormatUnit }[] = [
    { amount: 60, unit: 'second' },
    { amount: 60, unit: 'minute' },
    { amount: 24, unit: 'hour' },
    { amount: 7, unit: 'day' },
    { amount: 4.34524, unit: 'week' },
    { amount: 12, unit: 'month' },
    { amount: Number.POSITIVE_INFINITY, unit: 'year' },
  ]
  let duration = (Date.now() - new Date(iso).getTime()) / 1000
  if (duration < 5) return rtf.format(0, 'second')
  for (const division of divisions) {
    if (Math.abs(duration) < division.amount) {
      return rtf.format(-Math.round(duration), division.unit)
    }
    duration /= division.amount
  }
  return rtf.format(-Math.round(duration), 'year')
}

const MAX_DEPTH = 3

interface CommentItemProps {
  node: CommentNode
  depth: number
  event: Event
  isAdmin: boolean
  onReply: (comment: Comment) => void
  onQuote: (comment: Comment) => void
  onPin: (comment: Comment) => void
  onBan: (comment: Comment) => void
  onBlock: (comment: Comment) => void
  onDelete: (comment: Comment) => void
  locale: string
  /** Set for the comment named in the page's URL hash, once revealed. */
  highlighted?: boolean
}

function CommentItem({
  node,
  depth,
  event,
  isAdmin,
  onReply,
  onQuote,
  onPin,
  onBan,
  onBlock,
  onDelete,
  locale,
  highlighted,
}: CommentItemProps) {
  const { t } = useI18n()
  const { user } = useAuth()
  const comment = node.comment
  const badges = badgesFor(comment, event)
  // An administrator is shown by the badge alone: no avatar ring and no name
  // border, even when they are also the host or organizer of the event. The
  // ring and the border belong to a host or organizer who is not one.
  const ring = badges.includes('admin') ? undefined : badges[0]
  const isOwn = user?.id === comment.authorId
  const canDelete = isOwn || isAdmin
  const removed = Boolean(comment.deletedAt)

  const classes = ['ec-comment']
  if (comment.pinned) classes.push('is-pinned')
  if (comment.banned) classes.push('is-banned')
  if (removed) classes.push('is-deleted')
  if (highlighted) classes.push('is-highlighted')

  return (
    <li className="ec-thread-item">
      {/* The id is the deep link the activity log points at. */}
      <article id={`comment-${comment.id}`} className={classes.join(' ')}>
        <div className="ec-comment-main">
          <span className={`ec-avatar ring-${ring ?? 'none'}`}>
            <UserAvatar name={comment.author.name} avatar={comment.author.avatar} size={36} />
          </span>
          <div className="ec-comment-body">
            <div className="ec-comment-head">
              <span className={`ec-name is-${ring ?? 'plain'}`}>{comment.author.name}</span>
              {badges.map((badge) => (
                <span key={badge} className={`ec-badge is-${badge}`}>
                  {t(`comments.badge.${badge}`)}
                </span>
              ))}
              {comment.pinned && (
                <span className="ec-pin-flag" title={t('comments.pinned')}>
                  {t('comments.pinned')}
                </span>
              )}
              {comment.banned && <span className="ec-banned-flag">{t('comments.banned')}</span>}
              <time
                className="ec-time"
                dateTime={comment.createdAt}
                title={new Date(comment.createdAt).toLocaleString(locale)}
              >
                {timeAgo(comment.createdAt, locale)}
              </time>
            </div>

            {comment.quote && (
              <blockquote className="ec-quote">
                <span className="ec-quote-author">
                  {t('comments.quotingComment', { name: comment.quote.authorName })}
                </span>
                <span className="ec-quote-text">{comment.quote.snippet}</span>
              </blockquote>
            )}
            {comment.quoteText && !comment.quote && (
              <blockquote className="ec-quote is-page">
                <span className="ec-quote-text">{comment.quoteText}</span>
              </blockquote>
            )}

            {removed ? (
              <p className="ec-removed">{t('comments.removed')}</p>
            ) : (
              <p className="ec-text">{comment.body}</p>
            )}

            {!removed && (
              <div className="ec-tools">
                <button type="button" className="ec-tool" onClick={() => onReply(comment)}>
                  {t('comments.reply')}
                </button>
                <button type="button" className="ec-tool" onClick={() => onQuote(comment)}>
                  {t('comments.quote')}
                </button>
                {canDelete && (
                  <button type="button" className="ec-tool" onClick={() => onDelete(comment)}>
                    {t('comments.delete')}
                  </button>
                )}
                {isAdmin && (
                  <>
                    <button type="button" className="ec-tool" onClick={() => onPin(comment)}>
                      {comment.pinned ? t('comments.unpin') : t('comments.pin')}
                    </button>
                    <button type="button" className="ec-tool" onClick={() => onBan(comment)}>
                      {comment.banned ? t('comments.unban') : t('comments.ban')}
                    </button>
                    {!isOwn && (
                      <button type="button" className="ec-tool" onClick={() => onBlock(comment)}>
                        {t('comments.blockAuthor')}
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </article>

      {node.children.length > 0 && (
        <ul className={`ec-thread ec-depth-${Math.min(depth + 1, MAX_DEPTH)}`}>
          {node.children.map((child) => (
            <CommentItem
              key={child.comment.id}
              node={child}
              depth={depth + 1}
              event={event}
              isAdmin={isAdmin}
              onReply={onReply}
              onQuote={onQuote}
              onPin={onPin}
              onBan={onBan}
              onBlock={onBlock}
              onDelete={onDelete}
              locale={locale}
              highlighted={highlighted}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

export default function EventComments({
  event,
  pageQuote,
  onPageQuoteConsumed,
}: EventCommentsProps) {
  const { t, locale, plural } = useI18n()
  const { user } = useAuth()
  const { open } = useAuthModal()

  const [comments, setComments] = useState<Comment[]>([])
  const [blocks, setBlocks] = useState<CommentBlock[]>([])
  const [viewerBlocked, setViewerBlocked] = useState(false)
  const [viewerIsAdmin, setViewerIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [body, setBody] = useState('')
  const [replyTo, setReplyTo] = useState<Comment | null>(null)
  const [quote, setQuote] = useState<ComposerQuote | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [showBlocks, setShowBlocks] = useState(false)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  // The comment named in the URL hash, lit up once its thread is on screen.
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const revealedHash = useRef(false)

  const isAdmin = viewerIsAdmin
  const guest = isGuest(user)

  useEffect(() => {
    let active = true
    setLoading(true)
    commentsAPI
      .list(event.id)
      .then((response) => {
        if (!active) return
        setComments(sortComments(response.data.comments))
        setBlocks(response.data.blocks)
        setViewerBlocked(response.data.viewerBlocked)
        setViewerIsAdmin(response.data.viewerIsAdmin)
        setLoadError('')
      })
      .catch((err) => {
        if (active) setLoadError(apiErrorMessage(err, t('comments.loadFailed')))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
    // Only the event itself matters: a language switch re-renders the loaded
    // comments in place instead of re-fetching them.
  }, [event.id])

  // A quote taken from a page element arrives through the event page.
  useEffect(() => {
    if (!pageQuote) return
    setQuote({ text: pageQuote.text, sourceKey: pageQuote.source })
    setReplyTo(null)
    onPageQuoteConsumed?.()
  }, [pageQuote, onPageQuoteConsumed])

  /**
   * A comment named in the URL hash — the activity log links straight to
   * one — is scrolled to and lit up once its thread has loaded. The hash
   * outlives the highlight, so the link can be shared and revisited.
   */
  useEffect(() => {
    if (loading || revealedHash.current) return
    const match = /^#comment-(.+)$/.exec(window.location.hash)
    if (!match) return
    revealedHash.current = true
    const id = decodeURIComponent(match[1])
    if (!comments.some((c) => c.id === id)) return
    setHighlightId(id)
    window.requestAnimationFrame(() => {
      document
        .getElementById('comment-' + id)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
    window.setTimeout(() => setHighlightId(null), 4000)
  }, [loading, comments])

  const threads = useMemo(() => buildThreads(comments), [comments])
  const topCount = comments.filter((c) => !c.deletedAt).length

  const focusComposer = () => {
    composerRef.current?.focus()
    composerRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  const handleReply = (comment: Comment) => {
    setReplyTo(comment)
    setQuote(null)
    focusComposer()
  }

  const handleQuote = (comment: Comment) => {
    setQuote({
      text: comment.body.slice(0, 400),
      commentId: comment.id,
      authorName: comment.author.name,
    })
    setReplyTo(null)
    focusComposer()
  }

  const replaceComment = (updated: Comment) => {
    setComments((prev) =>
      sortComments(
        prev.map((item) => {
          if (item.id === updated.id) return updated
          // Pinning one comment unpins the previous one.
          if (updated.pinned && item.pinned) return { ...item, pinned: false }
          return item
        })
      )
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const text = body.trim()
    if (!text) return
    setSubmitting(true)
    setSubmitError('')
    try {
      const { data } = await commentsAPI.create(event.id, {
        body: text,
        parentId: replyTo?.id,
        quoteCommentId: quote?.commentId,
        quoteText: quote && !quote.commentId ? quote.text : undefined,
      })
      setComments((prev) => sortComments([...prev, data.comment]))
      setBody('')
      setReplyTo(null)
      setQuote(null)
    } catch (err) {
      setSubmitError(apiErrorMessage(err, t('comments.postFailed')))
    } finally {
      setSubmitting(false)
    }
  }

  const handlePin = async (comment: Comment) => {
    try {
      const { data } = await commentsAPI.pin(comment.id)
      replaceComment(data.comment)
    } catch (err) {
      window.alert(apiErrorMessage(err, t('comments.actionFailed')))
    }
  }

  const handleBan = async (comment: Comment) => {
    try {
      const { data } = await commentsAPI.ban(comment.id)
      replaceComment(data.comment)
    } catch (err) {
      window.alert(apiErrorMessage(err, t('comments.actionFailed')))
    }
  }

  const handleDelete = async (comment: Comment) => {
    if (!window.confirm(t('comments.deleteConfirm'))) return
    try {
      const { data } = await commentsAPI.remove(comment.id)
      replaceComment(data.comment)
    } catch (err) {
      window.alert(apiErrorMessage(err, t('comments.actionFailed')))
    }
  }

  const handleBlock = async (comment: Comment) => {
    if (!window.confirm(t('comments.blockConfirm', { name: comment.author.name }))) return
    try {
      const { data } = await commentsAPI.blockUser(event.id, { userId: comment.authorId })
      setBlocks((prev) => [data.block, ...prev.filter((b) => b.user.id !== data.block.user.id)])
    } catch (err) {
      window.alert(apiErrorMessage(err, t('comments.blockFailed')))
    }
  }

  const handleUnblock = async (userId: string) => {
    try {
      await commentsAPI.unblockUser(event.id, userId)
      setBlocks((prev) => prev.filter((b) => b.user.id !== userId))
    } catch (err) {
      window.alert(apiErrorMessage(err, t('comments.blockFailed')))
    }
  }

  const composer = () => {
    if (viewerBlocked) {
      return <p className="ec-notice is-warning">{t('comments.blockedNotice')}</p>
    }
    if (!user) {
      return (
        <div className="ec-notice">
          <p>{t('comments.signInNotice')}</p>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => open('login')}>
            {t('comments.signIn')}
          </button>
        </div>
      )
    }
    if (guest) {
      return <p className="ec-notice is-warning">{t('comments.guestNotice')}</p>
    }
    return (
      <form className="ec-composer" onSubmit={handleSubmit}>
        {replyTo && (
          <div className="ec-chip is-reply">
            <span>
              {t('comments.replyingTo', { name: replyTo.author.name })}
            </span>
            <button
              type="button"
              className="ec-chip-remove"
              onClick={() => setReplyTo(null)}
              aria-label={t('comments.cancelReply')}
            >
              ×
            </button>
          </div>
        )}
        {quote && (
          <div className="ec-chip is-quote">
            <span className="ec-chip-label">
              {quote.commentId
                ? t('comments.quotingComment', { name: quote.authorName ?? '' })
                : t('comments.quotingPage', {
                    source: t(`comments.source.${quote.sourceKey ?? 'description'}`),
                  })}
            </span>
            <span className="ec-chip-text">{quote.text}</span>
            <button
              type="button"
              className="ec-chip-remove"
              onClick={() => setQuote(null)}
              aria-label={t('comments.removeQuote')}
            >
              ×
            </button>
          </div>
        )}
        <textarea
          ref={composerRef}
          className="ec-textarea"
          value={body}
          maxLength={2000}
          rows={3}
          placeholder={t('comments.placeholder')}
          onChange={(e) => setBody(e.target.value)}
        />
        {submitError && <p className="ec-form-error">{submitError}</p>}
        <div className="ec-composer-footer">
          <span className="ec-hint">{t('comments.quoteHint')}</span>
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={submitting || !body.trim()}
          >
            {submitting ? t('comments.posting') : t('comments.post')}
          </button>
        </div>
      </form>
    )
  }

  return (
    <section className="ec-section" id="discussion">
      <header className="ec-header">
        <h2 className="ec-title">{t('comments.title')}</h2>
        <span className="ec-count">
          {plural(topCount, t('comments.countOne'), t('comments.countFew'), t('comments.countMany'))}
        </span>
      </header>

      {composer()}

      {isAdmin && (
        <div className="ec-blocks-panel">
          <button
            type="button"
            className="ec-blocks-toggle"
            onClick={() => setShowBlocks((s) => !s)}
          >
            {t('comments.blockedUsers')} ({blocks.length}) {showBlocks ? '▴' : '▾'}
          </button>
          {showBlocks && (
            <div className="ec-blocks-list">
              {blocks.length === 0 && <p className="ec-blocks-empty">{t('comments.noBlocks')}</p>}
              {blocks.map((block) => (
                <div key={block.id} className="ec-block-row">
                  <UserAvatar name={block.user.name} avatar={block.user.avatar} size={24} />
                  <span className="ec-block-name">{block.user.name}</span>
                  {block.reason && <span className="ec-block-reason">{block.reason}</span>}
                  <button
                    type="button"
                    className="ec-tool"
                    onClick={() => handleUnblock(block.user.id)}
                  >
                    {t('comments.unblock')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {loading && (
        <div className="ec-loading">
          <div className="spinner" />
          <p>{t('comments.loading')}</p>
        </div>
      )}

      {!loading && loadError && <p className="ec-notice is-warning">{loadError}</p>}

      {!loading && !loadError && threads.length === 0 && (
        <p className="ec-empty">{t('comments.empty')}</p>
      )}

      {!loading && !loadError && threads.length > 0 && (
        <ul className="ec-list">
          {threads.map((node) => (
            <CommentItem
              key={node.comment.id}
              node={node}
              depth={0}
              event={event}
              isAdmin={isAdmin}
              onReply={handleReply}
              onQuote={handleQuote}
              onPin={handlePin}
              onBan={handleBan}
              onBlock={handleBlock}
              onDelete={handleDelete}
              locale={locale}
              highlighted={highlightId === node.comment.id}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
