import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { loadEnv } from 'vite'

const env = loadEnv('test', process.cwd(), '')

const url = env.SUPABASE_URL
const publishableKey = env.SUPABASE_PUBLISHABLE_KEY
const secretKey = env.SUPABASE_SECRET_KEY

const opts = { auth: { persistSession: false, autoRefreshToken: false } }

let adminClient: SupabaseClient | undefined

export function admin(): SupabaseClient {
  adminClient ??= createClient(url, secretKey, opts)
  return adminClient
}

export async function newUser(): Promise<{ client: SupabaseClient; id: string }> {
  const rand = crypto.randomUUID()
  const email = `t-${rand}@example.test`
  const password = `Pw-${rand}`
  const { data, error } = await admin().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (error || !data.user) throw error ?? new Error('createUser failed')
  const client = createClient(url, publishableKey, opts)
  const { error: signInError } = await client.auth.signInWithPassword({ email, password })
  if (signInError) throw signInError
  return { client, id: data.user.id }
}

export async function newGuest(): Promise<{ client: SupabaseClient; id: string }> {
  const client = createClient(url, publishableKey, opts)
  const { data, error } = await client.auth.signInAnonymously()
  if (error || !data.user) throw error ?? new Error('anonymous sign-in failed')
  return { client, id: data.user.id }
}

export function anon(): SupabaseClient {
  return createClient(url, publishableKey, opts)
}
