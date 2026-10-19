import { z } from 'zod'
import { SOCIAL_PLATFORMS, SOCIAL_PLATFORM_SPECS } from './socialPlatforms'
import { ROLE_KEYS } from './roles'
import { isValidPhone, normalizePhone, phoneKey } from './phone'

const phone = z
  .string()
  .trim()
  .min(1, 'Phone number is required')
  .refine(isValidPhone, 'Enter a valid phone number')
  .transform(normalizePhone)

const optionalEmail = z
  .string()
  .trim()
  .email('Enter a valid email address')
  .toLowerCase()
  .optional()
  .or(z.literal(''))

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(50),
  phone,
  email: optionalEmail,
  /** Optional: when omitted the phone number is used as the initial password. */
  password: z
    .string()
    .min(6, 'Password must be at least 6 characters')
    .optional()
    .or(z.literal('')),
  /** An invitation token; without a valid one the account is created as a guest. */
  invite: z.string().trim().max(120).optional().or(z.literal('')),
})

export const createInviteSchema = z.object({
  note: z.string().trim().max(200).optional().or(z.literal('')),
  maxUses: z
    .union([z.number(), z.string()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === null || v === '') return 0
      const n = typeof v === 'number' ? v : Number(v)
      return Number.isFinite(n) && n > 0 ? Math.min(1000, Math.floor(n)) : 0
    }),
  expiresInDays: z
    .union([z.number(), z.string()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === null || v === '') return 0
      const n = typeof v === 'number' ? v : Number(v)
      return Number.isFinite(n) && n > 0 ? Math.min(365, Math.floor(n)) : 0
    }),
})

export const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your name, phone number or email'),
  password: z.string().min(1, 'Password is required'),
})

/** A recovery request identifies the account by its phone number. */
export const requestPasswordResetSchema = z.object({
  phone: phone,
})

/** Setting a new password through a reset link. The token travels in the URL. */
export const resetPasswordSchema = z.object({
  newPassword: z.string().min(6, 'New password must be at least 6 characters').max(200),
})

const optionalUrl = z
  .string()
  .trim()
  .url('Enter a valid URL')
  .optional()
  .or(z.literal(''))

/**
 * A list of links rather than a fixed-key object, so a profile can hold any
 * number of each network. Each URL is rebuilt in the network's own format.
 */
const socialLinkSchema = z.object({
  platform: z.enum(SOCIAL_PLATFORMS, {
    errorMap: () => ({ message: 'Choose a social network' }),
  }),
  value: z.string().trim().min(1, 'Enter the handle or address').max(300),
  label: z.string().trim().max(40).nullish(),
})

export const socialLinksSchema = z
  .array(socialLinkSchema)
  .max(12, 'You can add up to 12 links')
  .optional()
  .superRefine((links, ctx) => {
    for (const [index, link] of (links ?? []).entries()) {
      const spec = SOCIAL_PLATFORM_SPECS[link.platform]
      if (!spec.build(link.value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'value'],
          message: `That does not look like a ${spec.label} handle or address`,
        })
      }
      if (spec.needsLabel && !link.label?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'label'],
          message: 'Give this link a name',
        })
      }
    }
  })

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(50).optional(),
  phone: z.string().trim().refine(isValidPhone, 'Enter a valid phone number').transform(normalizePhone).optional(),
  socialLinks: socialLinksSchema,
})

export const setPasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(6, 'New password must be at least 6 characters').max(200),
})

const hexColor = z
  .string()
  .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Use a hex color like #1f2937')

const bannerAlignment = z.enum(['left', 'center', 'right'], {
  errorMap: () => ({ message: 'Alignment must be left, center or right' }),
})

const bannerVerticalAlignment = z.enum(['top', 'center', 'bottom'], {
  errorMap: () => ({ message: 'Vertical alignment must be top, center or bottom' }),
})

/**
 * Text over the event page's cover image. The two texts are configured
 * independently, the same way a cover banner is, so a page can carry a
 * headline and a paragraph over its cover.
 */
