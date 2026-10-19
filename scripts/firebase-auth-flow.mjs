import WebSocket from 'ws'
import { URL, URLSearchParams } from 'url'

const AUTH_URL = 'https://auth.firebase.tools/login?code_challenge=uyRQZG-mm5Nj6gM4J1keZVvQY6oyaVa3iJggE5zUqQs&session=0162fdcd-74ce-4999-a6a9-d79a71a4d641&attest=AXy1knAimibXo5RDb4iibsypqTgbF8-itGj2h38k9JI'

const GOOGLE_EMAIL = 'mystdwellerdreams@gmail.com'

function createDevToolsClient(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let msgId = 0
  const pending = new Map()
  const listeners = new Map()
  let isOpen = false

  ws.onopen = () => { isOpen = true }
  ws.onclose = () => { isOpen = false }
  ws.onerror = (e) => { console.error('WS error:', e) }
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id !== undefined && msg.id !== null) {
      const { resolve, reject } = pending.get(msg.id) || {}
      if (resolve) {
        pending.delete(msg.id)
        resolve(msg.result)
      }
    }
    const method = msg.method
    if (listeners.has(method)) {
      listeners.get(method).forEach(cb => cb(msg))
    }
  }

  function send(method, params = {}) {
    const id = ++msgId
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })
  }

  function onEvent(method, cb) {
    if (!listeners.has(method)) listeners.set(method, [])
    listeners.get(method).push(cb)
  }

  return { send, onEvent, get isOpen() { return isOpen } }
}

