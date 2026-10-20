// Per-user IndexedDB: the last-known server data (cache) and the queue of changes not yet sent (outbox).
import type { DoseEvent, Medication, Profile, Schedule } from '../../lib/types'
import type { Op } from './ops'

export type Cache = { meds: Medication[]; schedules: Schedule[]; doses: DoseEvent[]; profile: Profile | null }
export type OutboxItem = { seq: number; op: Op; state: 'pending' | 'failed'; error?: string; tries: number }

export interface Store {
  readCache(): Promise<Cache>
  writeCache(c: Cache): Promise<void>
  enqueue(op: Op): Promise<number>
  list(): Promise<OutboxItem[]>
  update(item: OutboxItem): Promise<void>
  remove(seq: number): Promise<void>
  clear(): Promise<void>
  close(): void
}

export const emptyCache = (): Cache => ({ meds: [], schedules: [], doses: [], profile: null })

const PREFIX = 'medtracker-offline-'
const dbName = (userId: string) => `${PREFIX}${userId}`

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

/** `onClosed` runs when another tab deletes this database and the connection is closed for it. */
export async function openStore(userId: string, onClosed?: () => void): Promise<Store> {
  const open = indexedDB.open(dbName(userId), 1)
  open.onupgradeneeded = () => {
    open.result.createObjectStore('cache')
    open.result.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true })
  }
  const db = await req(open)
  db.onversionchange = () => {
    db.close() // a sign-out deleting this database must never be blocked
    onClosed?.()
  }
  const tx = (name: 'cache' | 'outbox', mode: IDBTransactionMode = 'readonly') => db.transaction(name, mode).objectStore(name)
  return {
    readCache: async () => ((await req(tx('cache').get('snapshot'))) as Cache | undefined) ?? emptyCache(),
    writeCache: async (c) => void (await req(tx('cache', 'readwrite').put(c, 'snapshot'))),
    enqueue: async (op) => (await req(tx('outbox', 'readwrite').add({ op, state: 'pending', tries: 0 }))) as number,
    list: async () => (await req(tx('outbox').getAll())) as OutboxItem[],
    update: async (item) => void (await req(tx('outbox', 'readwrite').put(item))),
    remove: async (seq) => void (await req(tx('outbox', 'readwrite').delete(seq))),
    clear: async () => {
      const t = db.transaction(['cache', 'outbox'], 'readwrite')
      t.objectStore('cache').clear()
      t.objectStore('outbox').clear()
      await new Promise<void>((resolve, reject) => {
        t.oncomplete = () => resolve()
        t.onerror = () => reject(t.error)
      })
    },
    close: () => db.close(),
  }
}

export async function deleteStore(userId: string): Promise<void> {
  await req(indexedDB.deleteDatabase(dbName(userId)))
}

/** Deletes every user's offline store except `keepUserId`'s (left behind by an expired or abandoned session). */
export async function deleteOtherStores(keepUserId: string): Promise<void> {
  if (typeof indexedDB.databases !== 'function') return
  const keep = dbName(keepUserId)
  for (const { name } of await indexedDB.databases()) {
    if (name?.startsWith(PREFIX) && name !== keep) await req(indexedDB.deleteDatabase(name))
  }
}
