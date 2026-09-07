'use client';

import { useState } from 'react';
import { cn } from '@/components/ui/primitives';
import { BRAND, brandInitials } from '@/lib/brand';

export interface BrandLogoOrg {
  name?: string | null;
  short_name?: string | null;
  logo_url?: string | null;
}

/**
 * Organisation logo with graceful, multi-level degradation:
 *
 *   uploaded logo (Settings → Organisation)
 *     → bundled CMA crest (default when no upload exists)
 *       → monogram badge (when the image itself fails to load)
 *
 * A broken URL, expired upload or an offline asset host can therefore never
 * leave a broken-image icon in the sidebar, sign-in screen or printed
 * letterheads — the badge preserves the brand every time.
 */
export default function BrandLogo({
  org,
  size = 40,
  className,
  badgeClassName,
}: {
  org: BrandLogoOrg;
  size?: number;
  className?: string;
  badgeClassName?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = org?.logo_url?.trim() || BRAND.defaultMarkUrl;
  const label = org?.name?.trim() || BRAND.productName;

  if (failedSrc === src) {
    return (
      <span
        role="img"
        aria-label={label}
        title={label}
        style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.34)) }}
        className={cn(
          'inline-flex shrink-0 select-none items-center justify-center rounded-xl bg-gold-500 font-extrabold tracking-wide text-navy-950 shadow',
          badgeClassName,
        )}
      >
        {brandInitials(org?.short_name, org?.name)}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={label}
      title={label}
      width={size}
      height={size}
      onError={() => setFailedSrc(src)}
      className={cn('shrink-0 rounded-xl object-contain', className)}
    />
  );
}