async function main() {
  console.log('Auth URL:', AUTH_URL.slice(0, 100) + '...')
  console.log('Email:', GOOGLE_EMAIL)

  // 1. Create a new tab
  console.log('\n1. Creating new Chrome tab...')
  const listResp = await fetch('http://localhost:9222/json')
  const tabs = await listResp.json()

  let tab
  for (const t of tabs) {
    if (!t.url || t.url === 'about:blank') {
      tab = t
      break
    }
  }
  if (!tab) {
    const newResp = await fetch(`http://localhost:9222/json/new?url=${encodeURIComponent(AUTH_URL)}`, { method: 'PUT' })
    tab = await newResp.json()
  }
  console.log('   Target:', tab.id, 'URL:', (tab.url || '(empty)').slice(0, 80))

  const wsUrl = tab.webSocketDebuggerUrl
  console.log('   WS URL:', wsUrl)

  // 2. Connect to DevTools
  console.log('\n2. Connecting to DevTools...')
  const devtools = createDevToolsClient(wsUrl)
  while (!devtools.isOpen) {
    await new Promise(r => setTimeout(r, 100))
  }
  console.log('   Connected!')

  // 3. Enable domains
  console.log('\n3. Enabling Page and Runtime...')
  await devtools.send('Page.enable')
  await devtools.send('Runtime.enable')

  // 4. Navigate
  console.log('\n4. Navigating to auth URL...')
  await devtools.send('Page.navigate', { url: AUTH_URL })

  // 5. Wait for load
  console.log('\n5. Waiting for page load...')
  let loaded = false
  const loadPromise = new Promise((resolve) => {
    devtools.onEvent('Page.loadEventFired', () => { loaded = true; console.log('   Page loaded!'); resolve() })
  })
  for (let i = 0; i < 30 && !loaded; i++) {
    await new Promise(r => setTimeout(r, 500))
  }
  if (!loaded) await loadPromise
  await new Promise(r => setTimeout(r, 3000))

  // 6. Check current URL
  const getUrl = async () => {
    const res = await devtools.send('Runtime.evaluate', {
      expression: 'window.location.href',
      returnByValue: true,
    })
    return res?.result?.value || 'unknown'
  }

  const currentUrl = await getUrl()
  console.log('\n6. Current URL:', currentUrl.slice(0, 200))

  // 7. Handle the Google sign-in flow
  const maxIterations = 30
  for (let iter = 0; iter < maxIterations; iter++) {
    await new Promise(r => setTimeout(r, 3000))
    
    const url = await getUrl()
    console.log(`\n[${iter+1}] URL: ${url.slice(0, 200)}`)

    // Check if we got the auth code
    if (url.includes('localhost') && url.includes('code=')) {
      const urlObj = new URL(url)
      const code = urlObj.searchParams.get('code')
      if (code) {
        console.log('\n*** AUTH CODE:', code, '***')
        console.log('\n*** Run: firebase login <authorizationCode> ***')
        break
      }
    }

    // If on Google sign-in page, enter email
    if (url.includes('accounts.google.com') && url.includes('identifier')) {
      console.log('   On Google sign-in page, entering email...')

      // First, debug the page structure
      const debugHtml = `
        var body = document.body ? document.body.innerHTML : '';
        var info = {
          buttons: [],
          inputs: [],
          forms: document.querySelectorAll('form').length,
          title: document.title
        };
        var btns = document.querySelectorAll('button, div[role="button"]');
        for (var i = 0; i < btns.length; i++) {
          info.buttons.push({
            text: (btns[i].innerText || '').substring(0, 100),
            id: btns[i].id,
            name: btns[i].name,
            type: btns[i].type,
            disabled: btns[i].disabled
          });
        }
        var inputs = document.querySelectorAll('input');
        for (var i = 0; i < inputs.length; i++) {
          info.inputs.push({
            type: inputs[i].type,
            name: inputs[i].name,
            id: inputs[i].id,
            autocomplete: inputs[i].getAttribute('autocomplete')
          });
        }
        JSON.stringify(info)
      `
      const debugResult = await devtools.send('Runtime.evaluate', {
        expression: debugHtml,
        returnByValue: true,
      })
      const debugInfo = JSON.parse(debugResult?.result?.value || '{}')
      console.log('   Page debug:', JSON.stringify({
        title: debugInfo.title,
        forms: debugInfo.forms,
        inputs: debugInfo.inputs,
        buttons: debugInfo.buttons.map(b => ({ text: b.text, id: b.id, disabled: b.disabled }))
      }, null, 2))
      
      // Fill email
      const fillEmail = `
        var emailInput = document.querySelector('input[type="email"]') || 
                         document.querySelector('input[name="identifier"]') ||
                         document.querySelector('#identifierId') ||
                         document.querySelector('input[autocomplete="username"]');
        if (emailInput) {
          emailInput.value = '${GOOGLE_EMAIL}';
          emailInput.dispatchEvent(new Event('input', { bubbles: true }));
          emailInput.dispatchEvent(new Event('change', { bubbles: true }));
          emailInput.focus();
          'email filled: ' + '${GOOGLE_EMAIL}'
        } else {
          'no email input found'
        }
      `
      const fillResult = await devtools.send('Runtime.evaluate', {
        expression: fillEmail,
        returnByValue: true,
      })
      console.log('   Fill result:', fillResult?.result?.value)
      
      await new Promise(r => setTimeout(r, 1000))

      // Click Next button - try many different selectors
      const clickNext = `
        var nextBtn = null;
        var selectors = [
          '#identifierNext button',
          '#identifierNext',
          'button[type="submit"]',
          'button[name="btnNext"]',
          'button[name="next"]',
          'button[aria-label="Next"]',
          'button[aria-label="Weiter"]',
          '[role="button"][type="button"]',
          'div[role="button"][aria-disabled="false"] span',
          'div[data-idp] button',
          'button span'
        ];
        for (var i = 0; i < selectors.length; i++) {
          nextBtn = document.querySelector(selectors[i]);
          if (nextBtn) {
            break;
          }
        }
        if (!nextBtn) {
          var allBtns = document.querySelectorAll('button');
          for (var i = 0; i < allBtns.length; i++) {
            var txt = (allBtns[i].innerText || '').toLowerCase();
            if (txt.includes('next') || txt.includes('weiter') || txt.includes('weiter') || txt === '') {
              nextBtn = allBtns[i];
              break;
            }
          }
        }
        if (nextBtn) {
          nextBtn.click();
          'clicked next button'
        } else {
          'no next button found'
        }
      `
      const clickResult = await devtools.send('Runtime.evaluate', {
        expression: clickNext,
        returnByValue: true,
      })
      console.log('   Click result:', clickResult?.result?.value)
      
      console.log('   Waiting for password page...')
      continue
    }

    // If on Google password page, enter password
    if (url.includes('accounts.google.com') && (url.includes('pwinput') || url.includes('u/0') || url.includes('passwd') || url.includes('password'))) {
      console.log('   On Google password page, looking for password input...')

      const fillPassword = `
        var passInput = document.querySelector('input[type="password"]') ||
                        document.querySelector('input[name="password"]') ||
                        document.querySelector('#password input');
        if (passInput) {
          'password input found (not filling - needs user input)'
        } else {
          var inputs = document.querySelectorAll('input');
          var types = [];
          for (var i = 0; i < inputs.length; i++) {
            types.push(inputs[i].type + ':' + inputs[i].name + ':' + inputs[i].id);
          }
          'inputs: ' + types.join(', ')
        }
      `
      const passResult = await devtools.send('Runtime.evaluate', {
        expression: fillPassword,
        returnByValue: true,
      })
      console.log('   Password page:', passResult?.result?.value)
      
      console.log('   !!! PASSWORD REQUIRED - MANUAL INTERVENTION NEEDED !!!')
      console.log('   Please enter password manually, then wait for auto-detection...')
      
      // Wait for manual password entry and click Next
      await new Promise(r => setTimeout(r, 15000))
      
      // Click Next on password page
      const clickNextPass = `
        var nextBtn = document.querySelector('#password button[type="submit"]') ||
                      document.querySelector('button[type="submit"]') ||
                      document.querySelector('#submit button') ||
                      document.querySelector('button[name="btnNext"]');
        if (nextBtn) {
          nextBtn.click();
          'clicked password next button'
        } else {
          'no password next button found'
        }
      `
      const clickResult = await devtools.send('Runtime.evaluate', {
        expression: clickNextPass,
        returnByValue: true,
      })
      console.log('   Click result:', clickResult?.result?.value)
      continue
    }

    // If on signin/rejected page, debug it
    if (url.includes('accounts.google.com') && url.includes('rejected')) {
      console.log('   On rejected page, debugging...')

      const debugRejected = `
        var info = {
          title: document.title,
          bodyText: (document.body ? document.body.innerText.substring(0, 2000) : ''),
          buttons: [],
          inputs: []
        };
        var btns = document.querySelectorAll('button, div[role="button"]');
        for (var i = 0; i < btns.length; i++) {
          info.buttons.push({
            text: (btns[i].innerText || '').substring(0, 200),
            id: btns[i].id,
            name: btns[i].name,
            disabled: btns[i].disabled
          });
        }
        var inputs = document.querySelectorAll('input');
        for (var i = 0; i < inputs.length; i++) {
          info.inputs.push({
            type: inputs[i].type,
            name: inputs[i].name,
            id: inputs[i].id
          });
        }
        JSON.stringify(info)
      `
      const debugResult = await devtools.send('Runtime.evaluate', {
        expression: debugRejected,
        returnByValue: true,
      })
      console.log('   Rejected page:', debugResult?.result?.value || 'no value')
      console.log('   On consent page, clicking accept...')

      const clickConsent = `
        var btns = document.querySelectorAll('button');
        var found = null;
        for (var i = 0; i < btns.length; i++) {
          var t = btns[i].innerText || '';
          if (t.includes('Allow') || t.includes('Accept') || t.includes('ОК') || t.includes('consent') || t.includes('Continue')) {
            found = btns[i];
            break;
          }
        }
        if (found) { found.click(); 'clicked: ' + found.innerText }
        else { 'no button found' }
      `
      const consentResult = await devtools.send('Runtime.evaluate', {
        expression: clickConsent,
        returnByValue: true,
      })
      console.log('   Consent result:', consentResult?.result?.value)
      continue
    }
  }

  // Close tab
  try {
    const tabId = tab.id
    await fetch(`http://localhost:9222/json/close/${tabId}`)
    console.log('\nTab closed.')
  } catch (e) {
    console.log('Close error:', e.message)
  }

  console.log('\nAuth flow completed.')
}

main().catch(console.error)