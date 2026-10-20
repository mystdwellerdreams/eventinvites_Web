/**
 * Reading the environment.
 *
 * A value copied out of a .env file arrives with its quotes still around,
 * because that is how the local files are written. A connection string that
 * begins with a quote is not a URL, and a key that begins with one is not a
 * key, so a deployment configured from those files fails in ways that look
 * like something else entirely: the database is "not a valid URL" and the
 * upload store's key is "not valid".
 *
 * The quotes are therefore stripped here, wherever a value is read, so a value
 * pasted from the local files works wherever it is set.
 */

/** The value of an environment variable, with the quotes taken off. */
export function envValue(name: string): string | undefined {
  const raw = process.env[name]
  if (raw === undefined) return undefined
  const trimmed = raw.trim()
  if (trimmed.length >= 2 && /^["'].*["']$/.test(trimmed)) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

/** The value of an environment variable, or an empty string. */
export function envValueOrEmpty(name: string): string {
  return envValue(name) ?? ''
}

/** Whether a variable was set with its quotes still around. */
export function hasQuotes(name: string): boolean {
  const raw = process.env[name]
  if (raw === undefined) return false
  const trimmed = raw.trim()
  return trimmed.length >= 2 && /^["'].*["']$/.test(trimmed)
}
