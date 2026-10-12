import { Problem } from '@scheduler/contracts';
import { apiUrl } from '../config.js';

/** A non-2xx API answer, parsed from `application/problem+json`. */
export class ApiError extends Error {
  readonly status: number;
  readonly problem: Problem;

  constructor(status: number, problem: Problem) {
    super(problem.detail);
    this.name = 'ApiError';
    this.status = status;
    this.problem = problem;
  }
}

/** Anything with a zod-style `parse` (every schema exported by `@scheduler/contracts`). */
export interface Parser<T> {
  parse(data: unknown): T;
}

export interface RequestOptions<T> {
  schema: Parser<T>;
  method?: 'GET' | 'POST' | 'PUT';
  query?: Record<string, string | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

function syntheticProblem(status: number, detail: string): Problem {
  return {
    type: 'about:blank',
    title: 'Request failed',
    status,
    code: 'INTERNAL_ERROR',
    detail,
  };
}

/** `fetch` wrapper: builds the URL from a contracts path and validates the JSON with a contracts schema. */
export async function request<T>(path: string, opts: RequestOptions<T>): Promise<T> {
  const url = new URL(apiUrl(path));
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, v);

  const headers: Record<string, string> = {
    Accept: 'application/json, application/problem+json',
    ...opts.headers,
  };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(
      0,
      syntheticProblem(0, 'We could not reach the service. Check your internet connection and try again.'),
    );
  }

  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }

  if (!res.ok) {
    const parsed = Problem.safeParse(json);
    throw new ApiError(
      res.status,
      parsed.success
        ? parsed.data
        : syntheticProblem(res.status, `Request failed with status ${res.status}.`),
    );
  }
  return opts.schema.parse(json);
}

export const GENERIC_ERROR = 'Something went wrong on our side. Please try again in a moment.';

/** Matches machine codes such as `SLOT_UNAVAILABLE` that must never be shown to people. */
const RAW_CODE = /[A-Z]{3,}_[A-Z_]+/;

/** A sentence that is safe to show: server errors and anything containing a raw code become a generic one. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const detail = err.problem.detail;
    if (err.status >= 500 || RAW_CODE.test(detail) || /^Request failed with status/.test(detail)) {
      return err.status === 0 ? detail : GENERIC_ERROR;
    }
    return detail;
  }
  return GENERIC_ERROR;
}
