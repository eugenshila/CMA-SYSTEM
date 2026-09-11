/**
 * Central product brand — the single source of truth for the CMA identity.
 *
 * The organisation record (Settings → Organisation) may override the logo with
 * its own artwork (`logo_url`); these defaults keep every surface branded when
 * no upload exists, and {@link brandInitials} powers the monogram badge shown
 * when an image cannot be loaded at all.
 */
export const BRAND = {
  productName: (typeof process !== 'undefined' ? process.env?.APP_NAME : undefined) || 'CMA Management System',
  shortName: 'CMA',
  tagline: 'Men of Faith · Men of Service',
  /** Bundled crest used whenever the organisation has not uploaded its own logo. */
  defaultMarkUrl: '/brand/logo-mark.svg',
  /** Full horizontal lockup (crest + wordmark), for docs and wide banners. */
  defaultLogoUrl: '/brand/logo.svg',
  themeColor: '#0e2340',
} as const;

/**
 * Monogram initials for the graceful logo fallback badge.
 * Short codes ("CMA") are used verbatim; longer names collapse to up to
 * three leading capitals ("St. Joseph Mukasa Chapter" → "SJMC").
 */
export function brandInitials(shortName?: string | null, name?: string | null): string {
  const raw = (shortName || '').trim() || (name || '').trim() || BRAND.shortName;
  if (raw.length <= 4 && !/\s/.test(raw)) return raw.toUpperCase();
  const words = raw.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (words.length === 0) return BRAND.shortName;
  return words
    .slice(0, 3)
    .map((w) => w[0].toUpperCase())
    .join('');
}