const coverTextSchema = z.object({
  caption: z.string().trim().max(500).optional(),
  captionAlignment: bannerAlignment.optional(),
  captionFontColor: hexColor.optional(),
  captionFontFamily: z.string().trim().max(200).optional(),
  captionFontSize: z.string().trim().max(50).optional(),
  description: z.string().trim().max(2000).optional(),
  descriptionAlignment: bannerAlignment.optional(),
  descriptionFontColor: hexColor.optional(),
  descriptionFontFamily: z.string().trim().max(200).optional(),
  descriptionFontSize: z.string().trim().max(50).optional(),
  verticalAlignment: bannerVerticalAlignment.optional(),
})

export const pageStyleSchema = z.object({
  backgroundColor: hexColor.optional(),
  fontColor: hexColor.optional(),
  fontFamily: z.string().max(200).optional(),
  elementStyles: z
    .record(
      z.object({
        backgroundColor: hexColor.optional(),
        fontColor: hexColor.optional(),
      })
    )
    .optional(),
  coverText: coverTextSchema.nullish(),
})

export const layoutElementSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    'coverImage',
    'description',
    'address',
    'host',
    'price',
    'contactInfo',
    'lists',
  ]),
  order: z.number().int().min(0),
  span: z.union([z.literal(1), z.literal(2)]).optional(),
})

const durationMinutes = z
  .union([z.number(), z.string(), z.null()])
  .optional()
  .transform((value) => {
    // `undefined` means "field not sent", which PATCH must ignore; `null` means
    // "no timeframe", which must overwrite any duration already stored.
    if (value === undefined) return undefined
    if (value === null || value === '') return null
    const parsed = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(parsed) || parsed <= 0) return null
    return Math.min(60 * 24 * 30, Math.round(parsed))
  })

/**
 * The public URL segment for an event. Chosen by the administrator or left
 * blank to generate one; must be safe to drop straight into a path.
 */
export const eventKeySchema = z
  .string()
  .trim()
  .min(3, 'Key must be at least 3 characters')
  .max(64, 'Key must be 64 characters or fewer')
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'Use lowercase letters, digits and single hyphens, e.g. autumn-gala-2026'
  )

export const CURRENCIES = ['$', '₽', '€', '🪙'] as const
export type Currency = (typeof CURRENCIES)[number]

export const currencySchema = z.enum(CURRENCIES, {
  errorMap: () => ({ message: `Currency must be one of: ${CURRENCIES.join(' ')}` }),
})

const imageUrl = z.string().trim().min(1).max(2000)

const priceItems = z
  .array(
    z.object({
      name: z.string().trim().min(1, 'Price item name is required').max(80),
      price: z.number().min(0, 'Price cannot be negative').max(1_000_000),
      currency: currencySchema.optional(),
    })
  )
  .max(30)
  .optional()

