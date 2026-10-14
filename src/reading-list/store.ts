import { randomUUID } from 'node:crypto'

export type Bookmark = {
  id: string
  title: string
  url: string
  status: 'unread' | 'read'
  createdAt: string
  expiresAt: number
}
export type NewBookmark = Pick<Bookmark, 'title' | 'url'>
export type BookmarkPage = { items: Bookmark[]; nextCursor: string | null }
export interface ReadingListStore {
  create(input: NewBookmark): Promise<Bookmark>
  list(cursor?: string): Promise<BookmarkPage>
  markRead(id: string): Promise<Bookmark | null>
}
export type ReadingList = {
  store: ReadingListStore
  authorize: (token: string) => Promise<boolean>
}

export function newBookmark(input: NewBookmark): Bookmark {
  return {
    ...input,
    id: randomUUID(),
    status: 'unread',
    createdAt: new Date().toISOString(),
    expiresAt: Math.floor(Date.now() / 1000) + 86400,
  }
}

// Local development only. Cloud deployments use DynamoDB, not process memory.
export class MemoryReadingList implements ReadingListStore {
  private items = new Map<string, Bookmark>()

  async create(input: NewBookmark) {
    const item = newBookmark(input)
    this.items.set(item.id, item)
    return { ...item }
  }

  async list(cursor?: string): Promise<BookmarkPage> {
    const items = [...this.items.values()]
      .filter((item) => item.expiresAt > Date.now() / 1000 && (!cursor || item.id > cursor))
      .sort((a, b) => a.id.localeCompare(b.id))
    const page = items.slice(0, 20)
    return {
      items: page.map((item) => ({ ...item })),
      nextCursor: items.length > 20 ? page.at(-1)!.id : null,
    }
  }

  async markRead(id: string) {
    const item = this.items.get(id)
    if (!item || item.expiresAt <= Date.now() / 1000) return null
    const updated: Bookmark = { ...item, status: 'read' }
    this.items.set(id, updated)
    return { ...updated }
  }
}
