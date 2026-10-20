import { readFileSync, writeFileSync } from 'node:fs'

/**
 * Puts the Hyperdrive identifier into the Worker's configuration.
 *
 * The identifier is a resource id rather than a secret, so it can be
 * committed in wrangler.jsonc. It is also a build setting on the platform
 * that runs the deploy, and this script fills it in from there, so the
 * configuration can be left with a placeholder and the deploy can still
 * succeed.
 *
 * The value comes from CLOUDFLARE_HYPERDRIVE_ID. When it is not set the
 * configuration is left as it is.
 */
const PLACEHOLDER = 'REPLACE_WITH_THE_ID_FROM_WRANGLER_HYPERDRIVE_CREATE'
const CONFIG = 'wrangler.jsonc'

const id = process.env.CLOUDFLARE_HYPERDRIVE_ID
if (!id) {
  console.log('CLOUDFLARE_HYPERDRIVE_ID is not set; leaving the configuration as it is.')
  process.exit(0)
}

if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
  console.error(
    `CLOUDFLARE_HYPERDRIVE_ID is not a UUID: ${id}\n` +
      'Run `npx wrangler hyperdrive list` to see the identifier.'
  )
  process.exit(1)
}

const config = readFileSync(CONFIG, 'utf8')
if (!config.includes(PLACEHOLDER)) {
  console.log('The configuration already names a Hyperdrive config; leaving it as it is.')
  process.exit(0)
}

writeFileSync(CONFIG, config.replace(PLACEHOLDER, id))
console.log(`Put the Hyperdrive config ${id} into ${CONFIG}.`)