export const createEventSchema = z.object({
  title: z.string().trim().min(3, 'Title must be at least 3 characters').max(100),
  key: eventKeySchema.optional(),
  shortDescription: z
    .string()
    .trim()
    .min(10, 'Short description must be at least 10 characters')
    .max(300),
  description: z.string().trim().max(20000).optional().or(z.literal('')),
  dateTime: z.string().datetime({ message: 'Enter a valid date and time' }),
  durationMinutes,
  /// DURATION derives the end from the duration; FIXED uses `endsAt` verbatim.
  endTimeMode: z.enum(['DURATION', 'FIXED']).optional(),
  /// An explicit end time, only meaningful when endTimeMode is FIXED.
  endsAt: z.string().datetime('Enter a valid end time').nullish(),
  afterStartPolicy: z
    .enum(['UNPUBLISH_AT_START', 'KEEP_PUBLISHED_LOCKED', 'OPEN_AFTER_START'], {
      errorMap: () => ({ message: 'Choose how the event behaves once it starts' }),
    })
    .optional(),
  isPublished: z.boolean().optional(),
  visibilityMode: z
    .enum(['ALL', 'INCLUDE', 'EXCLUDE'], {
      errorMap: () => ({ message: 'Visibility must be ALL, INCLUDE or EXCLUDE' }),
    })
    .optional(),
  visibleTagIds: z.array(z.string().uuid('Tags must be valid ids')).max(50).optional(),
  publicTagIds: z.array(z.string().uuid('Tags must be valid ids')).max(50).optional(),
  hostIds: z.array(z.string().uuid('Hosts must be valid ids')).max(20).optional(),
  organizerId: z.string().uuid('Choose a valid organizer').nullish(),
  contactMode: z.enum(['PROFILE', 'CUSTOM']).optional(),
  hostId: z.string().uuid('Select a valid host').optional().or(z.literal('')),
  address: z.string().trim().max(300).optional().or(z.literal('')),
  coverImage: z
    .string()
    .trim()
    .refine((v) => v === '' || /^https?:\/\//.test(v), 'Cover image must be an http(s) URL')
    .optional(),
  /// Every image for the carousel; the first is treated as the cover.
  images: z.array(imageUrl).max(20).optional(),
  price: z.number().min(0, 'Price cannot be negative').optional(),
  currency: currencySchema.optional(),
  contactInfo: z.string().trim().max(300).optional().or(z.literal('')),
  pageStyle: pageStyleSchema.optional(),
  layout: z.array(layoutElementSchema).optional(),
  priceItems,
})

export const updateEventSchema = createEventSchema.partial()

export const createListSchema = z.object({
  name: z.string().trim().min(1, 'List name is required').max(50),
  isDefault: z.boolean().optional(),
})

export const updateListSchema = createListSchema.partial()

export const registerForEventSchema = z.object({
  listId: z.string().uuid('Select a participant list'),
})

export const updateRegistrationSchema = z.object({
  status: z.enum(['PENDING', 'CONFIRMED', 'WAITLIST', 'CANCELLED']).optional(),
  listId: z.string().uuid().optional(),
})

/** Administrator assigns an existing user to one of the event's lists. */
export const assignRegistrationSchema = z.object({
  userId: z.string().uuid('User id is required'),
  listId: z.string().uuid('Select a participant list'),
})

export const updateRoleSchema = z.object({
  role: z.enum(ROLE_KEYS as [string, ...string[]], {
    errorMap: () => ({ message: `Role must be one of: ${ROLE_KEYS.join(', ')}` }),
  }),
})

export const createTagSchema = z.object({
  name: z.string().trim().min(1, 'Tag name is required').max(40),
})

export const updateTagSchema = createTagSchema.partial()

export const setUserTagsSchema = z.object({
  tagIds: z.array(z.string().uuid('Tags must be valid ids')).max(50),
})

/* --------------------------------- banners -------------------------------- */

export const BANNER_SLOT_NAMES = ['LEFT', 'MAIN', 'RIGHT'] as const
export type BannerSlotName = (typeof BANNER_SLOT_NAMES)[number]

export const BANNER_AD_TYPES = [
  'COVER',
  'COUNTER',
  'POLL',
  'CONTACTS',
  'ANNOUNCEMENT',
] as const
export type BannerAdType = (typeof BANNER_AD_TYPES)[number]

const bannerCoverConfig = z.object({
  backgroundType: z.enum(['image', 'color', 'gradient'], {
    errorMap: () => ({ message: 'Choose an image, solid color or gradient' }),
  }),
  imageUrl: z.string().trim().max(2000).optional(),
  color: hexColor.optional(),
  gradientFrom: hexColor.optional(),
  gradientTo: hexColor.optional(),
  /// The headline.
  text: z.string().trim().max(500).optional(),
  alignment: bannerAlignment.optional(),
  fontColor: hexColor.optional(),
  fontFamily: z.string().trim().max(200).optional(),
  fontSize: z.string().trim().max(50).optional(),
  /// The detailed description, with its own style and alignment, so the
  /// banner's two texts are configured independently.
  description: z.string().trim().max(2000).optional(),
  descriptionAlignment: bannerAlignment.optional(),
  descriptionFontColor: hexColor.optional(),
  descriptionFontFamily: z.string().trim().max(200).optional(),
  descriptionFontSize: z.string().trim().max(50).optional(),
  /// Where the text block sits inside the banner.
  verticalAlignment: bannerVerticalAlignment.optional(),
})

const bannerCounterConfig = z.object({
  current: z
    .union([z.number(), z.string()])
    .transform((v) => (typeof v === 'number' ? v : Number(v)))
    .refine((v) => Number.isFinite(v) && v >= 0, 'Current value must be 0 or more')
    .transform((v) => Math.min(1_000_000_000, Math.round(v))),
  target: z
    .union([z.number(), z.string()])
    .transform((v) => (typeof v === 'number' ? v : Number(v)))
    .refine((v) => Number.isFinite(v) && v > 0, 'Target value must be greater than 0')
    .transform((v) => Math.min(1_000_000_000, Math.round(v))),
  style: z.enum(['bar', 'circle'], {
    errorMap: () => ({ message: 'Choose a progress bar or a circle' }),
  }),
  /// What the counter's label shows: a percentage, the current or
  /// target value, or both raw values.
  valueDisplay: z.enum(['percent', 'current', 'target', 'raw'], {
    errorMap: () => ({ message: 'Choose what the counter displays' }),
  }).optional(),
  /// Text shown above the counter.
  label: z.string().trim().max(200).optional(),
  caption: z.string().trim().max(200).optional(),
  details: z.string().trim().max(2000).optional(),
  currency: currencySchema.optional(),
  backgroundType: z.enum(['color', 'gradient', 'image'], {
    errorMap: () => ({
      message: 'Choose a solid color, gradient or image background',
    }),
  }).optional(),
  imageUrl: z.string().trim().max(2000).optional(),
  color: hexColor.optional(),
  gradientFrom: hexColor.optional(),
  gradientTo: hexColor.optional(),
})

const bannerPollOption = z.object({
  id: z.string().min(1).max(64),
  text: z.string().trim().min(1, 'Option text is required').max(200),
  votes: z
    .union([z.number(), z.string()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === null || v === '') return 0
      const n = typeof v === 'number' ? v : Number(v)
      return Number.isFinite(n) && n > 0 ? Math.min(1_000_000_000, Math.round(n)) : 0
    }),
})

