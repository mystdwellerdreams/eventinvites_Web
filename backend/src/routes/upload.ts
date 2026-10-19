import { Router } from 'express'
import multer from 'multer'
import type { Request, Response, NextFunction } from 'express'
import { asyncHandler, AppError } from '../middleware/errorHandler'
import { authMiddleware, AuthRequest, requireAdmin } from '../middleware/auth'
import {
  ALLOWED_IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
  saveUpload,
} from '../utils/storage'

/**
 * Files are held in memory and handed to the storage layer. Writing to a
 * temporary directory would fail on Vercel, where the filesystem is read-only
 * outside /tmp and does not persist between invocations.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new AppError(400, 'Only JPEG, PNG, GIF or WebP images are allowed'))
    }
  },
  limits: { fileSize: MAX_UPLOAD_BYTES },
})

const router = Router()

const singleFile =
  (field: string) =>
  (req: Request, res: Response, next: NextFunction) =>
    upload.single(field)(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          next(new AppError(400, `Image must be smaller than ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB`))
          return
        }
        next(new AppError(400, err.message))
        return
      }
      next(err)
    })

const storeUpload = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.file) {
    throw new AppError(400, 'No file uploaded')
  }
  const saved = await saveUpload(req.file)
  res.json({ url: saved.url })
})

router.post('/avatar', authMiddleware, singleFile('avatar'), storeUpload)

router.post('/cover', authMiddleware, requireAdmin, singleFile('cover'), storeUpload)

export { router }