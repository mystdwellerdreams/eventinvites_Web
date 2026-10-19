import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

/** The page header always renders the title, date and time, so the layout only
 *  describes the elements that can be rearranged on the page body. */
const DEFAULT_LAYOUT = [
  { id: 'coverImage', type: 'coverImage', order: 0, span: 2 },
  { id: 'description', type: 'description', order: 1, span: 2 },
  { id: 'address', type: 'address', order: 2, span: 1 },
  { id: 'price', type: 'price', order: 3, span: 1 },
  { id: 'contactInfo', type: 'contactInfo', order: 4, span: 1 },
  { id: 'host', type: 'host', order: 5, span: 1 },
  { id: 'lists', type: 'lists', order: 6, span: 2 },
]

const daysFromNow = (days: number, hour: number) => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  d.setHours(hour, 0, 0, 0)
  return d
}

/** Administrator-only categorisation labels available out of the box. */
const DEFAULT_TAG_NAMES = ['VIP', 'Press', 'Family', 'Student']

async function main() {
  console.log('Seeding database...')

  const tags: Record<string, { id: string }> = {}
  for (const name of DEFAULT_TAG_NAMES) {
    const tag = await prisma.tag.upsert({
      where: { name },
      update: {},
      create: { name },
      select: { id: true, name: true },
    })
    tags[name] = { id: tag.id }
  }
  console.log(`  tags   -> ${DEFAULT_TAG_NAMES.join(', ')}`)

  // Home-page banner slots. The main slot opens with a gradient cover
  // that mirrors the hero the banner layout replaced.
  const slots: Record<string, { id: string }> = {}
  for (const name of ['LEFT', 'MAIN', 'RIGHT']) {
    const slot = await prisma.bannerSlot.upsert({
      where: { slot: name },
      update: {},
      create: { slot: name },
      select: { id: true },
    })
    slots[name] = { id: slot.id }
  }
  const existingMainAd = await prisma.bannerAd.findFirst({
    where: { slotId: slots.MAIN.id },
    select: { id: true },
  })
  if (!existingMainAd) {
    await prisma.bannerAd.create({
      data: {
        slotId: slots.MAIN.id,
        order: 0,
        type: 'COVER',
        config: JSON.stringify({
          backgroundType: 'gradient',
          gradientFrom: '#3b82f6',
          gradientTo: '#8b5cf6',
          text: 'Discover and join events near you',
          alignment: 'center',
          fontColor: '#ffffff',
        }),
        duration: 5,
        isActive: true,
      },
    })
  }
  console.log('  banners -> LEFT, MAIN, RIGHT slots')

  const adminPasswordHash = await bcrypt.hash('Admin', 10)

  const admin = await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: { name: 'Admin', role: 'ADMIN', passwordHash: adminPasswordHash },
    create: {
      email: 'admin@example.com',
      name: 'Admin',
      passwordHash: adminPasswordHash,
      phone: '+15550100',
      phoneKey: '15550100',
      role: 'ADMIN',
      socialLinks: JSON.stringify({
        twitter: 'https://twitter.com/admin',
        linkedin: 'https://linkedin.com/in/admin',
      }),
    },
  })
  console.log('  admin  -> Admin / password: Admin')

  const markPasswordHash = await bcrypt.hash('Mark', 10)

  const mark = await prisma.user.upsert({
    where: { email: 'mark@example.com' },
    update: { name: 'Mark', role: 'USER', passwordHash: markPasswordHash },
    create: {
      email: 'mark@example.com',
      name: 'Mark',
      passwordHash: markPasswordHash,
      phone: '+15550142',
      phoneKey: '15550142',
      role: 'USER',
      socialLinks: JSON.stringify({
        instagram: 'https://instagram.com/mark',
        telegram: 'https://t.me/mark',
      }),
    },
  })

  // Applied separately: `upsert` does not accept `set` on a many-to-many.
  // Demonstrates a categorised user; drives the sample INCLUDE event below.
  await prisma.user.update({
    where: { id: mark.id },
    data: { tags: { set: [tags.VIP, tags.Student] } },
  })
  console.log('  user   -> Mark / password: Mark / tags: VIP, Student')

  const welcomeEvent = await prisma.event.upsert({
    where: { key: 'welcome-event' },
    update: {},
    create: {
      key: 'welcome-event',
      title: 'Welcome Event',
      shortDescription:
        'Join us for our annual welcome event with networking, talks and refreshments.',
      description:
        'This is our biggest event of the year! Join us for a full day of inspiring talks, networking opportunities and hands-on workshops.\n\nLunch and refreshments are provided. Do not miss this chance to connect with fellow professionals and learn from the best in the field.',
      dateTime: daysFromNow(14, 10),
      address: 'Convention Center, 123 Main St',
      coverImage:
        'https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&w=1200&q=80',
      isPublished: true,
      creatorId: admin.id,
      hostId: admin.id,
      price: 49.99,
      contactInfo: '+1 555 0100',
      pageStyle: JSON.stringify({
        backgroundColor: '#f8fafc',
        fontColor: '#0f172a',
        fontFamily: 'Inter, system-ui, sans-serif',
        elementStyles: {
          description: { backgroundColor: '#ffffff' },
          lists: { backgroundColor: '#ffffff' },
        },
      }),
      layout: JSON.stringify(DEFAULT_LAYOUT),
      lists: {
        create: [
          { name: 'Main List', isDefault: true, order: 0 },
          { name: 'Waitlist', isDefault: false, order: 1 },
        ],
      },
    },
  })
  console.log('  event  ->', welcomeEvent.title, '/ key:', welcomeEvent.key)

  const workshopEvent = await prisma.event.upsert({
    where: { key: 'tech-workshop' },
    update: {},
    create: {
      key: 'tech-workshop',
      title: 'Tech Workshop: Modern Web Development',
      shortDescription: 'Hands-on workshop covering React, TypeScript and modern tooling.',
      description:
        "In this intensive workshop you'll learn modern web development practices including React with TypeScript, state management, testing strategies and deployment pipelines.\n\nPrerequisites: basic JavaScript knowledge. Bring a laptop with Node.js installed.",
      dateTime: daysFromNow(21, 14),
      address: 'Tech Hub, 456 Innovation Ave',
      coverImage:
        'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?auto=format&fit=crop&w=1200&q=80',
      isPublished: true,
      creatorId: admin.id,
      hostId: mark.id,
      price: 0,
      contactInfo: '+1 555 0142',
      pageStyle: JSON.stringify({
        backgroundColor: '#0f172a',
        fontColor: '#e2e8f0',
        fontFamily: '"Fira Code", "Courier New", monospace',
        elementStyles: {
          description: { backgroundColor: '#1e293b' },
          lists: { backgroundColor: '#1e293b' },
        },
      }),
      layout: JSON.stringify([
        { id: 'coverImage', type: 'coverImage', order: 0, span: 2 },
        { id: 'description', type: 'description', order: 1, span: 2 },
        { id: 'host', type: 'host', order: 2, span: 1 },
        { id: 'address', type: 'address', order: 3, span: 1 },
        { id: 'contactInfo', type: 'contactInfo', order: 4, span: 1 },
        { id: 'lists', type: 'lists', order: 5, span: 2 },
      ]),
      lists: {
        create: [
          { name: 'Main List', isDefault: true, order: 0 },
          { name: 'Waitlist', isDefault: false, order: 1 },
        ],
      },
    },
  })
  console.log('  event  ->', workshopEvent.title, '/ key:', workshopEvent.key)

  // An INCLUDE event, so the tag system has something to demonstrate.
  await prisma.event.upsert({
    where: { key: 'vip-reception' },
    update: {},
    create: {
      key: 'vip-reception',
      title: 'VIP Reception',
      shortDescription: 'An invitation-only reception limited to VIP-tagged guests.',
      description:
        'A small drinks reception for VIP guests and their companions. Please show this page at the door.',
      dateTime: daysFromNow(7, 19),
      address: 'The Penthouse, 1 Harbour View',
      isPublished: true,
      creatorId: admin.id,
      visibilityMode: 'INCLUDE',
      pageStyle: JSON.stringify({
        backgroundColor: '#1c1917',
        fontColor: '#fafaf9',
        fontFamily: 'Georgia, "Times New Roman", serif',
      }),
      layout: JSON.stringify(DEFAULT_LAYOUT),
      lists: {
        create: [
          { name: 'Main List', isDefault: true, order: 0 },
          { name: 'Waitlist', isDefault: false, order: 1 },
        ],
      },
    },
  })
  // Applied separately: `upsert` does not accept `set` on a many-to-many.
  await prisma.event.update({
    where: { key: 'vip-reception' },
    data: { visibleTags: { set: [tags.VIP] } },
  })
  console.log('  event  -> VIP Reception (visible only to the VIP tag)')

  // An EXCLUDE event: everyone except press.
  await prisma.event.upsert({
    where: { key: 'community-social' },
    update: {},
    create: {
      key: 'community-social',
      title: 'Community Social',
      shortDescription: 'An open social for everyone except the press.',
      description: 'Drinks, music and introductions. Press are asked not to attend.',
      dateTime: daysFromNow(10, 18),
      address: 'Community Hall, 8 Orchard Lane',
      isPublished: true,
      creatorId: admin.id,
      visibilityMode: 'EXCLUDE',
      pageStyle: JSON.stringify({
        backgroundColor: '#ffffff',
        fontColor: '#111827',
        fontFamily: 'Inter, system-ui, sans-serif',
      }),
      layout: JSON.stringify(DEFAULT_LAYOUT),
      lists: {
        create: [
          { name: 'Main List', isDefault: true, order: 0 },
          { name: 'Waitlist', isDefault: false, order: 1 },
        ],
      },
    },
  })
  await prisma.event.update({
    where: { key: 'community-social' },
    data: { visibleTags: { set: [tags.Press] } },
  })
  console.log('  event  -> Community Social (everyone except the Press tag)')

  const existingDraft = await prisma.event.findUnique({ where: { key: 'draft-event' } })
  if (!existingDraft) {
    const draft = await prisma.event.create({
      data: {
        key: 'draft-event',
        title: 'Draft Event (unpublished)',
        shortDescription: 'This event is still a work in progress and not visible yet.',
        description: 'Details coming soon.',
        dateTime: daysFromNow(30, 12),
        address: 'To be announced',
        isPublished: false,
        creatorId: admin.id,
        pageStyle: JSON.stringify({
          backgroundColor: '#ffffff',
          fontColor: '#111827',
          fontFamily: 'Inter, system-ui, sans-serif',
        }),
        layout: JSON.stringify(DEFAULT_LAYOUT),
        lists: {
          create: [
            { name: 'Main List', isDefault: true, order: 0 },
            { name: 'Waitlist', isDefault: false, order: 1 },
          ],
        },
      },
    })
    console.log('  event  ->', draft.title, '(draft)')
  }

  console.log('Seeding complete.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
