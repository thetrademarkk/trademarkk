/** Inline brand mark — the app's icon.svg, sized for the panel header. */
export function BrandMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#0A0A0B" />
      <rect x="12" y="22" width="8" height="20" rx="2" fill="#34D399" />
      <rect x="15" y="14" width="2" height="36" fill="#34D399" />
      <rect x="28" y="18" width="8" height="16" rx="2" fill="#F87171" />
      <rect x="31" y="10" width="2" height="32" fill="#F87171" />
      <rect x="44" y="26" width="8" height="22" rx="2" fill="#8B5CF6" />
      <rect x="47" y="18" width="2" height="38" fill="#8B5CF6" />
    </svg>
  );
}