const bannerPollConfig = z.object({
  question: z.string().trim().max(300).optional(),
  options: z.array(bannerPollOption).min(2, 'A poll needs at least two options').max(10),
})

const bannerContact = z.object({
  platform: z.enum(['whatsapp', 'telegram', 'phone', 'email', 'link'], {
    errorMap: () => ({ message: 'Choose a contact platform' }),
  }),
  value: z.string().trim().min(1, 'Enter the address').max(300),
  label: z.string().trim().min(1, 'Enter a label').max(40),
})

const bannerContactsConfig = z.object({
  placement: z.enum(['top', 'bottom'], {
    errorMap: () => ({ message: 'Buttons sit at the top or the bottom' }),
  }),
  alignment: bannerAlignment,
  backgroundType: z.enum(['color', 'gradient'], {
    errorMap: () => ({
      message: 'Choose a solid color or gradient background',
    }),
  }).optional(),
  backgroundColor: hexColor.optional(),
  gradientFrom: hexColor.optional(),
  gradientTo: hexColor.optional(),
  /// Filled pills or outlined ones, with their own colours.
  buttonStyle: z.enum(['filled', 'outline'], {
    errorMap: () => ({ message: 'Choose filled or outline buttons' }),
  }).optional(),
  buttonColor: hexColor.optional(),
  buttonFontColor: hexColor.optional(),
  contacts: z.array(bannerContact).min(1, 'Add at least one contact').max(6),
})

const bannerAnnouncementConfig = z.object({
  text: z.string().trim().min(1, 'Announcement text is required').max(2000),
  alignment: bannerAlignment.optional(),
  fontColor: hexColor.optional(),
  fontFamily: z.string().trim().max(200).optional(),
  fontSize: z.string().trim().max(50).optional(),
  backgroundType: z.enum(['color', 'gradient'], {
    errorMap: () => ({
      message: 'Choose a solid color or gradient background',
    }),
  }).optional(),
  backgroundColor: hexColor.optional(),
  gradientFrom: hexColor.optional(),
  gradientTo: hexColor.optional(),
})

/** Config schema per ad type, so each type validates its own shape. */
export const bannerConfigSchemas: Record<BannerAdType, z.ZodTypeAny> = {
  COVER: bannerCoverConfig,
  COUNTER: bannerCounterConfig,
  POLL: bannerPollConfig,
  CONTACTS: bannerContactsConfig,
  ANNOUNCEMENT: bannerAnnouncementConfig,
}

