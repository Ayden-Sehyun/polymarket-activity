// Research: screenshot the reference Polymarket profile page and dump the
// computed styles / tokens we need to copy. Run: node scripts/inspect-reference.mjs
import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
})
await page.goto('https://polymarket.com/@appahenduocian?tab=activity', {
  waitUntil: 'domcontentloaded',
  timeout: 45000,
})
await page.waitForTimeout(6000)
await page.screenshot({ path: '/tmp/pm_ref_full.png', fullPage: false })
await page.mouse.wheel(0, 600)
await page.waitForTimeout(1500)
await page.screenshot({ path: '/tmp/pm_ref_scrolled.png' })

const tokens = await page.evaluate(() => {
  const cs = (el) => (el ? getComputedStyle(el) : null)
  const pick = (s, props) => {
    const out = {}
    if (s) for (const p of props) out[p] = s.getPropertyValue(p)
    return out
  }
  const body = cs(document.body)
  const link = cs(document.querySelector('a'))
  // grab a few elements that contain typical activity row text
  const sample = (txt) => {
    const els = [...document.querySelectorAll('div,span,p,a')].filter(
      (e) => e.childElementCount === 0 && e.textContent.trim() === txt,
    )
    return els[0] ? pick(cs(els[0]), ['color', 'font-size', 'font-weight', 'background-color']) : null
  }
  // collect the page's CSS custom properties from :root
  const rootStyle = cs(document.documentElement)
  const vars = {}
  for (const sheet of document.styleSheets) {
    let rules
    try {
      rules = sheet.cssRules
    } catch {
      continue
    }
    for (const r of rules) {
      if (r.selectorText === ':root' || r.selectorText === 'html' || r.selectorText === ':root, html') {
        for (const name of r.style) if (name.startsWith('--')) vars[name] = r.style.getPropertyValue(name).trim()
      }
    }
  }
  return {
    body: pick(body, ['background-color', 'color', 'font-family', 'font-size']),
    link: pick(link, ['color', 'text-decoration-line']),
    htmlBg: pick(rootStyle, ['background-color']),
    sampleBuy: sample('Bought'),
    sampleSell: sample('Sold'),
    sampleYes: sample('Yes'),
    sampleNo: sample('No'),
    cssVarCount: Object.keys(vars).length,
    cssVars: Object.fromEntries(Object.entries(vars).slice(0, 80)),
  }
})
console.log(JSON.stringify(tokens, null, 1))
await browser.close()
