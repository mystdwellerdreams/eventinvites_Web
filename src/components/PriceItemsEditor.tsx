import { CURRENCIES, CURRENCY_LABELS } from '../types'
import type { Currency, EventPriceItem } from '../types'
import './PriceItemsEditor.css'
import { useI18n } from '../i18n'

interface PriceItemsEditorProps {
  items: EventPriceItem[]
  onChange: (items: EventPriceItem[]) => void
  /** Fallback for items that have not chosen a currency of their own. */
  currency?: Currency
}

const blank = (currency: Currency): EventPriceItem => ({ name: '', price: 0, currency })

/**
 * Additional charges below the event's main price, for example a free ticket
 * alongside a flat organisation fee. Each row picks its own currency.
 */
export default function PriceItemsEditor({
  items,
  onChange,
  currency = '$',
}: PriceItemsEditorProps) {
  const { t } = useI18n()
  const itemCurrency = (item: EventPriceItem): Currency => item.currency ?? currency

  const update = (index: number, patch: Partial<EventPriceItem>) => {
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  const remove = (index: number) => {
    onChange(items.filter((_, i) => i !== index))
  }

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta
    if (target < 0 || target >= items.length) return
    const next = [...items]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }

  // Only meaningful while the entries share one currency; otherwise adding a
  // total across mixed currencies would be meaningless.
  const shared = new Set(items.map(itemCurrency)).size <= 1
  const total = shared ? items.reduce((sum, item) => sum + (Number(item.price) || 0), 0) : null

  return (
    <div className="price-items">
      {items.length === 0 ? (
        <p className="price-items-empty">{t('editor.priceItemsEmpty')}</p>
      ) : (
        <ul className="price-items-list">
          {items.map((item, index) => (
            <li key={index} className="price-items-row">
              <div className="price-items-field price-items-field--name">
                <label htmlFor={`price-item-name-${index}`}>{t('editor.priceItemName')}</label>
                <input
                  id={`price-item-name-${index}`}
                  value={item.name}
                  maxLength={80}
                  placeholder={t('editor.priceItemNamePlaceholder')}
                  onChange={(e) => update(index, { name: e.target.value })}
                />
              </div>
              <div className="price-items-field price-items-field--amount">
                <label htmlFor={`price-item-price-${index}`}>{t('editor.priceItemAmount')}</label>
                <div className="price-items-amount">
                  <span aria-hidden="true">{itemCurrency(item)}</span>
                  <input
                    id={`price-item-price-${index}`}
                    type="number"
                    min="0"
                    step="0.01"
                    value={Number.isFinite(item.price) ? item.price : 0}
                    onChange={(e) => update(index, { price: Number(e.target.value) })}
                  />
                </div>
              </div>
              <div className="price-items-field price-items-field--currency">
                <label htmlFor={`price-item-currency-${index}`}>{t('editor.currency')}</label>
                <select
                  id={`price-item-currency-${index}`}
                  value={itemCurrency(item)}
                  onChange={(e) => update(index, { currency: e.target.value as Currency })}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {CURRENCY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="price-items-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  aria-label={t('editor.priceItemMoveUp', { name: item.name || t('host.itemFallback') })}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => move(index, 1)}
                  disabled={index === items.length - 1}
                  aria-label={t('editor.priceItemMoveDown', { name: item.name || t('host.itemFallback') })}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() => remove(index)}
                  aria-label={t('editor.priceItemRemove', { name: item.name || t('host.itemFallback') })}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="price-items-footer">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => onChange([...items, blank(currency)])}
        >
          {t('editor.priceItemAdd')}
        </button>
        {items.length > 0 && (
          <span className="price-items-total">
            {total !== null ? (
              <>
                {t('editor.priceItemTotal', { total: `${currency}${total.toFixed(2)}` })}
              </>
            ) : (
              t('editor.priceItemMixed')
            )}
          </span>
        )}
      </div>
    </div>
  )
}

