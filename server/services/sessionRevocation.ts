/** Keeps a bounded process-local revocation store without reviving evicted tokens. */

import { logServerEvent } from '../config/logger.js';

const MAX_REVOKED = 1000;
const revokedUntil = new Map<string, number>();
let revokedThrough = Number.NEGATIVE_INFINITY;

/** Checks explicit revocation and the cutoff applied under revocation pressure. */
export function isSessionRevoked(jti: string, issuedAt: number, nowSeconds: number): boolean {
  return issuedAt <= revokedThrough || (revokedUntil.get(jti) ?? 0) > nowSeconds;
}

/** Records revocation until expiry, invalidating older sessions if capacity is exhausted. */
export function rememberRevocation(jti: string, expiry: number, nowSeconds: number): void {
  if (revokedUntil.size >= MAX_REVOKED) {
    for (const [id, until] of revokedUntil) {
      if (until <= nowSeconds) revokedUntil.delete(id);
    }
    if (revokedUntil.size >= MAX_REVOKED) {
      revokedThrough = Math.max(revokedThrough, nowSeconds);
      revokedUntil.clear();
      logServerEvent('warn', 'session_revocation_capacity_reached');
    }
  }
  revokedUntil.set(jti, expiry);
}

/** Resets local revocation state for isolated tests. */
export function clearSessionRevocations(): void {
  revokedUntil.clear();
  revokedThrough = Number.NEGATIVE_INFINITY;
}
