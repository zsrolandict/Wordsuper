import React from 'react';

/**
 * ICT Europa Legal wordmark (drawn from the brand's look; replace with the original artwork when available).
 */
export default function Logo({ className = 'h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 196 24" className={className} role="img" aria-label="ICT Europa Legal">
      <text x="0" y="19" fontFamily="'Segoe UI', Arial, Helvetica, sans-serif" fontSize="21" letterSpacing="0.2">
        <tspan fontWeight="800" fill="#0f2350">iCT</tspan>
        <tspan dx="4" fontWeight="500" fill="#0f2350">EUROPA</tspan>
        <tspan dx="5" fontWeight="700" fontSize="17" fill="#29abe2" letterSpacing="0.6">LEGAL</tspan>
      </text>
    </svg>
  );
}
