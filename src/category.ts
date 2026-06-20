import type { Activity, ActivityType, EventMetadata, Side } from './api'

export type CategoryOption = { value: string; label: string }
export type CategoryMap = Record<string, CategoryOption | null>

export const DEFAULT_CATEGORY = 'weather'

const CATEGORY_LABELS: Record<string, string> = {
  weather: 'Weather',
  politics: 'Politics',
  sports: 'Sports',
  crypto: 'Crypto',
  economy: 'Economy',
  finance: 'Finance',
  business: 'Business',
  culture: 'Culture',
  entertainment: 'Entertainment',
  technology: 'Technology',
  science: 'Science',
  news: 'News',
  world: 'World',
  'us-current-affairs': 'US Current Affairs',
  'international-affairs': 'International Affairs',
}

const CATEGORY_PRIORITY = [
  'weather',
  'politics',
  'sports',
  'crypto',
  'economy',
  'finance',
  'business',
  'culture',
  'entertainment',
  'technology',
  'science',
  'news',
  'world',
  'us-current-affairs',
  'international-affairs',
]

const CATEGORY_ALIASES: Record<string, keyof typeof CATEGORY_LABELS> = {
  elections: 'politics',
  'us-election': 'politics',
  'usa-election': 'politics',
  'us-presidential-election': 'politics',
  '2024-presidential-election': 'politics',
  nba: 'sports',
  nfl: 'sports',
  mlb: 'sports',
  nhl: 'sports',
  ufc: 'sports',
  soccer: 'sports',
  football: 'sports',
  tennis: 'sports',
  golf: 'sports',
  cricket: 'sports',
  bitcoin: 'crypto',
  ethereum: 'crypto',
  solana: 'crypto',
  altcoins: 'crypto',
}

const IGNORED_CATEGORY_TAGS = new Set(['all', 'hide-from-new', 'recurring'])

const titleCase = (value: string) =>
  value
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase())

const normalizeCategorySlug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')

const categoryOption = (value: string): CategoryOption => {
  const normalized = normalizeCategorySlug(value)
  const alias = CATEGORY_ALIASES[normalized] ?? normalized
  return { value: alias, label: CATEGORY_LABELS[alias] ?? titleCase(alias) }
}

export function categoryFromMetadata(metadata: EventMetadata): CategoryOption | null {
  const tags = metadata.tags
    .map((tag) => ({ label: tag.label, slug: normalizeCategorySlug(tag.slug) }))
    .filter((tag) => tag.slug && !IGNORED_CATEGORY_TAGS.has(tag.slug))
  const tagSlugs = new Set(tags.map((tag) => CATEGORY_ALIASES[tag.slug] ?? tag.slug))
  for (const value of CATEGORY_PRIORITY) {
    if (tagSlugs.has(value)) return categoryOption(value)
  }
  if (metadata.category) return categoryOption(metadata.category)
  const fallback = tags[0]
  return fallback ? categoryOption(fallback.slug || fallback.label) : null
}

export function categoryFromActivity(row: Activity): CategoryOption | null {
  const text = `${row.eventSlug} ${row.slug} ${row.title}`.toLowerCase()
  if (/\btemperature\b|\bweather\b/.test(text)) return categoryOption('weather')
  if (/\belection\b|\bmayoral\b|\bpresidential\b|\bsenate\b|\bcongress\b|\btrump\b|\bbiden\b|\bpolitics\b/.test(text)) {
    return categoryOption('politics')
  }
  if (/\bbitcoin\b|\bbtc\b|\beth\b|\bethereum\b|\bsol\b|\bsolana\b|\bcrypto\b/.test(text))
    return categoryOption('crypto')
  if (/\bnba\b|\bnfl\b|\bmlb\b|\bnhl\b|\bufc\b|\bsoccer\b|\bfootball\b|\btennis\b|\bgolf\b|\bcricket\b/.test(text)) {
    return categoryOption('sports')
  }
  if (/\bgdp\b|\bcpi\b|\binflation\b|\bfed\b|\brate-cut\b|\beconomy\b|\brecession\b/.test(text))
    return categoryOption('economy')
  return null
}

export function categoryForRow(row: Activity, sourceCategories: Record<string, CategoryOption | null>) {
  return sourceCategories[row.eventSlug] ?? categoryFromActivity(row)
}

export function getCategoryOptions(sourceRows: Activity[], sourceCategories: Record<string, CategoryOption | null>) {
  const byValue = new Map([[DEFAULT_CATEGORY, CATEGORY_LABELS[DEFAULT_CATEGORY]]])
  for (const row of sourceRows) {
    const option = categoryForRow(row, sourceCategories)
    if (option) byValue.set(option.value, option.label)
  }
  return [...byValue.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

export function filterRows(
  sourceRows: Activity[],
  selectedType: ActivityType | '',
  selectedSide: Side | '',
  selectedOutcome: string,
  selectedCategory: string,
  sourceCategories: Record<string, CategoryOption | null>,
) {
  return sourceRows.filter((row) => {
    if (selectedType && row.type !== selectedType) return false
    if (selectedSide && row.side !== selectedSide) return false
    if (selectedOutcome && row.outcome !== selectedOutcome) return false
    if (selectedCategory && categoryForRow(row, sourceCategories)?.value !== selectedCategory) return false
    return true
  })
}
