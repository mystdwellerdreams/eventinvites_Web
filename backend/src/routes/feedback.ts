import { Router } from 'express'
import multer from 'multer'
import type { Request, Response, NextFunction } from 'express'
import { asyncHandler, AppError } from '../middleware/errorHandler'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { feedbackSchema } from '../utils/validation'
import { logActivity, actorName } from '../utils/activityLog'
import { MAX_UPLOAD_BYTES, saveUpload } from '../utils/storage'
import { sanitizeHtml } from '../utils/sanitizeHtml'
import { isGuest } from '../utils/roles'
import { ensureChat, postChatMessage } from '../utils/chats'
import { requireCaptcha } from '../utils/captcha'

const router = Router()

/**
 * Feedback takes any kind of file, not just images, but keeps the same
 * 5 MB ceiling as every other upload. As elsewhere the bytes are held in
 * memory and handed straight to the storage layer.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
})

const feedbackUpload = (req: Request, res: Response, next: NextFunction) =>
  upload.single('file')(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        next(
          new AppError(
            400,
            `File must be smaller than ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB`
          )
        )
        return
      }
      next(new AppError(400, err.message))
      return
    }
    next(err)
  })

/**
 * Sends a message to the administrators. Any signed-in account may use it,
 * guests included, and the entry lands in the activity log's feedback
 * section, where an administrator reads it.
 *
 * For an approved account the message also opens the feedback
 * conversation, so it can be answered in the Messages section rather than
 * through a new notification. Guests have no Messages section to open it
 * in, so their feedback stays in the log only.
 */
router.post(
  '/',
  authMiddleware,
  feedbackUpload,
  requireCaptcha('feedback'),
  asyncHandler(async (req: AuthRequest, res) => {
    const data = feedbackSchema.parse(req.body)
    const message = sanitizeHtml(data.message)
    if (!message.trim()) {
      throw new AppError(400, 'Write a message first')
    }

    let attachment: { url: string; name: string; size: number } | null = null
    if (req.file) {
      const saved = await saveUpload(req.file)
      attachment = {
        url: saved.url,
        name: req.file.originalname,
        size: req.file.size,
      }
    }

    await logActivity({
      category: 'FEEDBACK',
      actorId: req.user!.id,
      actorName: await actorName(req.user!.id),
      message,
      meta: attachment ? { attachment } : null,
    })

    if (!isGuest(req.user!.role)) {
      const chat = await ensureChat('SUPPORT', req.user!.id)
      // The activity log already carries the message with its
      // attachment, so the conversation does not log a second entry.
      await postChatMessage(chat.id, req.user!.id, message, { log: false })
    }

    res.status(201).json({ message: 'Feedback sent' })
  })
)

export { router }
