export interface Tag {
  id: string
  name: string
  createdAt?: string
  _count?: { users: number; events: number }
}

/** ALL = everyone, INCLUDE = only listed tags, EXCLUDE = everyone but listed tags. */
export type VisibilityMode = 'ALL' | 'INCLUDE' | 'EXCLUDE'

export const SOCIAL_PLATFORMS = [
  'whatsapp',
  'telegram',
  'instagram',
  'x',
  'facebook',
  'custom',
] as const

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number]

/** A single saved link, already in the network's own URL format. */
export interface SocialLink {
  platform: SocialPlatform
  url: string
  /** Only meaningful for `custom`, where the user names the link. */
  label?: string
}

export interface Role {
  key: string
  label: string
  description: string
  rank: number
}

export interface Invite {
  id: string
  token: string
  note?: string | null
  maxUses: number
  uses: number
  expiresAt?: string | null
  revoked: boolean
  createdAt: string
  createdBy?: { id: string; name: string }
}

export interface User {
  id: string
  /** Generated identifier; returned to administrators only and never rendered. */
  key?: string
  name: string
  email?: string | null
  role: string
  avatar?: string | null
  phone?: string | null
  socialLinks?: SocialLink[] | null
  /** Administrator-only; never sent to regular users. */
  tags?: Tag[]
  createdAt?: string
}

export type RegistrationStatus = 'PENDING' | 'CONFIRMED' | 'WAITLIST' | 'CANCELLED'

export interface ParticipantList {
  id: string
  name: string
  eventId?: string
  isDefault: boolean
  order: number
  registrations?: Registration[]
  /** Present instead of `registrations` for guests, who cannot see the list. */
  registrationCount?: number
}

export interface Registration {
  id: string
  status: RegistrationStatus
  registeredAt: string
  confirmedAt?: string | null
  confirmedById?: string | null
  userId?: string
  eventId?: string
  listId?: string
  user: User
  list: ParticipantList
  confirmedBy?: User | null
}

/** The title, date and time always live in the page header; these are the
 *  elements an administrator can reorder, span and add or remove. */
export type ElementType =
  | 'coverImage'
  | 'description'
  | 'address'
  | 'host'
  | 'price'
  | 'contactInfo'
  | 'lists'
  | 'publicTags'

export type AfterStartPolicy =
  | 'UNPUBLISH_AT_START'
  | 'KEEP_PUBLISHED_LOCKED'
  | 'OPEN_AFTER_START'

/** DURATION derives the end from the duration; FIXED uses an explicit end time. */
export type EndTimeMode = 'DURATION' | 'FIXED'

/** PROFILE takes the organizer's details from their user record. */
export type ContactMode = 'PROFILE' | 'CUSTOM'

export const CURRENCIES = ['$', '₽', '€', '🪙'] as const
export type Currency = (typeof CURRENCIES)[number]

export const CURRENCY_LABELS: Record<Currency, string> = {
  $: 'Dollar ($)',
  '₽': 'Ruble (₽)',
  '€': 'Euro (€)',
  '🪙': 'Gold coin (🪙)',
}

export interface EventPriceItem {
  id?: string
  name: string
  price: number
  /** Each charge carries its own currency, defaulting to the event's. */
  currency?: Currency
  order?: number
}

export interface EventImage {
  id: string
  url: string
  order: number
}

export interface LayoutElement {
  id: string
  type: ElementType
  order: number
  /** 1 = side by side with the neighbouring element, 2 = full width. */
  span?: 1 | 2
}

/**
 * Text laid over the event page's cover image, styled the same way a
 * cover banner is: the caption and the detailed description are two
 * separate texts, each with its own style and alignment, and the
 * vertical alignment decides where the block sits over the image.
 */
export interface PageCoverText {
  /** The headline. */
  caption?: string
  captionAlignment?: BannerAlignment
  captionFontColor?: string
  /** Font family and size for the headline. */
  captionFontFamily?: string
  captionFontSize?: string
  /** The detailed description under the headline. */
  description?: string
  descriptionAlignment?: BannerAlignment
  descriptionFontColor?: string
  descriptionFontFamily?: string
  descriptionFontSize?: string
  /** Where both texts sit over the image. */
  verticalAlignment?: BannerVerticalAlignment
}

export interface PageStyle {
  backgroundColor?: string
  fontColor?: string
  fontFamily?: string
  elementStyles?: Record<string, { backgroundColor?: string; fontColor?: string }>
  /** Text over the cover image; absent means the cover shows no text. */
  coverText?: PageCoverText | null
}

