import {
  activityKey,
  INITIAL_PAGE_SIZE,
  PAGE_SIZE,
  type Activity,
  type ActivityFilters,
  type ActivityPage,
  type ActivityType,
  type Cursor,
  type Side,
} from './api'

export type ActivitySessionQuery = {
  address: string
  type: ActivityType | ''
  side: Side | ''
  validAddress: boolean
}

export type ActivitySessionState = {
  rows: Activity[]
  nextCursor: Cursor | undefined
  loading: boolean
  fetching: boolean
  fetchingNextPage: boolean
  autoFilling: boolean
  error: Error | null
  lastRefreshAt: number | null
}

export type ActivitySessionOptions = {
  fetchPage: (
    address: string,
    filters: ActivityFilters,
    cursor: Cursor,
    signal?: AbortSignal,
    pageSize?: number,
  ) => Promise<ActivityPage>
  onChange: (state: ActivitySessionState) => void
  refreshIntervalMs?: number
  initialPageSize?: number
  autoFillMaxPages?: number
}

const DEFAULT_REFRESH_INTERVAL_MS = 15_000
const DEFAULT_AUTO_FILL_MAX_PAGES = 4

export function createInitialActivitySessionState(): ActivitySessionState {
  return {
    rows: [],
    nextCursor: { offset: 0 },
    loading: false,
    fetching: false,
    fetchingNextPage: false,
    autoFilling: false,
    error: null,
    lastRefreshAt: null,
  }
}

export function createActivitySession(options: ActivitySessionOptions) {
  return new ActivitySession(options)
}

class ActivitySession {
  private readonly fetchPage: ActivitySessionOptions['fetchPage']
  private readonly onChange: ActivitySessionOptions['onChange']
  private readonly refreshIntervalMs: number
  private readonly initialPageSize: number
  private readonly autoFillMaxPages: number
  private state = createInitialActivitySessionState()
  private pages: Activity[][] = []
  private query: ActivitySessionQuery = { address: '', type: '', side: '', validAddress: false }
  private queryKey = ''
  private requestSeq = 0
  private activeController: AbortController | null = null
  private refreshController: AbortController | null = null
  private refreshTimer: number | undefined
  private autoFillKey = ''
  private autoFillAttempts = 0

  constructor(options: ActivitySessionOptions) {
    this.fetchPage = options.fetchPage
    this.onChange = options.onChange
    this.refreshIntervalMs = options.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS
    this.initialPageSize = options.initialPageSize ?? INITIAL_PAGE_SIZE
    this.autoFillMaxPages = options.autoFillMaxPages ?? DEFAULT_AUTO_FILL_MAX_PAGES
    this.emit()
  }

  setQuery(query: ActivitySessionQuery) {
    const key = `${query.address.toLowerCase()}|${query.type}|${query.side}|${query.validAddress}`
    if (key === this.queryKey) return
    this.query = query
    this.queryKey = key
    void this.resetAndFetch()
  }

  retry() {
    if (this.pages.length > 0) void this.loadNext(true)
    else void this.resetAndFetch()
  }

  async loadNext(asNextPage = true, seq = this.requestSeq) {
    if (!this.query.validAddress || !this.state.nextCursor || this.state.fetchingNextPage || this.state.fetching) return
    this.activeController?.abort()
    const controller = new AbortController()
    this.activeController = controller
    const cursor = this.state.nextCursor
    const fetchAddress = this.query.address.toLowerCase()
    this.patch({ fetching: true, fetchingNextPage: asNextPage })
    try {
      const page = await this.fetchPage(fetchAddress, this.filters(), cursor, controller.signal, PAGE_SIZE)
      if (seq !== this.requestSeq) return
      this.pages = [...this.pages, page.items]
      this.patch({
        nextCursor: page.nextCursor,
        lastRefreshAt: Date.now(),
        error: null,
      })
    } catch (err) {
      if (seq === this.requestSeq && !isAbortError(err)) {
        this.patch({ error: toError(err) })
      }
    } finally {
      if (seq === this.requestSeq) {
        this.patch({ fetching: false, fetchingNextPage: false })
      }
    }
  }

  async refreshLatest(seq = this.requestSeq) {
    if (!this.query.validAddress) return
    this.refreshController?.abort()
    const controller = new AbortController()
    this.refreshController = controller
    const fetchAddress = this.query.address.toLowerCase()
    const refreshPageSize = this.state.rows.length <= this.initialPageSize ? this.initialPageSize : undefined
    try {
      const page = await this.fetchPage(fetchAddress, this.filters(), { offset: 0 }, controller.signal, refreshPageSize)
      if (seq !== this.requestSeq) return
      this.pages = mergeLatestPage(this.pages, page.items)
      this.patch({
        lastRefreshAt: Date.now(),
        error: null,
      })
    } catch (err) {
      if (seq === this.requestSeq && !isAbortError(err)) {
        this.patch({ error: toError(err) })
      }
    }
  }

