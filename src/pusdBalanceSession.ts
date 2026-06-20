export type PusdBalanceState = {
  balance: number | null
  fetching: boolean
}

export type PusdBalanceSessionOptions = {
  fetchBalance: (address: string, signal?: AbortSignal) => Promise<number>
  onChange: (state: PusdBalanceState) => void
}

export function createInitialPusdBalanceState(): PusdBalanceState {
  return {
    balance: null,
    fetching: false,
  }
}

export function createPusdBalanceSession(options: PusdBalanceSessionOptions) {
  return new PusdBalanceSession(options)
}

class PusdBalanceSession {
  private readonly fetchBalance: PusdBalanceSessionOptions['fetchBalance']
  private readonly onChange: PusdBalanceSessionOptions['onChange']
  private state = createInitialPusdBalanceState()
  private address = ''
  private requestSeq = 0
  private controller: AbortController | null = null

  constructor(options: PusdBalanceSessionOptions) {
    this.fetchBalance = options.fetchBalance
    this.onChange = options.onChange
    this.emit()
  }

  setAddress(address: string, validAddress: boolean) {
    if (!validAddress) {
      this.clear()
      return
    }

    const normalizedAddress = address.toLowerCase()
    if (this.address === normalizedAddress) return
    this.address = normalizedAddress
    void this.fetch(normalizedAddress, ++this.requestSeq)
  }

  dispose() {
    this.controller?.abort()
    this.requestSeq += 1
    this.address = ''
  }

  private clear() {
    this.controller?.abort()
    this.requestSeq += 1
    this.address = ''
    this.patch({ balance: null, fetching: false })
  }

  private async fetch(address: string, seq: number) {
    this.controller?.abort()
    const controller = new AbortController()
    this.controller = controller
    this.patch({ balance: null, fetching: true })
    try {
      const balance = await this.fetchBalance(address, controller.signal)
      if (this.isCurrent(address, seq)) this.patch({ balance })
    } catch {
      if (this.isCurrent(address, seq)) this.patch({ balance: null })
    } finally {
      if (this.isCurrent(address, seq)) this.patch({ fetching: false })
    }
  }

  private isCurrent(address: string, seq: number) {
    return seq === this.requestSeq && this.address === address
  }

  private patch(next: Partial<PusdBalanceState>) {
    this.state = { ...this.state, ...next }
    this.emit()
  }

  private emit() {
    this.onChange({ ...this.state })
  }
}