/** Seconds, 1..60, for how long an announcement stays on screen. */
const bannerDuration = z
  .union([z.number(), z.string()])
  .optional()
  .transform((v) => {
    if (v === undefined || v === null || v === '') return 5
    const n = typeof v === 'number' ? v : Number(v)
    return Number.isFinite(n) ? Math.min(60, Math.max(1, Math.round(n))) : 5
  })

const bannerInterval = z
  .union([z.number(), z.string()])
  .transform((v) => {
    if (v === undefined || v === null || v === '') return 5
    const n = typeof v === 'number' ? v : Number(v)
    return Number.isFinite(n) ? Math.min(60, Math.max(2, Math.round(n))) : 5
  })

export const updateBannerSlotSchema = z.object({
  interval: bannerInterval.optional(),
  isActive: z.boolean().optional(),
  /// Whether ad changes in this slot reach the administrator's activity log.
  logChanges: z.boolean().optional(),
})

/* ------------------------------ activity log ------------------------------ */

export const ACTIVITY_CATEGORIES = [
  'REGISTRATION',
  'GUEST_APPROVAL',
  'PASSWORD_RESET',
  'EVENT_CREATED',
  'EVENT_UPCOMING',
  'COMMENT',
  'COMMENT_REPLY',
  'BANNER',
  'FEEDBACK',
] as const

export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number]

/** A message sent through the feedback form, plus an optional attachment. */
export const feedbackSchema = z.object({
  /// Sanitized before storing; the editor emits a restricted HTML subset.
  message: z.string().trim().min(1, 'Write a message first').max(20000),
})

export const updateActivitySettingsSchema = z.object({
  logComments: z.boolean(),
})

/** Query parameters of the activity log listing. */
export const activityQuerySchema = z.object({
  category: z.enum([...ACTIVITY_CATEGORIES, 'ALL'] as const).optional(),
  sort: z.enum(['asc', 'desc']).optional(),
})

/* ------------------------------- notifications ----------------------------- */

/** An administrator's message to one user. */
export const sendMessageSchema = z.object({
  /// Sanitized before storing; plain text is fine too.
  message: z.string().trim().min(1, 'Write a message first').max(5000),
})

/**
 * An organizer's update to the participants of one event. It becomes a
 * broadcast, reaching everyone registered for that event.
 */
export const notifyParticipantsSchema = z.object({
  title: z.string().trim().min(1, 'Give the update a title').max(200),
  message: z.string().trim().min(1, 'Write the update first').max(5000),
})

const bannerAdShape = z.object({
  slotId: z.string().uuid('Select a valid banner slot'),
  type: z.enum(BANNER_AD_TYPES, {
    errorMap: () => ({ message: 'Choose a banner type' }),
  }),
  config: z.record(z.unknown()),
  duration: bannerDuration,
  isActive: z.boolean().optional(),
})

/** Checks the config against the schema of the ad's type. */
const checkBannerConfig = (
  data: { type?: BannerAdType; config?: unknown },
  ctx: z.RefinementCtx
) => {
  // Partial updates that omit the type are checked in the
  // route, against the type already stored.
  if (data.type === undefined || data.config === undefined) return
  const result = bannerConfigSchemas[data.type].safeParse(data.config)
  if (!result.success) {
    for (const issue of result.error.issues) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['config', ...issue.path],
        message: issue.message,
      })
    }
  }
}

export const createBannerAdSchema =
  bannerAdShape.superRefine(checkBannerConfig)

export const updateBannerAdSchema =
  bannerAdShape.partial().superRefine(checkBannerConfig)

export const reorderBannerAdsSchema = z.object({
  slotId: z.string().uuid('Select a valid banner slot'),
  ids: z.array(z.string().uuid('Ads must be valid ids')).min(1),
})

/** A reference copied out of a counter banner's details text. */
export const copyCounterSchema = z.object({
  reference: z.string().trim().min(1, 'Choose something to copy').max(200),
})

export const bannerVoteSchema = z.object({
  optionId: z.string().min(1, 'Choose an option').max(64),
  /** The option being replaced, when changing a vote. */
  previousOptionId: z.string().min(1).max(64).optional(),
})

