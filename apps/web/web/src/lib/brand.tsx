// Mark It Down brand mark — inline copy of media/brand/icon.svg (navy→indigo
// page + warm cream/amber markdown # glyph) so every surface renders the same
// logo without an asset fetch. Gradient ids are prefixed to avoid collisions
// when the mark appears more than once per page.
export const BRAND_NAVY = "#1d2333";
export const BRAND_INDIGO = "#3b3a7a";
export const BRAND_CREAM = "#fff5d8";
export const BRAND_AMBER = "#f7c97b";

export function MarkItDownMark({ size = 64, className }: { size?: number; className?: string }) {
  const id = "midmark";
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1024 1024"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="Mark It Down"
    >
      <defs>
        <linearGradient id={`${id}-page`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={BRAND_NAVY} />
          <stop offset="1" stopColor={BRAND_INDIGO} />
        </linearGradient>
        <linearGradient id={`${id}-hash`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={BRAND_CREAM} />
          <stop offset="1" stopColor={BRAND_AMBER} />
        </linearGradient>
        <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.18" />
          <stop offset="0.45" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="64" y="64" width="896" height="896" rx="200" ry="200" fill={`url(#${id}-page)`} />
      <rect x="64" y="64" width="896" height="896" rx="200" ry="200" fill={`url(#${id}-sheen)`} />
      <g fill={`url(#${id}-hash)`}>
        <g transform="translate(512 512) skewX(-8) translate(-512 -512)">
          <rect x="350" y="232" width="92" height="560" rx="46" />
          <rect x="582" y="232" width="92" height="560" rx="46" />
        </g>
        <rect x="232" y="402" width="560" height="92" rx="46" />
        <rect x="232" y="566" width="560" height="92" rx="46" />
      </g>
    </svg>
  );
}
