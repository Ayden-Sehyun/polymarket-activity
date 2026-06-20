export type ColorBarMode = 'horizontal' | 'vertical' | 'none'

export const DEFAULT_COLOR_BAR_MODE: ColorBarMode = 'horizontal'

export const COLOR_BAR_OPTIONS: { value: ColorBarMode; label: string }[] = [
  { value: 'horizontal', label: 'ROW ACCENT' },
  { value: 'vertical', label: 'SIDE ACCENT' },
  { value: 'none', label: 'NO ACCENT' },
]

const COLOR_BAR_STORAGE_KEY = 'activity-color-bar-mode'

export function readColorBarMode(storage: Storage): ColorBarMode {
  const value = storage.getItem(COLOR_BAR_STORAGE_KEY)
  return isColorBarMode(value) ? value : DEFAULT_COLOR_BAR_MODE
}

export function persistColorBarMode(storage: Storage, mode: ColorBarMode) {
  storage.setItem(COLOR_BAR_STORAGE_KEY, mode)
}

function isColorBarMode(value: unknown): value is ColorBarMode {
  return value === 'horizontal' || value === 'vertical' || value === 'none'
}
