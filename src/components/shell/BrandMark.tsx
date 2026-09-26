/**
 * The DenialDesk "D + check + cross" mark as inline SVG, so it can sit on dark chrome in white.
 * Stroke/fill use currentColor; the cross takes `crossClassName` (defaults to the brand teal).
 */
export function BrandMark({
  className,
  crossClassName = "text-[#14c8b0]",
}: {
  className?: string;
  crossClassName?: string;
}) {
  return (
    <svg viewBox="0 0 48 48" fill="none" aria-hidden="true" className={className}>
      {/* Top of the D sweeping into its bowl */}
      <path d="M5 5.5H21A17 17 0 0 1 38.5 20" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
      {/* Stem */}
      <rect x="2" y="12" width="7" height="33" rx="1.75" fill="currentColor" />
      {/* Check that closes the bowl */}
      <path
        d="M14 30.5L21.5 38L41 23.5"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Cross */}
      <g className={crossClassName} fill="currentColor">
        <rect x="18.5" y="10.5" width="5" height="15" rx="1.25" />
        <rect x="13.5" y="15.5" width="15" height="5" rx="1.25" />
      </g>
    </svg>
  );
}
