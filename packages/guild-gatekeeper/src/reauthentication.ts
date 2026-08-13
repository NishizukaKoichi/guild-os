const DEFAULT_MAX_AGE_MS = 5 * 60 * 1_000;
const DEFAULT_FUTURE_TOLERANCE_MS = 30 * 1_000;

export interface RecentReauthenticationOptions {
  readonly now?: number;
  readonly maxAgeMs?: number;
  readonly futureToleranceMs?: number;
  readonly missingMessage: string;
  readonly expiredMessage: string;
}

export function assertRecentReauthentication(
  verifiedAuthenticatedAt: string | null,
  options: RecentReauthenticationOptions,
): string {
  if (verifiedAuthenticatedAt === null) throw new Error(options.missingMessage);
  const now = options.now ?? Date.now();
  const timestamp = Date.parse(verifiedAuthenticatedAt);
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const futureToleranceMs = options.futureToleranceMs ?? DEFAULT_FUTURE_TOLERANCE_MS;
  if (!Number.isFinite(timestamp) || timestamp < now - maxAgeMs ||
      timestamp > now + futureToleranceMs) {
    throw new Error(options.expiredMessage);
  }
  return new Date(timestamp).toISOString();
}
