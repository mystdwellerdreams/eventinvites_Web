/**
 * Checks the built web app the way GitHub Pages will serve it: a deep link
 * has to reach the app rather than an error page.
 */
const BASE = process.argv[2] || ''
const SERVER = 'http://127.0.0.1:4173'
const PATHS = ['/', '/events/key/abc', '/admin', '/profile', '/messages', '/users']

const results = []
for (const path of PATHS) {
  const res = await fetch(`${SERVER}${BASE}${path}`)
  const body = await res.text()
  const isApp = body.includes('id="root"')
  const asset = body.match(/src="([^"]+\.js)"/)
  let assetOk = false
  if (asset) {
    const assetRes = await fetch(`${SERVER}${asset[1]}`)
    assetOk = assetRes.status === 200
  }
  const ok = isApp && assetOk
  results.push(ok)
  console.log(
    `  ${ok ? 'PASS' : 'FAIL'}  ${(BASE + path).padEnd(32)} status ${res.status}, ${
      isApp ? 'the app' : 'NOT the app'
    }, its script ${assetOk ? 'loads' : 'does not load'}`
  )
}

const passed = results.filter(Boolean).length
console.log(`\n${passed}/${results.length} checks passed`)
process.exitCode = passed === results.length ? 0 : 1