  async maybeAutoFillFilteredRows(filterKey: string, clientFilterActive: boolean, visibleCount: number) {
    if (filterKey !== this.autoFillKey) {
      this.autoFillKey = filterKey
      this.autoFillAttempts = 0
    }
    if (
      !this.query.validAddress ||
      !clientFilterActive ||
      this.state.loading ||
      this.state.fetching ||
      this.state.autoFilling ||
      this.state.rows.length === 0 ||
      visibleCount > 0 ||
      !this.state.nextCursor ||
      this.autoFillAttempts >= this.autoFillMaxPages
    ) {
      return
    }

    const seq = this.requestSeq
    this.autoFillAttempts += 1
    this.patch({ autoFilling: true })
    try {
      await this.loadNext(false, seq)
    } finally {
      if (seq === this.requestSeq && filterKey === this.autoFillKey) {
        this.patch({ autoFilling: false })
      }
    }
  }

  dispose() {
    this.activeController?.abort()
    this.refreshController?.abort()
    if (this.refreshTimer !== undefined) window.clearInterval(this.refreshTimer)
  }

  private async resetAndFetch() {
    this.activeController?.abort()
    this.refreshController?.abort()
    if (this.refreshTimer !== undefined) {
      window.clearInterval(this.refreshTimer)
      this.refreshTimer = undefined
    }
    const seq = ++this.requestSeq
    this.pages = []
    this.autoFillAttempts = 0
    this.autoFillKey = ''
    this.patch({
      rows: [],
      nextCursor: { offset: 0 },
      lastRefreshAt: null,
      error: null,
      fetching: false,
      fetchingNextPage: false,
      autoFilling: false,
    })

    if (!this.query.validAddress) {
      this.patch({
        loading: false,
        fetching: false,
        fetchingNextPage: false,
      })
      return
    }

    this.patch({ loading: true })
    await this.fetchInitialRows(seq)
    if (seq === this.requestSeq) this.startRefreshTimer(seq)
  }

  private startRefreshTimer(seq: number) {
    if (this.refreshTimer !== undefined) window.clearInterval(this.refreshTimer)
    this.refreshTimer = window.setInterval(() => {
      void this.refreshLatest(seq)
    }, this.refreshIntervalMs)
  }

  private async fetchInitialRows(seq = this.requestSeq) {
    this.activeController?.abort()
    const controller = new AbortController()
    this.activeController = controller
    const fetchAddress = this.query.address.toLowerCase()
    this.patch({ fetching: true })
    try {
      const page = await this.fetchPage(fetchAddress, this.filters(), { offset: 0 }, controller.signal, this.initialPageSize)
      if (seq !== this.requestSeq) return
      this.pages = [page.items]
      this.patch({
        nextCursor: page.items.length === this.initialPageSize ? { offset: 0 } : undefined,
        lastRefreshAt: Date.now(),
        error: null,
      })
    } catch (err) {
      if (seq === this.requestSeq && !isAbortError(err)) {
        this.patch({ error: toError(err) })
      }
    } finally {
      if (seq === this.requestSeq) {
        this.patch({
          loading: false,
          fetching: false,
          fetchingNextPage: false,
        })
      }
    }
  }

  private filters(): ActivityFilters {
    return { type: this.query.type, side: this.query.side }
  }

  private patch(next: Partial<ActivitySessionState>) {
    this.state = {
      ...this.state,
      ...next,
      rows: next.rows ?? dedupeRows(this.pages),
    }
    this.emit()
  }

  private emit() {
    this.onChange({ ...this.state, rows: [...this.state.rows] })
  }
}

function dedupeRows(sourcePages: Activity[][]) {
  const seen = new Set<string>()
  const out: Activity[] = []
  for (const page of sourcePages) {
    for (const item of page) {
      const key = activityKey(item)
      if (!seen.has(key)) {
        seen.add(key)
        out.push(item)
      }
    }
  }
  return out
}

function mergeLatestPage(sourcePages: Activity[][], latestItems: Activity[]) {
  if (sourcePages.length === 0) return [latestItems]
  const latestKeys = new Set(latestItems.map(activityKey))
  const rest = sourcePages.flat().filter((item) => !latestKeys.has(activityKey(item)))
  return [latestItems, rest]
}

function isAbortError(err: unknown) {
  return err instanceof DOMException && err.name === 'AbortError'
}

function toError(err: unknown) {
  return err instanceof Error ? err : new Error(String(err))
}
