// Shared domain error. Services throw it; the error-handler plugin (A1) renders it as problem+json (SPEC §6).
import type { AlternativeSlot, ErrorCode, SlotStatus } from '@scheduler/contracts';

export interface DomainErrorExtras {
  reason?: SlotStatus;
  alternatives?: AlternativeSlot[];
}

export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
    readonly extras: DomainErrorExtras = {},
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export const notFound = (what: string, id: string) => new DomainError('NOT_FOUND', 404, `${what} ${id} not found`);
