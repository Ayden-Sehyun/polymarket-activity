// Smoke test against the deployed Pages URL (iPhone viewport).
// Bare page must show the address prompt (no baked-in default);
// ?address=… must load that wallet.
import { chromium, devices } from 'playwright'

const base = (process.argv[2] ?? 'https://onedam.pages.dev').replace(/\/$/, '')
const wallet = process.argv[3] ?? '0x0c7c5204404e9d5402d258fedac59c7212bae4cb'
const browser = await chromium.launch()
const page = await browser.newPage({ ...devices['iPhone 14'] })
let failures = 0

const ok = (name, pass, detail = '') => {
  if (!pass) failures += 1
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

page.on('pageerror', (e) => console.log('pageerror:', e.message))

let apiCalls = 0
page.on('request', (r) => {
  if (r.url().startsWith('https://data-api.polymarket.com/')) apiCalls++
})

try {
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-testid="prompt"]', { timeout: 20000 })
  ok(`bare ${base}`, apiCalls === 0, `prompt shown, ${apiCalls} api calls`)

  await page.goto(`${base}/?address=${wallet}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-testid="raw-row"]', { timeout: 30000 })
  const rows = await page.locator('[data-testid="raw-row"]').count()
  const status = (await page.locator('[data-testid="status"]').innerText()).trim()
  const name = (await page.locator('[data-testid="profile-name"]').innerText()).trim()
  ok(
    `?address=${wallet.slice(0, 10)}...`,
    rows > 0 && status.length > 0 && name.length > 0,
    `${rows} rows rendered, status="${status}", profile="${name}"`,
  )
  await page.screenshot({ path: '/tmp/pm_prod_mobile.png' })
} catch (err) {
  failures += 1
  console.error('FAIL  smoke threw:', err instanceof Error ? err.message : err)
} finally {
  await browser.close()
}

process.exit(failures ? 1 : 0)
