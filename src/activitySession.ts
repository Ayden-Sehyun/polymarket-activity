import {
  activityKey,
  INITIAL_PAGE_SIZE,
  PAGE_SIZE,
  type Activity,
  type ActivityFilters,
  type ActivityPage,
  type Cursor,
} from './api'

type ActivitySessionQuery = {
  address: string
  validAddress: boolean
}

export type ActivitySessionState = {
  rows: Activity[]
  nextCursor: Cursor | undefined
  loading: boolean
  fetching: boolean
  fetchingNextPage: boolean
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
  initialPageSize?: number
}

export function createInitialActivitySessionState(): ActivitySessionState {
  return {
    rows: [],
    nextCursor: { offset: 0 },
    loading: false,
    fetching: false,
    fetchingNextPage: false,
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
  private readonly initialPageSize: number
  private state = createInitialActivitySessionState()
  private pages: Activity[][] = []
  private query: ActivitySessionQuery = { address: '', validAddress: false }
  private queryKey = ''
  private requestSeq = 0
  private activeController: AbortController | null = null
  private refreshController: AbortController | null = null

  constructor(options: ActivitySessionOptions) {
    this.fetchPage = options.fetchPage
    this.onChange = options.onChange
    this.initialPageSize = options.initialPageSize ?? INITIAL_PAGE_SIZE
    this.emit()
  }

  setQuery(query: ActivitySessionQuery) {
    const key = `${query.address.toLowerCase()}|${query.validAddress}`
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

  dispose() {
    this.activeController?.abort()
    this.refreshController?.abort()
  }

  private async resetAndFetch() {
    this.activeController?.abort()
    this.refreshController?.abort()
    const seq = ++this.requestSeq
    this.pages = []
    this.patch({
      rows: [],
      nextCursor: { offset: 0 },
      lastRefreshAt: null,
      error: null,
      fetching: false,
      fetchingNextPage: false,
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
  }

  private async fetchInitialRows(seq = this.requestSeq) {
    this.activeController?.abort()
    const controller = new AbortController()
    this.activeController = controller
    const fetchAddress = this.query.address.toLowerCase()
    this.patch({ fetching: true })
    try {
      const page = await this.fetchPage(
        fetchAddress,
        this.filters(),
        { offset: 0 },
        controller.signal,
        this.initialPageSize,
      )
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
    return { type: '', side: '' }
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
