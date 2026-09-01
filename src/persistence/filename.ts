import { UNTITLED_PROJECT_NAME } from './project'

const SCADLET_EXTENSION = '.scadlet'
/** Characters that are illegal or awkward across common desktop filesystems (Windows/macOS/Linux). */
const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|]/g

/**
 * Normalizes an arbitrary project name into a safe filename base:
 * trims whitespace, strips characters illegal on common filesystems,
 * and collapses internal whitespace runs - falling back to
 * `UNTITLED_PROJECT_NAME` if nothing usable remains.
 */
export function sanitizeFilename(name: string): string {
  const cleaned = name.replace(ILLEGAL_FILENAME_CHARS, '').replace(/\s+/g, ' ').trim()
  return cleaned.length > 0 ? cleaned : UNTITLED_PROJECT_NAME
}

/** Appends the `.scadlet` extension, unless `name` (after sanitizing) already ends with it (case-insensitively). */
export function toScadletFilename(name: string): string {
  const sanitized = sanitizeFilename(name)
  return sanitized.toLowerCase().endsWith(SCADLET_EXTENSION) ? sanitized : `${sanitized}${SCADLET_EXTENSION}`
}