export interface Event {
  id: string
  key: string
  title: string
  shortDescription: string
  description?: string | null
  dateTime: string
  /** Null when the event is a point in time rather than a span. */
  durationMinutes?: number | null
  /** Stored `dateTime` + `durationMinutes`; null when there is no timeframe. */
  endsAt?: string | null
  endTimeMode?: EndTimeMode
  afterStartPolicy?: AfterStartPolicy
  address?: string | null
  coverImage?: string | null
  isPublished: boolean
  visibilityMode?: VisibilityMode
  /** Administrator-only; the tags `visibilityMode` refers to. */
  visibleTags?: Tag[]
  /** Shown publicly on the event page and card. */
  publicTags?: Tag[]
  creatorId: string
  hostId?: string | null
  /** One or more hosts. */
  hosts?: User[]
  organizerId?: string | null
  contactMode?: ContactMode
  price?: number | null
  currency?: Currency
  priceItems?: EventPriceItem[]
  /** Every image for the carousel, in display order. */
  images?: EventImage[]
  contactInfo?: string | null
  pageStyle?: PageStyle | null
  layout?: LayoutElement[] | null
  creator: User
  host?: User | null
  organizer?: User | null
  lists: ParticipantList[]
  registrations?: Registration[]
  userRegistration?: Registration | null
  _count?: { registrations: number }
  createdAt?: string
  updatedAt?: string
}

export interface RegisterPayload {
  name: string
  phone: string
  email?: string
  password?: string
}

export interface AuthResponse {
  user: User
  accessToken: string
  message?: string
}

export interface MessageResponse {
  message: string
}

/** A pending password reset request, seen by administrators. */
export interface PasswordReset {
  id: string
  token: string
  userId: string
  expiresAt: string
  usedAt?: string | null
  createdAt: string
  user: { id: string; name: string; phone?: string | null }
}

/* --------------------------------- comments -------------------------------- */

export interface CommentAuthor {
  id: string
  name: string
  avatar?: string | null
  role: string
}

/** What a comment quotes: another comment, or text taken from the page. */
export interface CommentQuote {
  id: string
  authorId: string
  authorName: string
  snippet: string
}

export interface Comment {
  id: string
  eventId: string
  authorId: string
  /** Set when the comment is a reply inside a thread. */
  parentId: string | null
  quoteCommentId: string | null
  /** Text quoted from an element of the event page. */
  quoteText: string | null
  quote: CommentQuote | null
  body: string
  pinned: boolean
  pinnedAt: string | null
  banned: boolean
  bannedAt: string | null
  deletedAt: string | null
  createdAt: string
  updatedAt: string
  author: CommentAuthor
}

/** One administrator decision stopping a user from commenting on an event. */
export interface CommentBlock {
  id: string
  reason: string | null
  createdAt: string
  user: { id: string; name: string; avatar?: string | null }
}

export interface CommentsResponse {
  comments: Comment[]
  blocks: CommentBlock[]
  viewerBlocked: boolean
  viewerIsAdmin: boolean
}

/* --------------------------------- banners -------------------------------- */

/** LEFT and RIGHT hold a single ad; MAIN rotates through its ads. */
export type BannerSlotName = 'LEFT' | 'MAIN' | 'RIGHT'

export type BannerAdType = 'COVER' | 'COUNTER' | 'POLL' | 'CONTACTS' | 'ANNOUNCEMENT'

export type BannerAlignment = 'left' | 'center' | 'right'

/** Where the text block sits inside the banner, top to bottom. */
export type BannerVerticalAlignment = 'top' | 'center' | 'bottom'

/**
 * Image, solid color or gradient background with styled, aligned text.
 * The caption and the detailed description are two separate texts, each
 * with its own style and alignment, so a banner can carry a headline
 * and a paragraph the way an event page does.
 */
export interface BannerCoverConfig {
  backgroundType: 'image' | 'color' | 'gradient'
  imageUrl?: string
  color?: string
  gradientFrom?: string
  gradientTo?: string
  /** The headline. */
  text?: string
  alignment?: BannerAlignment
  fontColor?: string
  /** Font family and size for the headline, from the editor's controls. */
  fontFamily?: string
  fontSize?: string
  /** The detailed description under the headline. */
  description?: string
  descriptionAlignment?: BannerAlignment
  descriptionFontColor?: string
  descriptionFontFamily?: string
  descriptionFontSize?: string
  /** Where both texts sit inside the banner. */
  verticalAlignment?: BannerVerticalAlignment
}

/** Progress bar or circle showing a current value against a target. */
export type BannerValueDisplay = 'percent' | 'current' | 'target' | 'raw'

