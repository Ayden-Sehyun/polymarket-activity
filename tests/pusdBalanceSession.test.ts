import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPusdBalanceSession, type PusdBalanceState } from '../src/pusdBalanceSession'
import { OTHER_WALLET, WALLET } from './fixtures'

const waitFor = async (assertion: () => void | Promise<void>) => {
  const deadline = performance.now() + 1000
  let lastError: unknown
  while (performance.now() < deadline) {
    try {
      await assertion()
      return
    } catch (err) {
      lastError = err
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
  if (lastError) throw lastError
  await assertion()
}

describe('pusdBalanceSession', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches a balance for a normalized valid address', async () => {
    const states: PusdBalanceState[] = []
    const fetchBalance = vi.fn(async () => 61.79)
    const session = createPusdBalanceSession({ fetchBalance, onChange: (state) => states.push(state) })

    session.setAddress(WALLET.toUpperCase(), true)

    await waitFor(() => expect(states.at(-1)).toEqual({ balance: 61.79, fetching: false }))
    expect(fetchBalance).toHaveBeenCalledWith(WALLET, expect.any(AbortSignal))
    session.dispose()
  })

  it('clears state and aborts when the address becomes invalid', async () => {
    const states: PusdBalanceState[] = []
    const abortSpy = vi.spyOn(AbortController.prototype, 'abort')
    const fetchBalance = vi.fn(() => new Promise<number>(() => {}))
    const session = createPusdBalanceSession({ fetchBalance, onChange: (state) => states.push(state) })

    session.setAddress(WALLET, true)
    session.setAddress('abc', false)

    expect(abortSpy).toHaveBeenCalled()
    expect(states.at(-1)).toEqual({ balance: null, fetching: false })
    session.dispose()
  })

  it('ignores stale responses after the address changes', async () => {
    const states: PusdBalanceState[] = []
    const pending: Array<{ address: string; resolve: (balance: number) => void }> = []
    const fetchBalance = vi.fn(
      async (address: string) =>
        new Promise<number>((resolve) => {
          pending.push({ address, resolve })
        }),
    )
    const session = createPusdBalanceSession({ fetchBalance, onChange: (state) => states.push(state) })

    session.setAddress(WALLET, true)
    await waitFor(() => expect(pending).toHaveLength(1))
    session.setAddress(OTHER_WALLET, true)
    await waitFor(() => expect(pending).toHaveLength(2))

    pending[1].resolve(2)
    await waitFor(() => expect(states.at(-1)).toEqual({ balance: 2, fetching: false }))
    pending[0].resolve(1)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(states.at(-1)).toEqual({ balance: 2, fetching: false })
    session.dispose()
  })

  it('does not emit after dispose', async () => {
    const states: PusdBalanceState[] = []
    let resolveBalance: (balance: number) => void = () => {}
    const fetchBalance = vi.fn(
      async () =>
        new Promise<number>((resolve) => {
          resolveBalance = resolve
        }),
    )
    const session = createPusdBalanceSession({ fetchBalance, onChange: (state) => states.push(state) })

    session.setAddress(WALLET, true)
    await waitFor(() => expect(states.at(-1)).toEqual({ balance: null, fetching: true }))
    const emissionsBeforeDispose = states.length
    session.dispose()
    resolveBalance(99)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(states).toHaveLength(emissionsBeforeDispose)
  })
})
