// Probe: kill the network to data-api mid-session, expect the error banner
// with a working retry button. Run: node scripts/qa-error.mjs
import { chromium } from 'playwright'

const ROW = '[data-testid="raw-row"]'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } })
let failures = 0

const ok = (name, pass, detail = '') => {
  if (!pass) failures += 1
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

page.on('pageerror', (e) => console.log('pageerror:', e.message))

try {
  await page.goto('http://localhost:5173/?address=0x774728ed9264a5ca242e8bd7952a869df318fe40')
  await page.waitForSelector(ROW, { timeout: 20000 })
  await page.locator('[data-testid="filter-category"]').selectOption('')

  // block the API, then force a fresh query (filter change = new queryKey)
  await page.route('https://data-api.polymarket.com/**', (route) => route.abort())
  await page.locator('[data-testid="filter-type"]').selectOption('REDEEM')
  await page.waitForSelector('[data-testid="error"]', { timeout: 15000 })
  const msg = (await page.locator('[data-testid="error"]').innerText()).trim()
  ok('error banner shown', msg.length > 0, JSON.stringify(msg.slice(0, 80)))
  await page.screenshot({ path: '/tmp/pm_qa_error.png' })

  // unblock and retry
  await page.unroute('https://data-api.polymarket.com/**')
  await page.locator('[data-testid="error"] button').click()
  await page.waitForSelector(ROW, { timeout: 20000 })
  await page.waitForFunction(
    () => {
      const rows = [...document.querySelectorAll('[data-testid="raw-row"]')]
      if (rows.length === 0) return false
      return rows.every((r) => {
        const t = r.querySelector('[data-testid="cell-type"]')?.textContent?.trim()
        return t === 'Redeem'
      })
    },
    undefined,
    { timeout: 15000 },
  )
  const types = await page.$$eval(ROW, (rows) =>
    [...new Set(rows.map((r) => r.querySelector('[data-testid="cell-type"]')?.textContent?.trim()))],
  )
  const errGone = (await page.locator('[data-testid="error"]').count()) === 0
  ok('retry recovers', errGone && types.length === 1 && types[0] === 'Redeem', `error visible=${!errGone}, types=${types}`)
} catch (err) {
  failures += 1
  console.error('FAIL  qa-error threw:', err instanceof Error ? err.message : err)
} finally {
  await browser.close()
}

process.exit(failures ? 1 : 0)