export interface BannerCounterConfig {
  current: number
  target: number
  style: 'bar' | 'circle'
  /** What the counter's label shows. */
  valueDisplay?: BannerValueDisplay
  /** Text shown above the counter. */
  label?: string
  caption?: string
  /** Payment details or the fundraising goal, revealed on click. */
  details?: string
  currency?: string
  backgroundType?: 'color' | 'gradient' | 'image'
  imageUrl?: string
  color?: string
  gradientFrom?: string
  gradientTo?: string
}

export interface BannerPollOption {
  id: string
  text: string
  votes: number
}

/** Collects votes and shows the count or percentage per option. */
export interface BannerPollConfig {
  question?: string
  options: BannerPollOption[]
}

export type BannerContactPlatform = 'whatsapp' | 'telegram' | 'phone' | 'email' | 'link'

export interface BannerContactItem {
  platform: BannerContactPlatform
  value: string
  label: string
}

/** Contact buttons with customizable placement and labels. */
export interface BannerContactsConfig {
  placement: 'top' | 'bottom'
  alignment: BannerAlignment
  backgroundType?: 'color' | 'gradient'
  backgroundColor?: string
  gradientFrom?: string
  gradientTo?: string
  /** Filled pills or outlined ones, with their own colours. */
  buttonStyle?: 'filled' | 'outline'
  buttonColor?: string
  buttonFontColor?: string
  contacts: BannerContactItem[]
}

/** Styled, aligned text filling the entire banner. */
export interface BannerAnnouncementConfig {
  text: string
  alignment?: BannerAlignment
  fontColor?: string
  /** Font family applied to the announcement text. */
  fontFamily?: string
  /** Font size applied to the announcement text, e.g. "1.35rem". */
  fontSize?: string
  backgroundType?: 'color' | 'gradient'
  backgroundColor?: string
  gradientFrom?: string
  gradientTo?: string
}

export type BannerConfig =
  | BannerCoverConfig
  | BannerCounterConfig
  | BannerPollConfig
  | BannerContactsConfig
  | BannerAnnouncementConfig

export interface BannerAd {
  id: string
  slotId: string
  order: number
  type: BannerAdType
  config: BannerConfig
  /** Seconds an ANNOUNCEMENT stays on screen. */
  duration: number
  isActive: boolean
}

export interface BannerSlot {
  id: string
  slot: BannerSlotName
  /** Seconds between ads in the main banner's rotation. */
  interval: number
  isActive: boolean
  /** Whether ad changes in this slot reach the activity log. */
  logChanges?: boolean
  ads?: BannerAd[]
}

/** A poll vote with the user behind it, for the editor's statistics. */
export interface BannerPollVoter {
  userId: string
  name: string
  email?: string | null
  phone?: string | null
  optionId: string
  optionText?: string
  createdAt?: string
}

/** One user's copies of one reference out of a counter banner's details. */
export interface BannerCounterCopy {
  userId: string
  name: string
  avatar?: string | null
  email?: string | null
  phone?: string | null
  /** The copied @handle, without its marker. */
  reference: string
  /** How many times this user copied it. */
  count: number
  createdAt: string
  updatedAt: string
}

/** A counter banner's control data, for the administrator's Status tab. */
export interface BannerCounterStats {
  ad: {
    id: string
    slot: string
    isActive: boolean
    label: string
    current: number
    target: number
    currency: string
    details: string
  }
  copies: BannerCounterCopy[]
}

/** A saved ad configuration, ready to be applied to new ads. */
export interface BannerTemplate {
  id: string
  name: string
  type: BannerAdType
  config: BannerConfig
  createdAt?: string
}

/* ----------------------------- activity log ------------------------------- */

export type ActivityCategory =
  | 'REGISTRATION'
  | 'GUEST_APPROVAL'
  | 'PASSWORD_RESET'
  | 'EVENT_CREATED'
  | 'EVENT_UPCOMING'
  | 'COMMENT'
  | 'COMMENT_REPLY'
  | 'BANNER'
  | 'FEEDBACK'

/** A file attached to a feedback message. */
export interface ActivityAttachment {
  url: string
  name: string
  size: number
}

/** One line in the administrator's activity log. */
export interface ActivityLogEntry {
  id: string
  category: ActivityCategory
  /** Null for entries the system generated, such as an upcoming event. */
  actorId: string | null
  actorName: string | null
  targetType: string | null
  targetId: string | null
  targetName: string | null
  detail: string | null
  /** Feedback message body, sanitized HTML. */
  message: string | null
  /** Extras: a feedback attachment, or the event a comment belongs to. */
  meta: { attachment?: ActivityAttachment; eventId?: string } | null
  createdAt: string
}

