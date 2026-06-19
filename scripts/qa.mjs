// Headless QA driver: exercises every feature of the activity viewer against
// the live dev server and live data-api, at BOTH desktop and mobile viewports.
//
//   node scripts/qa.mjs            # runs desktop, then mobile
//   node scripts/qa.mjs desktop    # desktop only (1440x950)
//   node scripts/qa.mjs mobile     # mobile only (iPhone 14)
import { chromium, devices } from 'playwright'

const APP_URL = 'http://localhost:5173'
const DEFAULT = '0x774728ed9264a5ca242e8bd7952a869df318fe40'
const OTHER = '0x0c7c5204404e9d5402d258fedac59c7212bae4cb'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const RAW_ROW = '[data-testid="raw-row"]'

async function runSweep(mode) {
  const isMobile = mode === 'mobile'
  const label = isMobile ? 'MOBILE (iPhone 14)' : 'DESKTOP (1440x950)'
  console.log(`\n========== QA SWEEP — ${label} ==========`)

  const results = []
  const ok = (name, pass, detail = '') => {
    results.push({ name, pass })
    console.log(`${pass ? 'PASS' : 'FAIL'}  [${isMobile ? 'M' : 'D'}] ${name}${detail ? ` — ${detail}` : ''}`)
  }

  const browser = await chromium.launch()
  const context = isMobile
    ? await browser.newContext({ ...devices['iPhone 14'] })
    : await browser.newContext({ viewport: { width: 1440, height: 950 } })
  const page = await context.newPage()

  const consoleIssues = []
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') consoleIssues.push(`${m.type()}: ${m.text().slice(0, 200)}`)
  })
  page.on('pageerror', (e) => consoleIssues.push(`pageerror: ${e.message}`))

  const apiCalls = []
  let fetchedItems = 0
  page.on('response', async (res) => {
    if (!res.url().startsWith('https://data-api.polymarket.com/activity')) return
    const u = new URL(res.url())
    const entry = {
      user: u.searchParams.get('user'),
      offset: u.searchParams.get('offset'),
      end: u.searchParams.get('end'),
      type: u.searchParams.get('type'),
      side: u.searchParams.get('side'),
      sortDirection: u.searchParams.get('sortDirection'),
      status: res.status(),
    }
    try {
      const j = await res.json()
      entry.count = j.length
      // the "joined" probe fetches limit=1 ASC; don't count it toward the infinite-scroll tally
      if (entry.sortDirection !== 'ASC') fetchedItems += j.length
    } catch {}
    apiCalls.push(entry)
  })

  const statusText = async () =>
    (await page.locator('[data-testid="status"]').first().innerText()).replace(/\s+/g, ' ')
  const statusCursor = async () =>
    (await page.locator('[data-testid="status"]').first().getAttribute('data-cursor').catch(() => '')) || ''
  const rowCounts = async () => {
    const attrs = await page.locator('[data-testid="status"]').first().evaluate((el) => ({
      shown: el.getAttribute('data-shown'),
      total: el.getAttribute('data-total'),
    })).catch(() => ({ shown: null, total: null }))
    const text = await statusText()
    if (attrs.total !== null) {
      return { shown: +(attrs.shown ?? attrs.total), total: +attrs.total, text }
    }
    let m = text.match(/(\d+) of (\d+) loaded rows/)
    if (m) return { shown: +m[1], total: +m[2], text }
    m = text.match(/(\d+)\/(\d+) ROWS/)
    if (m) return { shown: +m[1], total: +m[2], text }
    m = text.match(/(\d+) ROWS/)
    if (m) return { shown: +m[1], total: +m[1], text }
    m = text.match(/rows=(\d+)\/(\d+)/)
    if (m) return { shown: +m[1], total: +m[2], text }
    m = text.match(/rows=(\d+)/)
    if (m) return { shown: +m[1], total: +m[1], text }
    m = text.match(/(\d+) rows/)
    return { shown: m ? +m[1] : 0, total: m ? +m[1] : 0, text }
  }

  // Structured extraction from the raw div-grid rows.
  const sigText = (s) => (s || '').replace(/[$,¢\s]/g, '')
  const visibleRows = () =>
    page.$$eval(RAW_ROW, (els) =>
      els.map((el) => {
        const cells = [...el.querySelectorAll('[role="cell"]')]
        const t = (i) => cells[i]?.textContent?.trim() ?? ''
        return {
          title: t(0),
          temp: t(1),
          date: t(2),
          side: t(3),
          type: t(4),
          outcome: t(5),
          price: t(6),
          amount: t(7),
          time: t(8),
          txHref: cells[9]?.querySelector('a')?.href ?? '',
        }
      }),
    )
  const scrollContainer = (top) =>
    page.$eval('.table-container', (el, v) => (el.scrollTop = v === 'bottom' ? el.scrollHeight : v), top)

  // Wait until at least one row is rendered, optionally until every visible row's
  // type matches `expectType` (e.g. "Redeem") — covers the brief refetch window
  // where the previous filter's rows are swapped out.
  const waitForRows = async (expectType, timeout = 12000) => {
    try {
      await page.waitForFunction(
        (want) => {
          const rows = [...document.querySelectorAll('[data-testid="raw-row"]')]
          if (rows.length === 0) return false
          if (!want) return true
          return rows.every((r) => {
            const t = r.querySelectorAll('[role="cell"]')[4]?.textContent?.trim()
            return t === want
          })
        },
        expectType,
        { timeout },
      )
    } catch {
      /* fall through; the assertion will report the real state */
    }
  }

  // ---- 0. bare load (no param) → prompt, no API traffic
  await page.goto(APP_URL)
  await page.waitForSelector('[data-testid="prompt"]', { timeout: 10000 })
  ok(
    '🔍 bare load (no ?address=) → prompt, zero API calls',
    apiCalls.length === 0 && !(await page.locator('.hint').count()),
    `prompt shown, ${apiCalls.length} api calls`,
  )

  // ---- 1. initial load via shareable ?address= param
  await page.goto(`${APP_URL}/?address=${DEFAULT}`)
  await page.waitForSelector(RAW_ROW, { timeout: 20000 })
  await sleep(900)
  let rc = await rowCounts()
  const previewRequest = apiCalls.some(
    (c) => c.user === DEFAULT && c.offset === '0' && c.sortDirection === 'DESC' && c.count === 50,
  )
  ok(
    'initial load via ?address= param (50-row LCP preview)',
    rc.total >= 50 && previewRequest,
    `${rc.total} rows; preview=${previewRequest}`,
  )

  // ---- 2. link formats
  const rowsForLinks = await visibleRows()
  const txHrefs = rowsForLinks.slice(0, 5).map((r) => r.txHref)
  ok(
    'tx links → polygonscan',
    txHrefs.length > 0 && txHrefs.every((h) => /^https:\/\/polygonscan\.com\/tx\/0x[0-9a-f]{64}$/.test(h)),
    txHrefs[0],
  )

  // ---- 3. raw numeric formatting
  const sigDigits = (s) => {
    const t = sigText(s)
    if (!/^\d*\.?\d+$/.test(t)) return 0
    return t.replace('.', '').replace(/^0+/, '').length
  }
  const rows0 = await visibleRows()
  const badNumbers = []
  for (const r of rows0) {
    if (r.price !== '--' && !/^\d+\.\d{3}$/.test(r.price)) badNumbers.push(r.price)
    if (r.amount && !/^\d+\.\d{5}$/.test(r.amount)) badNumbers.push(r.amount)
    if (r.amount && sigDigits(r.amount) > 15) badNumbers.push(r.amount)
  }
  ok(
    'raw price/amount decimal formatting',
    badNumbers.length === 0,
    badNumbers[0] || `checked ${rows0.length} visible rows`,
  )

  // ---- category filter, inferred from slug immediately and Gamma-backed for unknowns
  const categorySelect = page.locator('[data-testid="filter-category"]')
  await page.waitForFunction(
    () => [...document.querySelectorAll('[data-testid="filter-category"] option')].some((o) => o.value === 'weather'),
    { timeout: 10000 },
  ).catch(() => {})
  const categoryValues = await categorySelect.locator('option').evaluateAll((options) =>
    options.map((option) => ({ value: option.value, label: option.textContent?.trim() ?? '' })),
  )
  await categorySelect.selectOption('weather').catch(() => {})
  await sleep(400)
  const categoryRows = await visibleRows()
  const visibleCategories = await page.$$eval(RAW_ROW, (els) => [
    ...new Set(els.map((el) => el.getAttribute('data-category') || '')),
  ])
  ok(
    'category filter = Weather (slug-derived)',
    categoryRows.length > 0 && visibleCategories.length === 1 && visibleCategories[0] === 'weather',
    `options: ${categoryValues.map((option) => option.label).join(', ')}; visible: ${visibleCategories.join(',')}`,
  )
  await categorySelect.selectOption('')
  await sleep(300)

  // ---- 4. explicit pagination past the 3000-offset cap
  let lastTotal = rc.total
  let stall = 0
  const loadMore = page.locator('[data-testid="load-more"]')
  for (let i = 0; i < 12; i++) {
    rc = await rowCounts()
    if (rc.total >= 3600 || /end of history|cursor=end| END/.test(rc.text)) break
    if ((await loadMore.count()) === 0) break
    await loadMore.click()
    await page.waitForFunction(
      (previousTotal) => {
        const status = document.querySelector('[data-testid="status"]')
        const total = Number(status?.getAttribute('data-total') || 0)
        const button = document.querySelector('[data-testid="load-more"]')
        return total > previousTotal || !button || !button.hasAttribute('disabled')
      },
      lastTotal,
      { timeout: 20000 },
    ).catch(() => {})
    await sleep(300)
    rc = await rowCounts()
    if (rc.total === lastTotal) stall++
    else (stall = 0), (lastTotal = rc.total)
    if (stall > 2) break
  }
  rc = await rowCounts()
  const fetchedSoFar = fetchedItems
  const hitCap = apiCalls.some((c) => c.offset === '3000' && !c.type && !c.side)
  const windowJump = apiCalls.some((c) => c.offset === '0' && c.end && !c.type && !c.side)
  ok(
    'load more continues past offset 3000 (time-window jump)',
    rc.total > 3500 && hitCap && windowJump,
    `${rc.total} rows loaded; offset=3000 requested: ${hitCap}; offset=0&end=… requested: ${windowJump}`,
  )
  ok(
    'no duplicate rows after window jump',
    !consoleIssues.some((c) => c.includes('same key')),
    `${fetchedSoFar} items fetched → ${rc.total} unique rendered (${fetchedSoFar - rc.total} boundary dupes dropped)`,
  )

  // ---- back-to-top after deep scroll
  await scrollContainer('bottom')
  await sleep(300)
  const topBtn = page.locator('[data-testid="back-to-top"]')
  const topVisibleAfterScroll = await topBtn.isVisible().catch(() => false)
  if (topVisibleAfterScroll) await topBtn.click()
  await sleep(500)
  const scrollTopNow = await page.$eval('.table-container', (el) => el.scrollTop)
  ok(
    'back-to-top pill appears after deep scroll and returns to top',
    topVisibleAfterScroll && scrollTopNow < 50,
    `visible=${topVisibleAfterScroll}, scrollTop after click=${scrollTopNow}`,
  )
  await scrollContainer(0)

  // ---- 5. type filter (select order: type, side, outcome)
  const typeSelect = page.locator('select').nth(0)
  await typeSelect.selectOption('REDEEM')
  await waitForRows('Redeem')
  await sleep(400)
  let rows = await visibleRows()
  ok(
    'type filter = Redeem (server-side)',
    rows.length > 0 && rows.every((r) => r.type === 'Redeem') && apiCalls.some((c) => c.type === 'REDEEM'),
    `${rows.length} visible, types: ${[...new Set(rows.map((r) => r.type))].join(',')}`,
  )
  await typeSelect.selectOption('CONVERSION')
  await waitForRows('Convert')
  await sleep(400)
  rows = await visibleRows()
  ok(
    'type filter = Convert',
    rows.length > 0 && rows.every((r) => r.type === 'Convert' && r.price === '--'),
    `${rows.length} visible`,
  )

  // ---- 6. side filter
  await typeSelect.selectOption('')
  await waitForRows()
  await sleep(600)
  const sideSelect = page.locator('select').nth(1)
  await sideSelect.selectOption('SELL')
  await waitForRows()
  await sleep(900)
  rows = await visibleRows()
  ok(
    'side filter = Sell (server-side)',
    rows.length > 0 && rows.every((r) => r.side === 'Sell') && apiCalls.some((c) => c.side === 'SELL'),
    `${rows.length} visible, sides: ${[...new Set(rows.map((r) => r.side))].join(',')}`,
  )

  // ---- 7. outcome filter (client-side)
  await sideSelect.selectOption('')
  await waitForRows()
  await sleep(800)
  const outcomeSelect = page.locator('select').nth(2)
  await outcomeSelect.selectOption('No')
  await sleep(800)
  rows = await visibleRows()
  let oc = await rowCounts()
  ok(
    'outcome filter = No (client-side)',
    rows.length > 0 && rows.every((r) => r.outcome === 'No') && oc.shown < oc.total,
    `${oc.shown} of ${oc.total} shown; outcomes visible: ${[...new Set(rows.map((r) => r.outcome))].join(',')}`,
  )
  await outcomeSelect.selectOption('')

  // ---- 8. URL address param → different wallet
  await page.goto(`${APP_URL}/?address=${OTHER}`)
  await sleep(3000)
  rc = await rowCounts()
  const urlParam = await page.evaluate(() => new URLSearchParams(location.search).get('address'))
  ok(
    'URL address param loads a different wallet',
    rc.total > 0 && apiCalls.some((c) => c.user === OTHER) && urlParam === OTHER,
    `${rc.total} rows for ${OTHER.slice(0, 10)}…, ?address=${(urlParam || '').slice(0, 10)}…`,
  )

  // ---- probes ----
  await page.goto(`${APP_URL}/?address=abc`)
  await sleep(600)
  ok(
    '🔍 invalid address → hint, no request, no crash',
    (await page.locator('.hint').count()) === 1 && !apiCalls.some((c) => c.user === 'abc'),
    (await page.locator('.hint').innerText()).trim(),
  )

  const EMPTY = '0x0000000000000000000000000000000000000001'
  await page.goto(`${APP_URL}/?address=${EMPTY}`)
  await sleep(2500)
  let txt = await statusText()
  let cursor = await statusCursor()
  ok(
    '🔍 wallet with no history → "No rows." + end of history',
    (await page.locator('[data-testid="empty"]').count()) === 1 && (cursor === 'end' || /end of history|cursor=end| END/.test(txt)),
    `${(await page.locator('[data-testid="empty"]').innerText().catch(() => '')).trim()} | ${txt.slice(-40)}`,
  )

  await page.goto(`${APP_URL}/?address=${'0x' + DEFAULT.slice(2).toUpperCase()}`)
  await waitForRows()
  await sleep(500)
  rc = await rowCounts()
  ok('🔍 uppercase-hex address still loads', rc.total > 0, `${rc.total} rows`)

  for (const v of ['TRADE', 'REDEEM', '', 'CONVERSION', 'TRADE', '']) {
    await typeSelect.selectOption(v)
    await sleep(120)
  }
  await waitForRows()
  await sleep(2000)
  rc = await rowCounts()
  const errs = consoleIssues.filter((c) => !c.includes('React DevTools'))
  ok('🔍 rapid filter toggling → no errors, rows intact', rc.total > 0 && errs.length === 0, errs[0] || `${rc.total} rows`)

  // ---- responsive checks ----
  if (isMobile) {
    const docScrollW = await page.evaluate(() => document.documentElement.scrollWidth)
    const docClientW = await page.evaluate(() => document.documentElement.clientWidth)
    ok(
      'no horizontal page scroll at 390px',
      docScrollW <= docClientW + 1,
      `scrollWidth=${docScrollW}, clientWidth=${docClientW}`,
    )

    const tableScrollW = await page.$eval('.table-container', (el) => el.scrollWidth)
    const tableClientW = await page.$eval('.table-container', (el) => el.clientWidth)
    ok(
      'mobile: table scrolls horizontally inside container',
      tableScrollW > tableClientW,
      `table scrollWidth=${tableScrollW}, clientWidth=${tableClientW}`,
    )

    const rowBox = await page.locator(RAW_ROW).first().boundingBox()
    ok('mobile: dense raw row is compact', !!rowBox && rowBox.height <= 36, `${rowBox ? Math.round(rowBox.height) : 0}px`)

    await page.screenshot({ path: '/tmp/pm_qa_mobile_top.png' })
    await scrollContainer(900)
    await sleep(400)
    await page.screenshot({ path: '/tmp/pm_qa_mobile_rows.png' })
    await scrollContainer(0)
  } else {
    const firstCityText = (await page.locator(`${RAW_ROW} [role="cell"]`).first().innerText().catch(() => '')).trim()
    const cityHeaderVisible = await page.locator('[data-testid="raw-header"] [role="columnheader"]:has-text("City")').first().isVisible()
    ok(
      'desktop: raw city shown as sticky first column',
      firstCityText.length > 0 && cityHeaderVisible,
      `city="${firstCityText.slice(0, 36)}", header vis=${cityHeaderVisible}`,
    )
    await page.screenshot({ path: '/tmp/pm_qa_desktop.png' })
  }

  console.log(`\n-- [${isMobile ? 'M' : 'D'}] sample API calls --`)
  for (const c of apiCalls.slice(0, 8)) console.log('  ', JSON.stringify(c))
  console.log(`-- [${isMobile ? 'M' : 'D'}] console issues --`)
  console.log(errs.length ? errs.join('\n') : '  none')

  const fails = results.filter((r) => !r.pass).length
  console.log(`\n[${label}] ${results.length - fails}/${results.length} checks passed`)
  await browser.close()
  return fails
}

const arg = process.argv[2]
const modes = arg === 'desktop' ? ['desktop'] : arg === 'mobile' ? ['mobile'] : ['desktop', 'mobile']
let totalFails = 0
for (const m of modes) totalFails += await runSweep(m)

console.log(`\n========== TOTAL: ${totalFails === 0 ? 'ALL GREEN' : `${totalFails} FAILURE(S)`} ==========`)
process.exit(totalFails ? 1 : 0)
