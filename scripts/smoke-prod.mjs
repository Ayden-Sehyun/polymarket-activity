// Smoke test against the deployed Pages URL (iPhone viewport).
// Bare page must show the address prompt (no baked-in default);
// ?address=… must load that wallet.
import { chromium, devices } from 'playwright'

const base = process.argv[2] ?? 'https://onedam.pages.dev'
const wallet = process.argv[3] ?? '0x0c7c5204404e9d5402d258fedac59c7212bae4cb'
const browser = await chromium.launch()
const page = await browser.newPage({ ...devices['iPhone 14'] })
page.on('pageerror', (e) => console.log('pageerror:', e.message))

let apiCalls = 0
page.on('request', (r) => {
  if (r.url().startsWith('https://data-api.polymarket.com/')) apiCalls++
})

await page.goto(base, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-testid="prompt"]', { timeout: 20000 })
console.log(`PASS  bare ${base} — prompt shown, ${apiCalls} api calls`)

await page.goto(`${base}/?address=${wallet}`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-testid="raw-row"]', { timeout: 30000 })
const rows = await page.locator('[data-testid="raw-row"]').count()
const status = (await page.locator('[data-testid="status"]').innerText()).trim()
const name = (await page.locator('[data-testid="profile-name"]').innerText()).trim()
console.log(`PASS  ?address=${wallet.slice(0, 10)}… — ${rows} rows rendered, status="${status}", profile="${name}"`)
await page.screenshot({ path: '/tmp/pm_prod_mobile.png' })
await browser.close()
