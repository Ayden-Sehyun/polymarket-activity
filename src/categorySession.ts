import type { Activity, EventMetadata } from './api'
import { categoryFromActivity, categoryFromMetadata, type CategoryOption } from './category'

export type CategorySessionState = {
  categories: Record<string, CategoryOption | null>
}

export type CategorySessionOptions = {
  fetchEventMetadata: (eventSlug: string, signal?: AbortSignal) => Promise<EventMetadata>
  onChange: (state: CategorySessionState) => void
  concurrency?: number
}

const DEFAULT_CONCURRENCY = 6

export function createInitialCategorySessionState(): CategorySessionState {
  return {
    categories: {},
  }
}

export function createCategorySession(options: CategorySessionOptions) {
  return new CategorySession(options)
}

class CategorySession {
  private readonly fetchEventMetadata: CategorySessionOptions['fetchEventMetadata']
  private readonly onChange: CategorySessionOptions['onChange']
  private readonly concurrency: number
  private state = createInitialCategorySessionState()
  private pendingSlugs = new Set<string>()
  private controller: AbortController | null = null
  private disposed = false

  constructor(options: CategorySessionOptions) {
    this.fetchEventMetadata = options.fetchEventMetadata
    this.onChange = options.onChange
    this.concurrency = options.concurrency ?? DEFAULT_CONCURRENCY
    this.emit()
  }

  hydrate(rows: Activity[]) {
    if (this.disposed) return
    const inferred: Record<string, CategoryOption> = {}
    const rowsBySlug = new Map<string, Activity>()
    for (const row of rows) {
      if (!row.eventSlug || row.eventSlug in this.state.categories || this.pendingSlugs.has(row.eventSlug)) continue
      if (!rowsBySlug.has(row.eventSlug)) rowsBySlug.set(row.eventSlug, row)
    }

    const missing: string[] = []
    for (const [slug, row] of rowsBySlug) {
      const category = categoryFromActivity(row)
      if (category) inferred[slug] = category
      else missing.push(slug)
    }

    if (Object.keys(inferred).length > 0) this.patch({ categories: { ...this.state.categories, ...inferred } })
    if (missing.length === 0) return

    for (const slug of missing) this.pendingSlugs.add(slug)
    if (!this.controller || this.controller.signal.aborted) this.controller = new AbortController()
    void this.fetchMissing(missing, this.controller.signal)
  }

  dispose() {
    this.disposed = true
    this.controller?.abort()
    this.pendingSlugs.clear()
  }

  private async fetchMissing(slugs: string[], signal: AbortSignal) {
    let index = 0
    const worker = async () => {
      while (index < slugs.length) {
        if (this.disposed || signal.aborted) return
        const slug = slugs[index]
        index += 1
        try {
          const metadata = await this.fetchEventMetadata(slug, signal)
          if (!this.disposed)
            this.patch({ categories: { ...this.state.categories, [slug]: categoryFromMetadata(metadata) } })
        } catch (err) {
          if (!isAbortError(err) && !this.disposed) {
            this.patch({ categories: { ...this.state.categories, [slug]: null } })
          }
        } finally {
          this.pendingSlugs.delete(slug)
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(this.concurrency, slugs.length) }, worker))
  }

  private patch(next: Partial<CategorySessionState>) {
    this.state = { ...this.state, ...next }
    this.emit()
  }

  private emit() {
    this.onChange({ categories: { ...this.state.categories } })
  }
}

function isAbortError(err: unknown) {
  return err instanceof DOMException && err.name === 'AbortError'
}
