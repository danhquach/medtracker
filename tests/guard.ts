import { loadEnv } from 'vite'

// The only Supabase project is production (GitHub issue #10). Integration and e2e
// tests create and delete users, so they run only when .env.test declares a test project.
export function assertTestProject(): void {
  const env = loadEnv('test', process.cwd(), '')
  if (env.SUPABASE_ENV !== 'test') {
    throw new Error('Refusing to run: set SUPABASE_ENV=test in .env.test, and only for a dedicated test project.')
  }
}
