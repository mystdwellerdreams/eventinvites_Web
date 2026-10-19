import { useCallback, useEffect, useRef, useState } from 'react'
import { useDropdownPosition } from '../hooks/useDropdownPosition'
import './RichTextEditor.css'
import { useI18n } from '../i18n'

export const EMOJI_GROUPS: { label: string; items: string[] }[] = [
  { label: 'rte.groupSmileys', items: ['😀', '😄', '😁', '😊', '🙂', '😉', '😍', '🤩', '😎', '🤔', '😅', '😂', '🥳', '😴', '😢', '😭', '😤', '🤯', '🫡', '🤝'] },
  { label: 'rte.groupGestures', items: ['👍', '👎', '👌', '✌️', '🤞', '👏', '🙌', '💪', '🙏', '👋', '🤙', '✍️', '🫶', '👀', '🧠', '🦾'] },
  { label: 'rte.groupHearts', items: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💖', '💕', '💞', '💗', '❣️', '💔', '💯', '✨'] },
  { label: 'rte.groupEvents', items: ['🎉', '🎊', '🎈', '🎁', '🏆', '🥇', '⚽', '🎵', '🎤', '🍕', '🍰', '☕', '🍻', '🥂', '📸', '🎫', '📍', '🕐'] },
  { label: 'rte.groupSymbols', items: ['⭐', '🔥', '💥', '💡', '✅', '❌', '⚠️', 'ℹ️', '❗', '❓', '➕', '➖', '♻️', '🔗', '📌', '🧭'] },
]

const FONT_SIZES = [
  { value: '0.85em', label: 'rte.sizeSmall' },
  { value: '1em', label: 'rte.sizeNormal' },
  { value: '1.35em', label: 'rte.sizeLarge' },
  { value: '1.75em', label: 'rte.sizeHuge' },
]

export interface RichTextEditorProps {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  ariaLabel?: string
}

/**
 * A small contenteditable editor that emits a restricted subset of HTML:
 * bold, italic, underline, strikethrough, alignment, text colour, highlight,
 * font size, lists and links. The result is sanitized again on the server
 * before it is stored, so nothing here is trusted.
 */
export default function RichTextEditor({
  value,
  onChange,
  placeholder,
  ariaLabel = 'Event description',
}: RichTextEditorProps) {
  const { t } = useI18n()
  const ref = useRef<HTMLDivElement>(null)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const emojiRef = useRef<HTMLDivElement>(null)
  const emojiMenuRef = useRef<HTMLDivElement>(null)
  const savedRange = useRef<Range | null>(null)

  // Only reset the DOM when the incoming value differs from what is rendered,
  // otherwise every keystroke would reset the caret.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (el.innerHTML !== value) {
      el.innerHTML = value || ''
    }
  }, [value])

  useEffect(() => {
    if (!emojiOpen) return
    const onDocClick = (e: MouseEvent) => {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) {
        setEmojiOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [emojiOpen])

  const rememberSelection = useCallback(() => {
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0 && ref.current?.contains(sel.anchorNode)) {
      savedRange.current = sel.getRangeAt(0).cloneRange()
    }
  }, [])

  const restoreSelection = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    const sel = window.getSelection()
    if (!sel) return
    if (savedRange.current) {
      sel.removeAllRanges()
      sel.addRange(savedRange.current)
      return
    }
    // No saved range (e.g. an empty editor): collapse to the end.
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    sel.removeAllRanges()
    sel.addRange(range)
  }, [])

  const emit = useCallback(() => {
    if (ref.current) onChange(ref.current.innerHTML)
  }, [onChange])

  /** Runs a command, then syncs the DOM back into React state. */
  const exec = useCallback(
    (command: string, value?: string) => {
      restoreSelection()
      document.execCommand(command, false, value)
      rememberSelection()
      emit()
    },
    [emit, rememberSelection, restoreSelection]
  )

  const wrapSelection = useCallback(
    (tag: 'b' | 'i' | 'u' | 's') => {
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return
      const text = sel.toString()
      if (!text) return
      document.execCommand('insertHTML', false, `<${tag}>${escapeHtml(text)}</${tag}>`)
      emit()
    },
    [emit]
  )

  const insertEmoji = useCallback(
    (emoji: string) => {
      restoreSelection()
      document.execCommand('insertText', false, emoji)
      rememberSelection()
      emit()
      setEmojiOpen(false)
    },
    [emit, rememberSelection, restoreSelection]
  )

  const insertLink = useCallback(() => {
    const url = window.prompt(t('rte.linkPrompt'))
    if (!url || !/^https?:\/\//i.test(url)) return
    exec('createLink', url)
  }, [exec])

  const isActive = useCallback(
    (command: string) => {
      try {
        return document.queryCommandState(command)
      } catch {
        return false
      }
    },
    []
  )

  const [boldOn, setBoldOn] = useState(false)
  const [italicOn, setItalicOn] = useState(false)
  const [underlineOn, setUnderlineOn] = useState(false)
  const [strikeOn, setStrikeOn] = useState(false)
  const [align, setAlign] = useState('left')

  // Keeps the emoji menu inside the screen, flipping it
  // above the trigger when there is no room below.
  const emojiMenuStyle = useDropdownPosition(emojiOpen, emojiRef, emojiMenuRef)

  const refreshStates = () => {
    setBoldOn(isActive('bold'))
    setItalicOn(isActive('italic'))
    setUnderlineOn(isActive('underline'))
    setStrikeOn(isActive('strikeThrough'))
    const block = (document.queryCommandValue('formatBlock') || 'p').toLowerCase()
    const current = block === 'div' ? 'left' : block
    setAlign(['left', 'center', 'right', 'justify'].includes(current) ? current : 'left')
  }

  return (
    <div className="rte">
      <div className="rte-toolbar" role="toolbar" aria-label={`${ariaLabel} formatting`}>
        <div className="rte-group">
          <button
            type="button"
            className={`rte-btn ${boldOn ? 'is-on' : ''}`}
            title={t('rte.bold')}
            aria-label={t('rte.bold')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              wrapSelection('b')
              setBoldOn((v) => !v)
            }}
          >
            <strong>B</strong>
          </button>
          <button
            type="button"
            className={`rte-btn ${italicOn ? 'is-on' : ''}`}
            title={t('rte.italic')}
            aria-label={t('rte.italic')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              wrapSelection('i')
              setItalicOn((v) => !v)
            }}
          >
            <em>I</em>
          </button>
          <button
            type="button"
            className={`rte-btn ${underlineOn ? 'is-on' : ''}`}
            title={t('rte.underline')}
            aria-label={t('rte.underline')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              wrapSelection('u')
              setUnderlineOn((v) => !v)
            }}
          >
            <u>U</u>
          </button>
          <button
            type="button"
            className={`rte-btn ${strikeOn ? 'is-on' : ''}`}
            title={t('rte.strike')}
            aria-label={t('rte.strike')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              wrapSelection('s')
              setStrikeOn((v) => !v)
            }}
          >
            <s>S</s>
          </button>
        </div>

        <div className="rte-group">
          {(['left', 'center', 'right', 'justify'] as const).map((a) => (
            <button
              key={a}
              type="button"
              className={`rte-btn ${align === a ? 'is-on' : ''}`}
title={t(`rte.align${a.charAt(0).toUpperCase()}${a.slice(1)}`)}
                aria-label={t(`rte.align${a.charAt(0).toUpperCase()}${a.slice(1)}`)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                exec('justify' + a.charAt(0).toUpperCase() + a.slice(1))
                setAlign(a)
              }}
            >
              {{ left: '⇤', center: '⇔', right: '⇥', justify: '☰' }[a]}
            </button>
          ))}
        </div>

        <div className="rte-group">
          <select
            className="rte-select"
            defaultValue=""
            title={t('rte.fontSize')}
            aria-label={t('rte.fontSize')}
            onMouseDown={rememberSelection}
            onChange={(e) => {
              if (e.target.value) exec('fontSize', e.target.value)
              e.target.value = ''
            }}
          >
            <option value="">{t('rte.fontSize')}</option>
            {FONT_SIZES.map((s) => (
              <option key={s.value} value={s.value}>
                {t(s.label)}
              </option>
            ))}
          </select>

          <label className="rte-color" title={t('rte.textColour')} aria-label={t('rte.textColour')}>
            <span className="rte-color-label">A</span>
            <input
              type="color"
              defaultValue="#111827"
              onMouseDown={rememberSelection}
              onChange={(e) => exec('foreColor', e.target.value)}
            />
          </label>

          <label className="rte-color rte-color--hl" title={t('rte.highlight')} aria-label={t('rte.highlight')}>
            <span className="rte-color-label">▮</span>
            <input
              type="color"
              defaultValue="#fef08a"
              onMouseDown={rememberSelection}
              onChange={(e) => {
                restoreSelection()
                // execCommand has no highlight command; wrap the selection.
                const sel = window.getSelection()
                if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
                  const text = sel.toString()
                  document.execCommand(
                    'insertHTML',
                    false,
                    `<span style="background-color: ${e.target.value}">${escapeHtml(text)}</span>`
                  )
                } else {
                  document.execCommand('hiliteColor', false, e.target.value)
                }
                emit()
              }}
            />
          </label>
        </div>

        <div className="rte-group">
          <button
            type="button"
            className="rte-btn"
            title={t('rte.bulletList')}
            aria-label={t('rte.bulletList')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => exec('insertUnorderedList')}
          >
            •≡
          </button>
          <button
            type="button"
            className="rte-btn"
            title={t('rte.numberedList')}
            aria-label={t('rte.numberedList')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => exec('insertOrderedList')}
          >
            1≡
          </button>
          <button
            type="button"
            className="rte-btn"
            title={t('rte.insertLink')}
            aria-label={t('rte.insertLink')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={insertLink}
          >
            🔗
          </button>
        </div>

        <div className="rte-group rte-group--emoji" ref={emojiRef}>
          <button
            type="button"
            className={`rte-btn ${emojiOpen ? 'is-on' : ''}`}
            title={t('rte.insertEmoji')}
            aria-label={t('rte.insertEmoji')}
            aria-expanded={emojiOpen}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              rememberSelection()
              setEmojiOpen((o) => !o)
            }}
          >
            🙂
          </button>
          {emojiOpen && (
            <div
              className="rte-emoji-menu"
              role="menu"
              ref={emojiMenuRef}
              style={emojiMenuStyle}
            >
              {EMOJI_GROUPS.map((group) => (
                <div key={group.label} className="rte-emoji-group">
                  <p className="rte-emoji-group-label">{t(group.label)}</p>
                  <div className="rte-emoji-grid">
                    {group.items.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        className="rte-emoji"
                        role="menuitem"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => insertEmoji(emoji)}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rte-group rte-group--end">
          <button
            type="button"
            className="rte-btn"
            title={t('rte.clearFormatting')}
            aria-label={t('rte.clearFormatting')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              restoreSelection()
              document.execCommand('removeFormat')
              emit()
            }}
          >
            ⌫
          </button>
        </div>
      </div>

      <div
        ref={ref}
        className="rte-surface"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        data-placeholder={placeholder}
        onInput={emit}
        onBlur={() => {
          rememberSelection()
          refreshStates()
          emit()
        }}
        onKeyUp={refreshStates}
        onMouseUp={refreshStates}
        onPaste={(e) => {
          // Paste as plain text so foreign markup never enters the document.
          e.preventDefault()
          const text = e.clipboardData.getData('text/plain')
          document.execCommand('insertText', false, text)
          emit()
        }}
      />
    </div>
  )
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

