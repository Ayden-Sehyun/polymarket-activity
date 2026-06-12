import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' })
await page.goto('https://polymarket.com/@appahenduocian?tab=activity', { waitUntil: 'domcontentloaded', timeout: 45000 })
await page.waitForTimeout(5000)
const out = await page.evaluate(() => {
  const vars = {}
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules } catch { continue }
    for (const r of rules) if (r.selectorText && /:root|html/.test(r.selectorText) && r.style)
      for (const n of r.style) if (/^--(red|blue|brand|green|yellow|no|yes)/.test(n)) vars[n] = r.style.getPropertyValue(n).trim()
  }
  const chip = [...document.querySelectorAll('span,div')].find(e => /^(Yes|No)\s/.test(e.textContent.trim()) && e.textContent.trim().length < 12 && e.childElementCount <= 1)
  const cs = chip ? getComputedStyle(chip) : null
  const rowEl = [...document.querySelectorAll('span,div,p')].find(e => e.childElementCount === 0 && /shares$/.test(e.textContent.trim()))
  const ts = rowEl ? getComputedStyle(rowEl) : null
  return { vars, chipSample: chip && { text: chip.textContent.trim(), color: cs.color, bg: cs.backgroundColor, fs: cs.fontSize, fw: cs.fontWeight, br: cs.borderRadius, pad: cs.padding }, sharesSample: rowEl && { text: rowEl.textContent.trim(), color: ts.color, fs: ts.fontSize } }
})
console.log(JSON.stringify(out, null, 1))
await browser.close()