export const bannerTemplateSchema = z
  .object({
    name: z.string().trim().min(1, 'Template name is required').max(80),
    type: z.enum(BANNER_AD_TYPES, {
      errorMap: () => ({ message: 'Choose a banner type' }),
    }),
    config: z.record(z.unknown()),
  })
  .superRefine((data, ctx) => {
    const result = bannerConfigSchemas[data.type].safeParse(data.config)
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['config', ...issue.path],
          message: issue.message,
        })
      }
    }
  })

/* ------------------------------- comments -------------------------------- */

/** Plain text: the client renders it escaped, and no markup is stored. */
const commentBody = z
  .string()
  .trim()
  .min(1, 'Write a comment first')
  .max(2000, 'Comments are limited to 2000 characters')

const optionalUuid = z.string().uuid('That reference is not valid').optional()

export const createCommentSchema = z
  .object({
    body: commentBody,
    /** Makes the comment a reply inside a thread. */
    parentId: optionalUuid,
    /** Quotes another comment of the same event. */
    quoteCommentId: optionalUuid,
    /** Quotes an element of the event page. */
    quoteText: z.string().trim().min(1).max(400, 'The quote is too long').optional(),
  })
  .superRefine((data, ctx) => {
    // A reply and a quote of the same comment mean the same intent twice;
    // the thread already shows what is being answered.
    if (data.parentId && data.quoteCommentId && data.parentId === data.quoteCommentId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['quoteCommentId'],
        message: 'That comment is already the reply target',
      })
    }
  })

export const blockCommenterSchema = z.object({
  userId: z.string().uuid('Select a user to block'),
  reason: z.string().trim().max(200).optional().or(z.literal('')),
})

/* --------------------------------- messages ------------------------------- */

/** One message of a SUPPORT or ADMIN chat. Stored as sanitized HTML. */
export const createChatMessageSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Write a message first')
    .max(5000, 'The message is too long'),
})

/**
 * An administrator opening a conversation: feedback for any user, a
 * personal conversation with that user, or an event thread of theirs.
 */
export const openChatSchema = z.object({
  userId: z.string().uuid('Select a user'),
  kind: z.enum(['SUPPORT', 'ADMIN', 'EVENT'], {
    errorMap: () => ({ message: 'Choose a conversation kind' }),
  }),
  eventId: z.string().uuid('Choose an event').optional(),
})

/** Whether the user may still write in a chat. */
export const setChatReadonlySchema = z.object({
  readOnly: z.boolean(),
})

/* ------------------------------- event templates --------------------------- */

/**
 * A saved event editor configuration. It carries every setting the editor
 * holds except the ones that name the event itself — the title, key, date
 * and publish state are left for the event being created.
 */
export const eventTemplateSchema = z.object({
  name: z.string().trim().min(1, 'Name the template').max(80),
  data: z.object({
    shortDescription: z.string().trim().max(300).optional().or(z.literal('')),
    description: z.string().max(20000).optional().or(z.literal('')),
    durationMinutes: z.number().int().min(0).max(60 * 24 * 30).nullish(),
    endTimeMode: z.enum(['DURATION', 'FIXED']).optional(),
    afterStartPolicy: z
      .enum(['UNPUBLISH_AT_START', 'KEEP_PUBLISHED_LOCKED', 'OPEN_AFTER_START'])
      .optional(),
    hostIds: z.array(z.string().uuid()).max(20).optional(),
    organizerId: z.string().uuid().nullish(),
    contactMode: z.enum(['PROFILE', 'CUSTOM']).optional(),
    priceItems: priceItems.optional(),
    address: z.string().trim().max(300).optional().or(z.literal('')),
    images: z.array(imageUrl).max(20).optional(),
    visibilityMode: z.enum(['ALL', 'INCLUDE', 'EXCLUDE']).optional(),
    visibleTagIds: z.array(z.string().uuid()).max(50).optional(),
    price: z.number().min(0).max(1_000_000).nullish(),
    currency: currencySchema.optional(),
    contactInfo: z.string().trim().max(300).optional().or(z.literal('')),
    pageStyle: pageStyleSchema.nullish(),
    layout: z.array(layoutElementSchema).max(30).optional(),
  }),
})
