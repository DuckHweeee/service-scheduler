/** Runtime configuration (Vite env). */
export const CUSTOMER_ID: string = import.meta.env.VITE_CUSTOMER_ID || 'CUS-10482';
export const USE_MOCKS: boolean = import.meta.env.VITE_USE_MOCKS !== 'false';

/** Base URL of the API. Empty = same origin (MSW in dev, Vite proxy otherwise). */
export function apiBase(): string {
  const configured = import.meta.env.VITE_API_URL;
  if (configured) return configured.replace(/\/$/, '');
  return typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
}

/** Absolute URL for a path from `@scheduler/contracts` `paths`. */
export function apiUrl(path: string): string {
  return `${apiBase()}${path}`;
}
