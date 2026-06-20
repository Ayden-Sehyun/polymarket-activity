import { describe, expect, it } from 'vitest'
import {
  DEFAULT_COLOR_BAR_MODE,
  persistColorBarMode,
  readColorBarMode,
} from '../src/colorBar'

function storageWith(value: string | null): Storage {
  const values = new Map<string, string>()
  if (value !== null) values.set('activity-color-bar-mode', value)
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, next: string) => {
      values.set(key, next)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
    clear: () => {
      values.clear()
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size
    },
  }
}

describe('color bar mode storage', () => {
  it('falls back to the default for missing or invalid values', () => {
    expect(readColorBarMode(storageWith(null))).toBe(DEFAULT_COLOR_BAR_MODE)
    expect(readColorBarMode(storageWith('rainbow'))).toBe(DEFAULT_COLOR_BAR_MODE)
  })

  it('round trips valid modes', () => {
    const storage = storageWith(null)
    persistColorBarMode(storage, 'vertical')
    expect(readColorBarMode(storage)).toBe('vertical')
    persistColorBarMode(storage, 'none')
    expect(readColorBarMode(storage)).toBe('none')
  })
})
