import './TagCloud.css'

interface TagCloudTag {
  id: string
  name: string
  _count?: { users?: number }
}

interface TagCloudProps {
  tags: TagCloudTag[]
  /** Tag id currently under management. */
  selectedId?: string | null
  onSelect: (tagId: string) => void
  /** Ids rendered as "on", for the per-user assignment menu. */
  activeIds?: string[]
  /** Tag awaiting a second click to confirm deletion. */
  pendingDeleteId?: string | null
  size?: 'sm' | 'md'
  emptyHint?: string
}

/**
 * A weighted cloud of tags. Clicking one selects it; the menu above the cloud
 * then acts on that selection. Pill size scales with how many users hold the
 * tag, so the busiest tags read first.
 */
export default function TagCloud({
  tags,
  selectedId,
  onSelect,
  activeIds,
  pendingDeleteId,
  size = 'md',
  emptyHint = 'No tags yet. Use Add to create one.',
}: TagCloudProps) {
  if (tags.length === 0) {
    return <p className="tag-cloud-empty">{emptyHint}</p>
  }

  const counts = tags.map((t) => t._count?.users ?? 0)
  const max = Math.max(1, ...counts)
  const min = Math.min(...counts, 0)

  // Three weight steps keeps the cloud legible instead of a wall of sizes.
  const weight = (count: number) => {
    if (count === 0) return 0
    const span = Math.max(1, max - min)
    return Math.min(2, Math.round(((count - min) / span) * 2))
  }

  return (
    <div className={`tag-cloud tag-cloud-${size}`} role="list">
      {tags.map((tag) => {
        const w = weight(tag._count?.users ?? 0)
        const isSelected = selectedId === tag.id
        const isActive = activeIds?.includes(tag.id)
        const classes = [
          'tag-cloud-pill',
          `weight-${w}`,
          isSelected ? 'is-selected' : '',
          isActive ? 'is-active' : '',
          pendingDeleteId === tag.id ? 'is-pending-delete' : '',
        ]
          .filter(Boolean)
          .join(' ')

        return (
          <button
            key={tag.id}
            type="button"
            role="listitem"
            className={classes}
            onClick={() => onSelect(tag.id)}
            aria-pressed={isSelected || isActive}
            title={`${tag.name} · ${tag._count?.users ?? 0} user${
              (tag._count?.users ?? 0) === 1 ? '' : 's'
            }`}
          >
            {tag.name}
            {typeof tag._count?.users === 'number' && <span className="tag-cloud-count">{tag._count.users}</span>}
          </button>
        )
      })}
    </div>
  )
}
