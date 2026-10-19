import { admin } from '../integration/helpers'
import { EMAIL_DOMAIN, EMAIL_PREFIX } from './fixtures'

// Removes every throwaway user the e2e specs created (profiles and meds cascade).
export default async function globalTeardown(): Promise<void> {
  for (let page = 1; ; page++) {
    const { data, error } = await admin().auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    for (const u of data.users) {
      if (u.email?.startsWith(EMAIL_PREFIX) && u.email.endsWith(EMAIL_DOMAIN)) await admin().auth.admin.deleteUser(u.id)
    }
    if (data.users.length < 200) break
  }
}
