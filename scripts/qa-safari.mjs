// WebKit mobile layout probe for Safari-like rendering issues.
//
//   node scripts/qa-safari.mjs
//   node scripts/qa-safari.mjs --headed
//   node scripts/qa-safari.mjs http://127.0.0.1:5173 --headed
import { devices, webkit } from 'playwright'

const DEFAULT_APP_URL = 'http://localhost:5173'
const DEFAULT_WALLET = '0x774728ed9264a5ca242e8bd7952a869df318fe40'
const ROW = '[data-testid="raw-row"]'
const SCREENSHOT_TOP = '/tmp/pm_qa_safari_top.png'
const SCREENSHOT_SCROLLED = '/tmp/pm_qa_safari_scrolled.png'
const SCREENSHOT_MENU = '/tmp/pm_qa_safari_menu.png'

const args = process.argv.slice(2)
const headed = args.includes('--headed')
const appUrl = args.find((arg) => !arg.startsWith('--')) ?? DEFAULT_APP_URL
const targetUrl = `${appUrl.replace(/\/$/, '')}/?address=${DEFAULT_WALLET}`
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const cities = ['Miami', 'Singapore', 'Milan', 'Wuhan', 'Shanghai', 'Warsaw', 'New York City', 'Hong Kong', 'Taipei']
const temps = ['94-95°F', '33°C', '32°C', '35°C', '<=25°C', '17°C', '104-105°F', '26°C', '28°C']

const mockActivity = (index) => {
  const city = cities[index % cities.length]
  const temp = temps[index % temps.length]
  const isConvert = index % 7 === 0
  const timestamp = 1_781_900_000 - index * 60
  return {
    proxyWallet: DEFAULT_WALLET,
    timestamp,
    conditionId: `condition-${index}`,
    type: isConvert ? 'CONVERSION' : 'TRADE',
    size: 0.5 + index / 10,
    usdcSize: 0.005 + index / 1000,
    transactionHash: `0x${(10_000 + index).toString(16).padStart(64, '0')}`,
    price: isConvert ? 0 : index % 5 === 0 ? 0.999 : 0.001,
    asset: `asset-${index}`,
    side: isConvert ? '' : index % 3 === 0 ? 'SELL' : 'BUY',
    outcomeIndex: index % 2,
    title: isConvert
      ? `Highest temperature in ${city} on June 19?`
      : `Will the highest temperature in ${city} be ${temp} on June 19?`,
    slug: `weather-${city.toLowerCase().replaceAll(' ', '-')}-${index}`,
    icon: '',
    eventSlug: `weather-${city.toLowerCase().replaceAll(' ', '-')}-${Math.floor(index / 3)}`,
    outcome: index % 4 === 0 ? 'No' : 'Yes',
    name: 'Mock',
    pseudonym: 'Mock',
  }
}

const previewRows = Array.from({ length: 50 }, (_, index) => mockActivity(index))
const historyRows = Array.from({ length: 80 }, (_, index) => mockActivity(index))