/** What the log lists back, plus the settings behind it. */
export interface ActivityLogResponse {
  entries: ActivityLogEntry[]
  settings: ActivitySettings
}

export interface ActivitySettings {
  /** Whether new comments are logged; off by default. */
  logComments: boolean
}

/* ------------------------------ notifications ------------------------------ */

export type BroadcastNotificationType =
  | 'EVENT_CREATED'
  | 'EVENT_REMINDER'
  | 'ORGANIZER_UPDATE'
  | 'ANNOUNCEMENT'

export type IndividualNotificationType =
  | 'COMMENT_REPLY'
  | 'COMMENT_BAN'
  | 'COMMENT_BLOCK'
  | 'ADMIN_MESSAGE'
  | 'CHAT_MESSAGE'
  | 'REGISTRATION_CONFIRMED'
  | 'LIST_TRANSFER'
  | 'LIST_REMOVAL'
  | 'PASSWORD_RESET'
  | 'PASSWORD_ADVICE'

/** A notification every eligible user sees. */
export interface BroadcastNotificationItem {
  id: string
  type: BroadcastNotificationType
  sourceType: string
  sourceId: string
  title: string
  message: string | null
  meta: Record<string, unknown> | null
  createdAt: string
  readAt: string | null
}

/** A notification addressed to exactly one user. */
export interface IndividualNotificationItem {
  id: string
  type: IndividualNotificationType
  title: string
  message: string | null
  targetType: string | null
  targetId: string | null
  meta: Record<string, unknown> | null
  readAt: string | null
  createdAt: string
}

/** What the bell lists. */
export interface NotificationsResponse {
  broadcasts: BroadcastNotificationItem[]
  individual: IndividualNotificationItem[]
  unreadBroadcasts: number
  unreadIndividual: number
}

/* --------------------------------- messages ------------------------------- */

/**
 * SUPPORT is a feedback conversation, answered as "Technical Support";
 * ADMIN is a personal conversation with one administrator; EVENT mirrors
 * an event's comment thread.
 */
export type ChatKind = 'SUPPORT' | 'ADMIN' | 'EVENT'

/** One conversation as this viewer sees it. */
export interface ChatSummary {
  id: string
  kind: ChatKind
  /** The chat's name from this viewer's side. */
  title: string
  avatar: string | null
  subtitle: string | null
  /** The other side of the conversation, when it is one person. */
  counterpartId: string | null
  counterpartRole: string | null
  eventId: string | null
  /** The event's own page, where an EVENT thread lives as comments. */
  eventKey: string | null
  /** The last message, as plain text. */
  preview: string | null
  lastMessageAt: string
  unread: number
  /** Whether this viewer may write; an administrator always may. */
  canWrite: boolean
  /** Whether an administrator stopped the user from writing here. */
  userReadOnly: boolean
}

/** One message of a thread. */
export interface ChatMessage {
  id: string
  authorId: string
  /** How the author is shown: their own name, or Technical Support. */
  displayName: string
  displayAvatar: string | null
  /** SUPPORT and ADMIN bodies are sanitized HTML; EVENT bodies are text. */
  html: boolean
  body: string
  own: boolean
  createdAt: string
}

/** What the conversation view answers. */
export interface ChatThreadResponse {
  chat: ChatSummary
  messages: ChatMessage[]
  viewerIsAdmin: boolean
  /** Where a notification leads to open this conversation. */
  link: string
}

/** Opening a conversation as an administrator. */
export interface OpenChatPayload {
  userId: string
  kind: ChatKind
  eventId?: string
}

/* ------------------------------ event templates ---------------------------- */

/**
 * The event editor's settings, in the shape the event create/update payload
 * uses. A template holds everything except what names the event itself:
 * the title, key, date and publish state are chosen per event.
 */
export interface EventTemplateData {
  shortDescription?: string
  description?: string
  durationMinutes?: number | null
  endTimeMode?: EndTimeMode
  afterStartPolicy?: AfterStartPolicy
  hostIds?: string[]
  organizerId?: string | null
  contactMode?: ContactMode
  priceItems?: EventPriceItem[]
  address?: string
  images?: string[]
  visibilityMode?: VisibilityMode
  visibleTagIds?: string[]
  price?: number | null
  currency?: Currency
  contactInfo?: string
  pageStyle?: PageStyle | null
  layout?: LayoutElement[]
}

/** One saved template, as the API returns it. */
export interface EventTemplate {
  id: string
  name: string
  createdAt: string
  data: EventTemplateData
  createdBy: { id: string; name: string }
}
