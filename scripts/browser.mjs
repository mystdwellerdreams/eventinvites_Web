/**
 * A very small browser driver, over the DevTools protocol.
 *
 * It is enough to open a page, run code in it and put a file into a file
 * input — which is what checking an upload needs. Chrome is already on the
 * machine, so nothing is installed.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9222

export async function launchBrowser() {
  const profile = mkdtempSync(join(tmpdir(), 'eventinvites-chrome-'))
  const child = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      '--remote-allow-origins=*',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--window-size=1280,900',
    ],
    { stdio: 'ignore' }
  )

  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      if (res.ok) break
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  return {
    close() {
      child.kill()
      try {
        rmSync(profile, { recursive: true, force: true })
      } catch {
        // Leaving the profile behind is harmless.
      }
    },
  }
}

/**
 * Opens a page and returns a handle to drive it.
 *
 * `options.initScript` runs in the page before any of its own scripts, which
 * is how the app bundle is made to look like the native shell it runs in.
 */
export async function openPage(url, options = {}) {
  // A blank target, navigated afterwards: the endpoint that takes an address
  // is not consistent across versions.
  const res = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })
  const target = await res.json()
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })

  let nextId = 0
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) reject(new Error(message.error.message))
      else resolve(message.result)
    }
  })

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId
      pending.set(id, { resolve, reject })
      socket.send(JSON.stringify({ id, method, params }))
    })

  await send('Page.enable')
  await send('DOM.enable')
  await send('Runtime.enable')

  // The script is registered before the page is opened, so it is in place
  // before the bundle runs.
  if (options.initScript) {
    await send('Page.addScriptToEvaluateOnNewDocument', { source: options.initScript })
  }

  const page = {
    send,
    async goto(target) {
      await send('Page.navigate', { url: target })
      await new Promise((resolve) => setTimeout(resolve, 1200))
    },
    /** Runs code in the page and returns its value. */
    async evaluate(expression) {
      const result = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      })
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description ?? 'the page threw')
      }
      return result.result.value
    },
    /** Puts a file into the first file input matching a selector. */
    async setFileInput(selector, filePath) {
      const { root } = await send('DOM.getDocument', { depth: -1 })
      const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector })
      if (!nodeId) throw new Error(`no file input matched ${selector}`)
      await send('DOM.setFileInputFiles', { files: [filePath], nodeId })
    },
    close() {
      socket.close()
    },
  }

  await page.goto(url)
  return page
}