const failures = []
const ok = (name, pass, detail = '') => {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`)
  if (!pass) failures.push(name)
}

const browser = await webkit.launch({ headless: !headed })
const context = await browser.newContext({
  ...devices['iPhone 14'],
  locale: 'en-US',
})
const page = await context.newPage()
const consoleIssues = []

page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning') {
    consoleIssues.push(`${message.type()}: ${message.text().slice(0, 240)}`)
  }
})
page.on('pageerror', (error) => consoleIssues.push(`pageerror: ${error.message}`))

await context.addInitScript(() => {
  window.localStorage.setItem('activity-options', JSON.stringify({ category: 'weather', autoRefreshMs: '0' }))
  window.localStorage.setItem('activity-sticky-columns', JSON.stringify(['city', 'temp']))
  window.localStorage.removeItem('activity-visible-columns')
})

await context.route('https://data-api.polymarket.com/activity**', async (route) => {
  const url = new URL(route.request().url())
  const rows = url.searchParams.get('limit') === '50' ? previewRows : historyRows
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(rows),
  })
})

await context.route('https://gamma-api.polymarket.com/events/slug/**', async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ category: 'weather', tags: [{ label: 'Weather', slug: 'weather' }] }),
  })
})

await context.route(
  /https:\/\/(polygon\.drpc\.org|1rpc\.io\/matic|polygon-bor-rpc\.publicnode\.com).*/,
  async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x3b9aca00' }),
    })
  },
)

try {
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 })
  await page.waitForSelector(ROW, { timeout: 12_000 })
  await sleep(250)
  await page.screenshot({ path: SCREENSHOT_TOP })

  const safeAreaMetadata = await page.evaluate(() => ({
    viewport: document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '',
    themeColor: document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? '',
    statusBarStyle:
      document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.getAttribute('content') ?? '',
    htmlBackground: getComputedStyle(document.documentElement).backgroundColor,
    rootPaddingTop: getComputedStyle(document.querySelector('.app-root')).paddingTop,
    shellBorderTopWidth: getComputedStyle(document.querySelector('.app-shell')).borderTopWidth,
    topRowBorderTopWidth: getComputedStyle(document.querySelector('.top-status-row')).borderTopWidth,
  }))
  ok(
    'mobile Safari safe area metadata asks for black browser chrome',
    safeAreaMetadata.viewport.includes('viewport-fit=cover') &&
      safeAreaMetadata.themeColor === '#000000' &&
      safeAreaMetadata.statusBarStyle === 'black-translucent' &&
      safeAreaMetadata.htmlBackground === 'rgb(0, 0, 0)' &&
      Number.parseFloat(safeAreaMetadata.rootPaddingTop) >= 2 &&
      safeAreaMetadata.shellBorderTopWidth === '1px' &&
      safeAreaMetadata.topRowBorderTopWidth === '0px',
    JSON.stringify(safeAreaMetadata),
  )

  const pageOverflow = await page.evaluate(() => ({
    htmlScrollWidth: document.documentElement.scrollWidth,
    htmlClientWidth: document.documentElement.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
    bodyClientWidth: document.body.clientWidth,
  }))
  ok(
    'no document-level horizontal scroll on mobile WebKit',
    pageOverflow.htmlScrollWidth <= pageOverflow.htmlClientWidth + 1 &&
      pageOverflow.bodyScrollWidth <= pageOverflow.bodyClientWidth + 1,
    JSON.stringify(pageOverflow),
  )

  const tableOverflow = await page.$eval('.table-container', (el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    clientHeight: el.clientHeight,
  }))
  ok(
    'table owns horizontal overflow',
    tableOverflow.scrollWidth > tableOverflow.clientWidth && tableOverflow.clientHeight > 240,
    JSON.stringify(tableOverflow),
  )

  await page.$eval('.table-container', (el) => {
    el.scrollLeft = 260
  })
  await sleep(200)
  const stickyX = await page.evaluate(() => {
    const read = (scope, col) => {
      const el = document.querySelector(`${scope} [data-col="${col}"]`)
      const rect = el?.getBoundingClientRect()
      return {
        sticky: el?.classList.contains('raw-sticky-cell') ?? false,
        x: rect?.x ?? -1,
        width: rect?.width ?? 0,
        left: Number.parseFloat(el ? getComputedStyle(el).left : '-1'),
      }
    }
    return {
      documentScrollX: window.scrollX,
      containerScrollX: document.querySelector('.table-container')?.scrollLeft ?? 0,
      cityHeader: read('[data-testid="raw-header"]', 'city'),
      cityCell: read('[data-testid="raw-row"]', 'city'),
      tempHeader: read('[data-testid="raw-header"]', 'temp'),
      tempCell: read('[data-testid="raw-row"]', 'temp'),
    }
  })
  ok(
    'sticky columns remain aligned while horizontally scrolled',
    stickyX.documentScrollX === 0 &&
      stickyX.containerScrollX > 0 &&
      stickyX.cityHeader.sticky &&
      stickyX.cityCell.sticky &&
      stickyX.tempHeader.sticky &&
      stickyX.tempCell.sticky &&
      Math.abs(stickyX.cityHeader.x - stickyX.cityCell.x) < 1 &&
      Math.abs(stickyX.tempHeader.x - stickyX.tempCell.x) < 1 &&
      Math.abs(stickyX.tempHeader.left - stickyX.tempCell.left) < 1,
    JSON.stringify(stickyX),
  )

  await page.$eval('.table-container', (el) => {
    el.scrollTop = 420
  })
  await sleep(200)
  const stickyY = await page.evaluate(() => {
    const container = document.querySelector('.table-container')?.getBoundingClientRect()
    const header = document.querySelector('[data-testid="raw-header"] th')?.getBoundingClientRect()
    return {
      containerTop: container?.top ?? -1,
      headerTop: header?.top ?? -1,
      headerBottom: header?.bottom ?? -1,
    }
  })
  ok(
    'table header sticks to the top of the scroll container',
    Math.abs(stickyY.headerTop - stickyY.containerTop) < 1 && stickyY.headerBottom > stickyY.headerTop,
    JSON.stringify(stickyY),
  )
  await page.screenshot({ path: SCREENSHOT_SCROLLED })

  await page.$eval('.table-container', (el) => {
    el.scrollTop = el.scrollHeight
    el.scrollLeft = 260
  })
  await sleep(200)
  const loadMoreMetrics = await page.evaluate(() => {
    const container = document.querySelector('.table-container')?.getBoundingClientRect()
    const row = document.querySelector('[data-testid="load-more-row"]')?.getBoundingClientRect()
    const button = document.querySelector('[data-testid="load-more"]')?.getBoundingClientRect()
    return {
      container: container ? { left: container.left, right: container.right, width: container.width } : null,
      row: row ? { left: row.left, right: row.right, width: row.width } : null,
      button: button ? { left: button.left, right: button.right, width: button.width } : null,
      scrollLeft: document.querySelector('.table-container')?.scrollLeft ?? 0,
    }
  })
  ok(
    'load more footer stays pinned while table is horizontally scrolled',
    loadMoreMetrics.container !== null &&
      loadMoreMetrics.row !== null &&
      loadMoreMetrics.button !== null &&
      loadMoreMetrics.scrollLeft > 0 &&
      Math.abs(loadMoreMetrics.row.left - loadMoreMetrics.container.left) < 1 &&
      loadMoreMetrics.row.width <= loadMoreMetrics.container.width + 1 &&
      loadMoreMetrics.button.left >= loadMoreMetrics.container.left &&
      loadMoreMetrics.button.right <= loadMoreMetrics.container.right,
    JSON.stringify(loadMoreMetrics),
  )

  await page.$eval('.table-container', (el) => {
    el.scrollTop = 0
    el.scrollLeft = 0
  })
  await page.locator('[data-testid="columns-summary"]').click()
  await sleep(150)
  const menu = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="columns-menu"]')
    const rect = panel?.getBoundingClientRect()
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    const hit = rect ? document.elementFromPoint(rect.left + 12, rect.top + 12) : null
    return {
      open:
        document.querySelector('[data-testid="columns-summary"]')?.closest('details')?.hasAttribute('open') ?? false,
      display: panel ? getComputedStyle(panel).display : '',
      position: panel ? getComputedStyle(panel).position : '',
      rect: rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null,
      viewport,
      hitInsidePanel: panel ? panel.contains(hit) : false,
      hitTestId: hit?.getAttribute('data-testid') ?? '',
    }
  })
  ok(
    'fixed column menu is visible and inside the mobile viewport',
    menu.open &&
      menu.display === 'grid' &&
      menu.position === 'fixed' &&
      menu.rect !== null &&
      menu.rect.left >= 0 &&
      menu.rect.top >= 0 &&
      menu.rect.right <= menu.viewport.width + 1 &&
      menu.rect.bottom <= menu.viewport.height + 1 &&
      menu.hitInsidePanel,
    JSON.stringify(menu),
  )
  await page.screenshot({ path: SCREENSHOT_MENU })

  const controlMetrics = await page.evaluate(() => {
    const controls = [...document.querySelectorAll('select, button, summary')]
    return controls.map((el) => {
      const rect = el.getBoundingClientRect()
      const style = getComputedStyle(el)
      return {
        testId: el.getAttribute('data-testid') ?? el.tagName.toLowerCase(),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        fontSize: Number.parseFloat(style.fontSize),
        visible: rect.width > 0 && rect.height > 0,
      }
    })
  })
  const visibleControls = controlMetrics.filter((control) => control.visible)
  const minFontSize = Math.min(...visibleControls.map((control) => control.fontSize))
  ok(
    'top/filter/config controls are measurable in WebKit',
    visibleControls.length >= 8 && visibleControls.every((control) => control.height >= 24),
    `visible=${visibleControls.length}, minFont=${minFontSize}px`,
  )

  const rows = await page.$$eval(ROW, (elements) =>
    elements.slice(0, 12).map((row) => {
      const rect = row.getBoundingClientRect()
      const read = (col) => row.querySelector(`[data-col="${col}"]`)?.textContent?.trim() ?? ''
      return {
        height: rect.height,
        city: read('city'),
        temp: read('temp'),
        time: read('time'),
      }
    }),
  )
  ok(
    'dense rows render with non-empty city/temp/time cells',
    rows.length > 0 &&
      rows.every(
        (row) =>
          row.height <= 38 && row.city.length > 0 && row.temp.length > 0 && /^\d{1,2}:\d{2}\s[AP]M$/.test(row.time),
      ),
    JSON.stringify(rows[0]),
  )

  const realConsoleIssues = consoleIssues.filter((issue) => !issue.includes('Web Inspector'))
  ok('no WebKit console errors or warnings', realConsoleIssues.length === 0, realConsoleIssues[0] ?? '')

  console.log(`screenshots: ${SCREENSHOT_TOP}, ${SCREENSHOT_SCROLLED}, ${SCREENSHOT_MENU}`)
} catch (err) {
  failures.push('script threw')
  console.error('FAIL  script threw:', err instanceof Error ? err.message : err)
} finally {
  await browser.close()
}

console.log(
  `\n========== SAFARI QA: ${failures.length === 0 ? 'ALL GREEN' : `${failures.length} FAILURE(S)`} ==========`,
)
process.exit(failures.length ? 1 : 0)
