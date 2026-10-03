import React from 'react';

/**
 * The TRIPART sign: three interlocking arms around a diamond. A stand-in drawn after the brand's look, until the
 * original artwork arrives (it then replaces LogoMark, nothing else changes).
 */
export function LogoMark({ className = 'h-8 w-8', arms = ['#ffffff', '#b08d57', '#c9d2dd'], center = '#b08d57' }: {
  className?: string;
  arms?: [string, string, string] | string[];
  center?: string;
}) {
  return (
    <svg viewBox="-50 -50 100 100" className={className} aria-hidden="true">
      {[0, 120, 240].map((angle, i) => (
        <path
          key={angle}
          transform={`rotate(${angle})`}
          d="M -4 -11 L -4 -40 L 4 -46 L 22 -33 L 17 -27 L 4 -36 L 4 -11 Z"
          fill={arms[i % arms.length]}
        />
      ))}
      <path d="M0 -8 L8 0 L0 8 L-8 0 Z" fill={center} />
    </svg>
  );
}

/** The sign with the name, for the dark header */
export default function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center min-w-0" role="img" aria-label="TRIPART – Legal Contract Intelligence">
      <LogoMark className={compact ? 'h-7 w-7 shrink-0' : 'h-9 w-9 shrink-0'} />
      <div className="ml-2 min-w-0 leading-none">
        <h1 className="text-white font-bold tracking-[0.22em] text-[15px]">TRIPART</h1>
        <div className="mt-1 text-[10px] tracking-wide text-brass whitespace-nowrap truncate">Legal Contract Intelligence</div>
      </div>
    </div>
  );
}
