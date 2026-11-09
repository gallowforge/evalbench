/** Two tasting cards: one still face down, one turned over and ticked by the judge. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="#17181c" />
      <g transform="rotate(-11 11.5 17)">
        <rect x="5.5" y="9" width="12" height="16.5" rx="2.4" fill="#2457f0" />
      </g>
      <g transform="rotate(8 20.5 15.5)">
        <rect x="14.5" y="7.25" width="12" height="16.5" rx="2.4" fill="#fffdf8" />
        <path d="M17.4 15.6l2.5 2.6 4.4-5.3" fill="none" stroke="#d23c2a" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}
