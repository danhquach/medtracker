import { describe, expect, it } from 'vitest'
import type { Op } from './ops'
import { deleteStore, openStore } from './store'

const op = (n: number): Op => ({ opId: `op${n}`, at: '2026-10-20T00:00:00.000Z', kind: 'deleteMed', medId: `m${n}` })
const med = { id: 'm1', name: 'A' } as never

describe('offline store', () => {
  it('store persists across reopen', async () => {
    const s = await openStore('persist')
    await s.writeCache({ meds: [med], schedules: [], doses: [], profile: null })
    await s.enqueue(op(1))
    s.close()
    const again = await openStore('persist')
    expect((await again.readCache()).meds).toEqual([med])
    expect((await again.list()).map((i) => i.op.opId)).toEqual(['op1'])
    again.close()
  })

  it('an unopened store has an empty cache', async () => {
    const s = await openStore('fresh')
    expect(await s.readCache()).toEqual({ meds: [], schedules: [], doses: [], profile: null })
    s.close()
  })

  it('outbox lists in seq order', async () => {
    const s = await openStore('order')
    for (const n of [1, 2, 3]) await s.enqueue(op(n))
    const items = await s.list()
    expect(items.map((i) => i.op.opId)).toEqual(['op1', 'op2', 'op3'])
    expect(items[0]).toMatchObject({ state: 'pending', tries: 0 })
    await s.update({ ...items[1], state: 'failed', error: 'nope' })
    await s.remove(items[0].seq)
    expect((await s.list()).map((i) => [i.op.opId, i.state])).toEqual([['op2', 'failed'], ['op3', 'pending']])
    s.close()
  })

  it('stores are isolated per user id', async () => {
    const a = await openStore('ua')
    const b = await openStore('ub')
    await a.enqueue(op(1))
    expect(await b.list()).toEqual([])
    a.close()
    b.close()
  })

  it('clear empties cache and outbox', async () => {
    const s = await openStore('clear')
    await s.writeCache({ meds: [med], schedules: [], doses: [], profile: null })
    await s.enqueue(op(1))
    await s.clear()
    expect(await s.list()).toEqual([])
    expect((await s.readCache()).meds).toEqual([])
    s.close()
  })

  it('deleteStore removes the database', async () => {
    const s = await openStore('gone')
    await s.enqueue(op(1))
    s.close()
    await deleteStore('gone')
    const again = await openStore('gone')
    expect(await again.list()).toEqual([])
    again.close()
  })
})
