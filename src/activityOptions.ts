import type { ActivityType, Side } from './api'
import { DEFAULT_CATEGORY } from './category'

export type AutoRefreshMs = '0' | '5000' | '15000' | '30000' | '60000'

export type ActivityOptions = {
  type: ActivityType | ''
  side: Side | ''
  outcome: string
  category: string
  autoRefreshMs: AutoRefreshMs
}

export const AUTO_REFRESH_OPTIONS: { value: AutoRefreshMs; label: string }[] = [
  { value: '0', label: 'AUTO OFF' },
  { value: '5000', label: 'AUTO 5S' },
  { value: '15000', label: 'AUTO 15S' },
  { value: '30000', label: 'AUTO 30S' },
  { value: '60000', label: 'AUTO 60S' },
]

export const DEFAULT_ACTIVITY_OPTIONS: ActivityOptions = {
  type: '',
  side: '',
  outcome: '',
  category: DEFAULT_CATEGORY,
  autoRefreshMs: '15000',
}

const ACTIVITY_OPTIONS_STORAGE_KEY = 'activity-options'
const TYPE_VALUES = new Set<ActivityType | ''>(['', 'TRADE', 'REDEEM', 'CONVERSION', 'SPLIT', 'MERGE', 'REWARD'])
const SIDE_VALUES = new Set<Side | ''>(['', 'BUY', 'SELL'])
const AUTO_REFRESH_VALUES = new Set<AutoRefreshMs>(AUTO_REFRESH_OPTIONS.map((option) => option.value))
const MAX_OPTION_LENGTH = 100

export function readActivityOptions(storage: Storage): ActivityOptions {
  try {
    return normalizeActivityOptions(JSON.parse(storage.getItem(ACTIVITY_OPTIONS_STORAGE_KEY) ?? 'null'))
  } catch {
    return { ...DEFAULT_ACTIVITY_OPTIONS }
  }
}

export function persistActivityOptions(storage: Storage, options: ActivityOptions) {
  storage.setItem(ACTIVITY_OPTIONS_STORAGE_KEY, JSON.stringify(normalizeActivityOptions(options)))
}

export function patchActivityOptions(storage: Storage, patch: Partial<ActivityOptions>) {
  persistActivityOptions(storage, { ...readActivityOptions(storage), ...patch })
}

function normalizeActivityOptions(value: unknown): ActivityOptions {
  const source = isRecord(value) ? value : {}
  return {
    type: TYPE_VALUES.has(source.type as ActivityType | '') ? (source.type as ActivityType | '') : DEFAULT_ACTIVITY_OPTIONS.type,
    side: SIDE_VALUES.has(source.side as Side | '') ? (source.side as Side | '') : DEFAULT_ACTIVITY_OPTIONS.side,
    outcome: readableOptionString(source.outcome, DEFAULT_ACTIVITY_OPTIONS.outcome),
    category: readableOptionString(source.category, DEFAULT_ACTIVITY_OPTIONS.category),
    autoRefreshMs: AUTO_REFRESH_VALUES.has(source.autoRefreshMs as AutoRefreshMs)
      ? (source.autoRefreshMs as AutoRefreshMs)
      : DEFAULT_ACTIVITY_OPTIONS.autoRefreshMs,
  }
}

function readableOptionString(value: unknown, fallback: string) {
  return typeof value === 'string' && value.length <= MAX_OPTION_LENGTH ? value : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
