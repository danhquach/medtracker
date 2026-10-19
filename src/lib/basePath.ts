// Everything app-absolute derives from Vite's BASE_URL ('/' locally, '/medtracker/' on Pages).

/** react-router basename: BASE_URL without its trailing slash ('/' stays '/'). */
export function routerBasename(base: string = import.meta.env.BASE_URL): string {
  return base.replace(/\/+$/, '') || '/'
}

/** Absolute URL of an in-app path, e.g. appUrl('settings?finish=1') under the deploy base. */
export function appUrl(path: string, origin: string = location.origin, base: string = import.meta.env.BASE_URL): string {
  return new URL(path, origin + base).href
}
