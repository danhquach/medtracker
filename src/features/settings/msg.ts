export const msg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback)
