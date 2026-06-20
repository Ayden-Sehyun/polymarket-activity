// Fast browser contract for the refactor loop.
// It uses mocked network data and checks the UI seams most likely to regress
// during architecture cleanup: defaults, sticky columns, visible columns,
// filters, persistence, and load-more dedupe.
import { chromium } from 'playwright'

const APP_URL = process.argv[2] || 'http://localhost:5173'
const DEFAULT = '0x774728ed9264a5ca242e8bd7952a869df318fe40'
const ROW = '[data-testid="raw-row"]'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const mockActivity = (index, overrides = {}) => {
  const isConvert = index % 5 === 0
  return {
    proxyWallet: DEFAULT,
    timestamp: 1_781_900_000 - index,
    conditionId: `condition-${index}`,
    type: isConvert ? 'CONVERSION' : 'TRADE',
    size: 1,
    usdcSize: 0.005 + index / 100_000,
    transactionHash: `0x${index.toString(16).padStart(64, '0')}`,
    price: isConvert ? 0 : 0.001,
    asset: `asset-${index}`,
    side: index % 3 === 0 ? 'SELL' : 'BUY',
    outcomeIndex: index % 2,
    title: `Will the highest temperature in Miami be ${80 + (index % 12)}°F on June 20?`,
    slug: `weather-miami-${index}`,
    icon: '',
    eventSlug: `weather-miami-${index}`,
    outcome: index % 4 === 0 ? 'No' : 'Yes',
    name: 'Mock',
    pseudonym: 'Mock',
    ...overrides,
  }
}

const previewRows = Array.from({ length: 50 }, (_, index) =>
  mockActivity(index, {
    title: 'Will Alice win the 2028 presidential election?',
    slug: `mock-politics-${index}`,
    eventSlug: `mock-politics-${index}`,
  }),
)
const historyRows = [...previewRows, ...Array.from({ length: 15 }, (_, index) => mockActivity(index + 50))]

function filterServerRows(rows, url) {
  const type = url.searchParams.get('type')
  const side = url.searchParams.get('side')
  return rows.filter((row) => (!type || row.type === type) && (!side || row.side === side))
}

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 980, height: 760 } })
const page = await context.newPage()
const failures = []
const consoleIssues = []

