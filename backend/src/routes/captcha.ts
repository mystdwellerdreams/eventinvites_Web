import { Router } from 'express'
import { asyncHandler } from '../middleware/errorHandler'
import {
  answerFallback,
  issueFallbackChallenge,
  mintFallbackToken,
} from '../utils/captcha'

const router = Router()

/**
 * The fallback challenge, for when the Cloudflare widget cannot load. The
 * question comes from the server and the answer is checked against it, so
 * the route is safe to call unauthenticated: there is nothing to learn
 * from it beyond the two numbers being added.
 */
router.post(
  '/fallback',
  asyncHandler(async (_req, res) => {
    res.json(issueFallbackChallenge())
  })
)

/** Answers a fallback challenge and, if it is right, mints a token the
 *  protected actions accept in place of a Cloudflare one. */
router.post(
  '/fallback/verify',
  asyncHandler(async (req, res) => {
    const { id, answer, action } = (req.body ?? {}) as {
      id?: string
      answer?: string
      action?: string
    }
    if (!id || !answer) {
      res.status(400).json({ error: 'Answer the challenge.' })
      return
    }
    if (!answerFallback(id, answer)) {
      res.status(400).json({ error: 'That answer is not right. Try a new challenge.', code: 'CAPTCHA_FAILED' })
      return
    }
    res.json({ token: mintFallbackToken(action || 'unknown') })
  })
)

export { router }
