/**
 * Upload limits shared by the browser and the API routes.
 *
 * This module is imported by a client component, so it must not pull in any
 * server-only code (no SDK clients, no secret env vars).
 *
 * Both limits are configurable because the ceiling is a property of the host,
 * not the app: platforms that proxy requests through serverless functions cap
 * the request body well below these defaults. Vercel, for example, rejects
 * anything over ~4.5MB before the request ever reaches `validateUploads`, so a
 * deployment there should set NEXT_PUBLIC_MAX_FILE_MB=4 (and a matching total)
 * to keep the advertised limit honest.
 *
 * NEXT_PUBLIC_* values are inlined at build time, so changing them requires a
 * rebuild rather than just a restart.
 */

const DEFAULT_MAX_FILE_MB = 20;
const DEFAULT_MAX_TOTAL_MB = 40;

function readLimitMb(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const MAX_FILE_MB = readLimitMb(
  process.env.NEXT_PUBLIC_MAX_FILE_MB,
  DEFAULT_MAX_FILE_MB
);
export const MAX_TOTAL_MB = readLimitMb(
  process.env.NEXT_PUBLIC_MAX_TOTAL_MB,
  DEFAULT_MAX_TOTAL_MB
);

export const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;
export const MAX_TOTAL_BYTES = MAX_TOTAL_MB * 1024 * 1024;

export const SUPPORTED_UPLOAD_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
] as const;

/** Comma-separated list for an <input type="file"> accept attribute. */
export const ACCEPTED_FILE_TYPES = SUPPORTED_UPLOAD_TYPES.join(',');

export function isSupportedScheduleFile(file: File): boolean {
  return (SUPPORTED_UPLOAD_TYPES as readonly string[]).includes(file.type);
}

function describeMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/**
 * Validates uploads before any of them reach the model, so an oversized or
 * unsupported file fails with a clear message instead of an opaque API error.
 * Returns null when the batch is acceptable.
 */
export function validateUploads(files: File[]): string | null {
  let totalBytes = 0;

  for (const file of files) {
    const name = file.name || 'Unnamed file';

    if (!isSupportedScheduleFile(file)) {
      return `"${name}" is not a supported file type. Upload a PDF, JPEG, PNG, GIF, or WebP.`;
    }
    if (file.size > MAX_FILE_BYTES) {
      return `"${name}" is ${describeMb(file.size)}. Each file must be under ${MAX_FILE_MB}MB.`;
    }
    totalBytes += file.size;
  }

  if (totalBytes > MAX_TOTAL_BYTES) {
    return `Uploads total ${describeMb(totalBytes)}. Keep the combined size under ${MAX_TOTAL_MB}MB.`;
  }

  return null;
}
