import { spawnSync } from 'child_process'
import { writeFileSync, existsSync, mkdirSync } from 'fs'
import path from 'path'

const GCLOUD = '"C:\\google-cloud-sdk allusers\\google-cloud-sdk\\bin\\gcloud.cmd"'
const PROJECT_ID = 'event-invites-app'
const ANDROID_PACKAGE = 'club.kolymafia.eventinvites'

async function runGcloud(args) {
  const result = spawnSync(GCLOUD, args, {
    shell: 'cmd.exe',
    encoding: 'utf-8',
    timeout: 60000
  })
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    status: result.status
  }
}

async function main() {
  console.log('=== Firebase Android App Setup ===\n')

  // Get access token using user account
  const tokenResult = await runGcloud([
    'auth', 'print-access-token',
    '--account=mystdwellerdreams@gmail.com'
  ])
  const accessToken = tokenResult.stdout.trim()
  console.log('Access token obtained (length:', accessToken.length, ')')

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'X-Goog-User-Project': PROJECT_ID,
    'Content-Type': 'application/json'
  }

  // Step 1: List existing Android apps
  console.log('\n1. Listing existing Android apps...')
  try {
    const resp = await fetch(
      `https://firebase.googleapis.com/v1beta1/projects/${PROJECT_ID}/androidApps`,
      { method: 'GET', headers }
    )
    console.log('   Status:', resp.status)
    if (resp.ok) {
      const data = await resp.json()
      console.log('   Apps:', JSON.stringify(data, null, 2).slice(0, 1000))
    } else {
      console.log('   Body:', (await resp.text()).slice(0, 500))
    }
  } catch (e) {
    console.log('   Error:', e.message)
  }

  // Step 2: Create Android app
  console.log('\n2. Creating Android app...')
  let appId = null
  try {
    const resp = await fetch(
      `https://firebase.googleapis.com/v1beta1/projects/${PROJECT_ID}/androidApps`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          packageName: ANDROID_PACKAGE,
          displayName: 'Event Invites'
        })
      }
    )
    console.log('   Status:', resp.status)
    const body = await resp.text()
    console.log('   Response:', body.slice(0, 1000))

    if (resp.ok) {
      const data = JSON.parse(body)
      const operationName = data.name
      console.log('   Operation name:', operationName)

      // Poll the operation
      if (operationName) {
        console.log('   Polling operation...')
        for (let i = 0; i < 15; i++) {
          await new Promise(r => setTimeout(r, 3000))
          const pollResp = await fetch(
            `https://firebase.googleapis.com/v1beta1/operations/${operationName.split('/').pop()}`,
            {
              method: 'GET',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'X-Goog-User-Project': PROJECT_ID
              }
            }
          )
          console.log(`   Poll ${i+1} status:`, pollResp.status)
          const pollBody = await pollResp.json()
          console.log('   Poll response:', JSON.stringify(pollBody, null, 2).slice(0, 500))

          if (pollBody.done) {
            console.log('   Operation complete!')
            if (pollBody.response) {
              appId = pollBody.response.appId
              console.log('   App ID:', appId)
              console.log('   Response:', JSON.stringify(pollBody.response, null, 2))
            }
            if (pollBody.error) {
              console.log('   Operation error:', pollBody.error)
            }
            break
          }
        }
      }
    }
  } catch (e) {
    console.log('   Error:', e.message)
  }

  // Step 3: If we have an appId, download google-services.json
  if (appId) {
    console.log('\n3. Downloading google-services.json...')
    
    // List apps to find the app name/ID
    try {
      const listResp = await fetch(
        `https://firebase.googleapis.com/v1beta1/projects/${PROJECT_ID}/androidApps`,
        { method: 'GET', headers }
      )
      if (listResp.ok) {
        const listData = await listResp.json()
        const apps = listData.androidApps || listData.apps || []
        console.log('   Found apps:', apps.length)
        
        const ourApp = apps.find(a => a.packageName === ANDROID_PACKAGE)
        if (ourApp) {
          console.log('   Our app:', JSON.stringify(ourApp, null, 2))
          
          // Get the app's download URL or config
          // The androidAppConfig endpoint requires the app name (not just appId)
          // Format: projects/{project}/androidApps/{appId}
          const appName = ourApp.name
          console.log('   App name:', appName)
          
          const configResp = await fetch(
            `https://firebase.googleapis.com/v1beta1/${appName}/androidAppConfig`,
            {
              method: 'GET',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'X-Goog-User-Project': PROJECT_ID
              }
            }
          )
          console.log('   Config status:', configResp.status)
          
          if (configResp.ok) {
            const config = await configResp.json()
            console.log('   Config keys:', Object.keys(config))
            
            if (config.configFile) {
              const androidDir = path.join(process.cwd(), 'android/app')
              if (!existsSync(androidDir)) {
                mkdirSync(androidDir, { recursive: true })
              }
              const configPath = path.join(androidDir, 'google-services.json')
              writeFileSync(configPath, config.configFile)
              console.log('   google-services.json saved to', configPath)
              console.log('   File size:', config.configFile.length, 'bytes')
            }
          } else {
            console.log('   Config error:', await configResp.text())
          }
        }
      }
    } catch (e) {
      console.log('   Error:', e.message)
    }
  }

  console.log('\n=== Setup complete ===')
}

main().catch(console.error)