const ok = (name, pass, detail = '') => {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`)
  if (!pass) failures.push(name)
}

page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning') {
    consoleIssues.push(`${message.type()}: ${message.text().slice(0, 200)}`)
  }
})
page.on('pageerror', (error) => consoleIssues.push(`pageerror: ${error.message}`))

await context.route('https://data-api.polymarket.com/activity**', async (route) => {
  const url = new URL(route.request().url())
  const rows = filterServerRows(url.searchParams.get('limit') === '50' ? previewRows : historyRows, url)
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(rows),
  })
})

await context.route(/https:\/\/(polygon\.drpc\.org|1rpc\.io\/matic|polygon-bor-rpc\.publicnode\.com).*/, async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x0' }),
  })
})

try {
  await page.goto(`${APP_URL}/?address=${DEFAULT}`)
  await page.waitForSelector('[data-testid="empty"]', { timeout: 12000 })

  const initial = await page.evaluate(() => ({
    category: document.querySelector('[data-testid="filter-category"]')?.value ?? '',
    rows: document.querySelectorAll('[data-testid="raw-row"]').length,
    empty: !!document.querySelector('[data-testid="empty"]'),
  }))
  ok(
    'default Weather filters loaded rows without auto-fill',
    initial.category === 'weather' && initial.rows === 0 && initial.empty,
    `category=${initial.category}, rows=${initial.rows}, empty=${initial.empty}`,
  )

  await page.locator('[data-testid="filter-category"]').selectOption('')
  await page.waitForSelector(ROW, { timeout: 12000 })

  await page.locator('[data-testid="sticky-summary"]').click()
  await page.locator('[data-testid="sticky-temp"]').check()
  await sleep(150)
  await page.$eval('.table-container', (el) => {
    el.scrollLeft = 180
  })
  await sleep(150)
  const sticky = await page.evaluate(() => {
    const read = (scope, col) => {
      const el = document.querySelector(`${scope} [data-col="${col}"]`)
      const rect = el?.getBoundingClientRect()
      return {
        sticky: el?.classList.contains('raw-sticky-cell') ?? false,
        x: rect?.x ?? -1,
        left: Number.parseFloat(el ? getComputedStyle(el).left : '-1'),
      }
    }
    return {
      cityHeader: read('[data-testid="raw-header"]', 'city'),
      cityCell: read('[data-testid="raw-row"]', 'city'),
      tempHeader: read('[data-testid="raw-header"]', 'temp'),
      tempCell: read('[data-testid="raw-row"]', 'temp'),
    }
  })
  ok(
    'selected sticky columns stay aligned after horizontal scroll',
    sticky.cityHeader.sticky &&
      sticky.tempHeader.sticky &&
      Math.abs(sticky.cityHeader.x - sticky.cityCell.x) < 1 &&
      Math.abs(sticky.tempHeader.x - sticky.tempCell.x) < 1 &&
      Math.abs(sticky.tempHeader.left - sticky.tempCell.left) < 1,
    `city=${sticky.cityHeader.x}/${sticky.cityCell.x}, temp=${sticky.tempHeader.x}/${sticky.tempCell.x}`,
  )

  await page.locator('[data-testid="sticky-summary"]').click()
  await page.locator('[data-testid="columns-summary"]').click()
  await page.locator('[data-testid="column-tx"]').uncheck()
  await sleep(150)
  await page.reload()
  await page.locator('[data-testid="filter-category"]').selectOption('')
  await page.waitForSelector(ROW, { timeout: 12000 })
  const hiddenAfterReload = await page.evaluate(() => ({
    header: !!document.querySelector('[data-testid="raw-header"] [data-col="tx"]'),
    cell: !!document.querySelector('[data-testid="raw-row"] [data-col="tx"]'),
  }))
  ok(
    'visible column choice persists after reload',
    !hiddenAfterReload.header && !hiddenAfterReload.cell,
    `tx header=${hiddenAfterReload.header}, cell=${hiddenAfterReload.cell}`,
  )

  await page.locator('[data-testid="auto-refresh"]').selectOption('30000')
  await page.locator('[data-testid="color-mode"]').selectOption('vertical')
  await page.locator('[data-testid="filter-category"]').selectOption('')
  await page.locator('[data-testid="filter-type"]').selectOption('CONVERSION')
  await page.locator('[data-testid="filter-side"]').selectOption('SELL')
  await page.locator('[data-testid="filter-outcome"]').selectOption('No')
  await page.reload()
  await page.waitForFunction(
    () => [...document.querySelectorAll('[data-testid="filter-outcome"] option')].some((option) => option.value === 'No'),
    undefined,
    { timeout: 12000 },
  )
  const persistedSelects = await page.evaluate(() => ({
    autoRefresh: document.querySelector('[data-testid="auto-refresh"]')?.value ?? '',
    colorMode: document.querySelector('[data-testid="color-mode"]')?.value ?? '',
    category: document.querySelector('[data-testid="filter-category"]')?.value ?? '',
    type: document.querySelector('[data-testid="filter-type"]')?.value ?? '',
    side: document.querySelector('[data-testid="filter-side"]')?.value ?? '',
    outcome: document.querySelector('[data-testid="filter-outcome"]')?.value ?? '',
  }))
  ok(
    'select options persist after reload',
    persistedSelects.autoRefresh === '30000' &&
      persistedSelects.colorMode === 'vertical' &&
      persistedSelects.category === '' &&
      persistedSelects.type === 'CONVERSION' &&
      persistedSelects.side === 'SELL' &&
      persistedSelects.outcome === 'No',
    JSON.stringify(persistedSelects),
  )

  await page.locator('[data-testid="auto-refresh"]').selectOption('15000')
  await page.locator('[data-testid="color-mode"]').selectOption('horizontal')
  await page.locator('[data-testid="filter-category"]').selectOption('')
  await page.locator('[data-testid="filter-type"]').selectOption('')
  await page.locator('[data-testid="filter-side"]').selectOption('')
  await page.locator('[data-testid="filter-outcome"]').selectOption('')
  await page.waitForSelector(ROW, { timeout: 12000 })

  await page.locator('[data-testid="filter-category"]').selectOption('')
  await page.waitForSelector(ROW, { timeout: 12000 })

  await page.locator('[data-testid="filter-type"]').selectOption('CONVERSION')
  await page.waitForFunction(() => {
    const rows = [...document.querySelectorAll('[data-testid="raw-row"]')]
    return rows.length > 0 && rows.every((row) => row.querySelector('[data-col="type"]')?.textContent?.trim() === 'Convert')
  }, undefined, { timeout: 12000 })
  ok('type filter updates visible rows', true)

  await page.locator('[data-testid="filter-type"]').selectOption('')
  await page.locator('[data-testid="filter-side"]').selectOption('SELL')
  await page.waitForFunction(() => {
    const rows = [...document.querySelectorAll('[data-testid="raw-row"]')]
    return rows.length > 0 && rows.every((row) => row.querySelector('[data-col="side"]')?.textContent?.trim() === 'Sell')
  }, undefined, { timeout: 12000 })
  ok('side filter updates visible rows', true)

  await page.locator('[data-testid="filter-outcome"]').selectOption('No')
  await page.waitForFunction(() => {
    const rows = [...document.querySelectorAll('[data-testid="raw-row"]')]
    return rows.length > 0 && rows.every((row) => row.querySelector('[data-col="outcome"]')?.textContent?.trim() === 'No')
  }, undefined, { timeout: 12000 })
  ok('outcome filter updates visible rows', true)

  await page.locator('[data-testid="filter-side"]').selectOption('')
  await page.locator('[data-testid="filter-outcome"]').selectOption('')
  const beforeTotal = Number(await page.locator('[data-testid="status"]').getAttribute('data-total'))
  await page.locator('[data-testid="load-more"]').click()
  await page.waitForFunction(
    (previous) => Number(document.querySelector('[data-testid="status"]')?.getAttribute('data-total') ?? 0) > previous,
    beforeTotal,
    { timeout: 12000 },
  )
  const afterTotal = Number(await page.locator('[data-testid="status"]').getAttribute('data-total'))
  ok('load more appends unique rows without duplicate key warnings', afterTotal > beforeTotal, `${beforeTotal} -> ${afterTotal}`)

  const autoContext = await browser.newContext({ viewport: { width: 980, height: 760 } })
  await autoContext.addInitScript(() => {
    const realSetInterval = window.setInterval.bind(window)
    window.setInterval = (handler, timeout, ...args) => realSetInterval(handler, Number(timeout) >= 5000 ? 60 : timeout, ...args)
    window.localStorage.setItem('activity-options', JSON.stringify({ autoRefreshMs: '5000', category: '' }))
  })
  let autoActivityCalls = 0
  let autoBalanceCalls = 0
  await autoContext.route('https://data-api.polymarket.com/activity**', async (route) => {
    const url = new URL(route.request().url())
    autoActivityCalls += 1
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(filterServerRows(url.searchParams.get('limit') === '50' ? previewRows : historyRows, url)),
    })
  })
  await autoContext.route(/https:\/\/(polygon\.drpc\.org|1rpc\.io\/matic|polygon-bor-rpc\.publicnode\.com).*/, async (route) => {
    autoBalanceCalls += 1
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x3b9aca00' }),
    })
  })
  const autoPage = await autoContext.newPage()
  await autoPage.goto(`${APP_URL}/?address=${DEFAULT}`)
  await autoPage.waitForSelector(ROW, { timeout: 12000 })
  await sleep(250)
  ok(
    'auto refresh cadence refreshes activity and pUSD',
    autoActivityCalls >= 2 && autoBalanceCalls >= 2,
    `activity=${autoActivityCalls}, pUSD=${autoBalanceCalls}`,
  )
  await autoContext.close()

  const realConsoleIssues = consoleIssues.filter((issue) => !issue.includes('React DevTools'))
  ok('no browser console errors or warnings', realConsoleIssues.length === 0, realConsoleIssues[0] ?? '')
} catch (err) {
  failures.push('script threw')
  console.error('FAIL  script threw:', err instanceof Error ? err.message : err)
} finally {
  await browser.close()
}

process.exit(failures.length ? 1 : 0)
