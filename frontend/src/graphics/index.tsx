/** Brand + category graphics for Prediction Tac. */

export function CatArt({ cat, size = 28 }: { cat: string; size?: number }) {
  const c = (cat || "misc").toLowerCase();
  const common = { width: size, height: size, viewBox: "0 0 48 48", fill: "none", "aria-hidden": true };
  switch (c) {
    case "crypto":
      return (
        <svg {...common}>
          <rect width="48" height="48" rx="14" fill="rgba(46,230,168,0.12)" />
          <circle cx="24" cy="24" r="11" stroke="#2ee6a8" strokeWidth="2.2" />
          <path d="M20 18h6.5c2.2 0 3.8 1.4 3.8 3.2 0 1.5-1 2.6-2.4 3l2.8 5.8h-3.2l-2.5-5.3H22.2V30H20V18zm2.2 2v4.2h3.3c1.1 0 1.8-.6 1.8-1.5s-.7-1.5-1.8-1.5H22.2z" fill="#2ee6a8" />
        </svg>
      );
    case "politics":
      return (
        <svg {...common}>
          <rect width="48" height="48" rx="14" fill="rgba(94,234,212,0.1)" />
          <path d="M10 34h28M14 34V22l10-8 10 8v12" stroke="#5eead4" strokeWidth="2.2" strokeLinejoin="round" />
          <path d="M20 34v-8h8v8" stroke="#5eead4" strokeWidth="2.2" />
        </svg>
      );
    case "sports":
      return (
        <svg {...common}>
          <rect width="48" height="48" rx="14" fill="rgba(34,211,138,0.1)" />
          <circle cx="24" cy="24" r="12" stroke="#22d38a" strokeWidth="2.2" />
          <path d="M24 12c3 3.5 4.5 7.5 4.5 12S27 32.5 24 36c-3-3.5-4.5-7.5-4.5-12S21 15.5 24 12z" stroke="#22d38a" strokeWidth="1.6" />
          <path d="M13 20h22M13 28h22" stroke="#22d38a" strokeWidth="1.4" opacity="0.7" />
        </svg>
      );
    case "tech":
      return (
        <svg {...common}>
          <rect width="48" height="48" rx="14" fill="rgba(56,189,248,0.1)" />
          <rect x="12" y="14" width="24" height="18" rx="3" stroke="#38bdf8" strokeWidth="2.2" />
          <path d="M18 36h12M24 32v4" stroke="#38bdf8" strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="24" cy="23" r="2" fill="#38bdf8" />
        </svg>
      );
    case "culture":
      return (
        <svg {...common}>
          <rect width="48" height="48" rx="14" fill="rgba(240,193,75,0.1)" />
          <path d="M14 30c0-6 4-12 10-14 6 2 10 8 10 14" stroke="#f0c14b" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M18 30h12v4a2 2 0 01-2 2H20a2 2 0 01-2-2v-4z" fill="#f0c14b" opacity="0.85" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <rect width="48" height="48" rx="14" fill="rgba(138,168,154,0.12)" />
          <circle cx="24" cy="24" r="10" stroke="#8aa89a" strokeWidth="2.2" />
          <circle cx="20" cy="22" r="1.5" fill="#8aa89a" />
          <circle cx="28" cy="22" r="1.5" fill="#8aa89a" />
          <path d="M19 28c1.4 1.6 3 2.4 5 2.4s3.6-.8 5-2.4" stroke="#8aa89a" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
  }
}

export function HeroChartArt({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 360 220" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <linearGradient id="haFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2ee6a8" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#2ee6a8" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="haLine" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#22d38a" />
          <stop offset="100%" stopColor="#2ee6a8" />
        </linearGradient>
        <filter id="haGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect width="360" height="220" rx="24" fill="rgba(21,32,28,0.6)" />
      <path d="M24 40h312M24 90h312M24 140h312M24 190h312" stroke="rgba(120,200,170,0.08)" strokeWidth="1" />
      <path d="M40 170 C80 160, 100 120, 140 110 S200 130, 230 90 S280 50, 320 40" stroke="url(#haLine)" strokeWidth="3.5" strokeLinecap="round" filter="url(#haGlow)" fill="none" />
      <path d="M40 170 C80 160, 100 120, 140 110 S200 130, 230 90 S280 50, 320 40 L320 200 L40 200 Z" fill="url(#haFill)" />
      <circle cx="320" cy="40" r="6" fill="#2ee6a8" filter="url(#haGlow)" />
      <rect x="24" y="24" width="64" height="22" rx="8" fill="rgba(34,211,138,0.15)" />
      <text x="36" y="39" fill="#22d38a" fontSize="11" fontFamily="monospace" fontWeight="700">YES 62%</text>
      <rect x="272" y="168" width="64" height="22" rx="8" fill="rgba(255,92,106,0.12)" />
      <text x="284" y="183" fill="#ff5c6a" fontSize="11" fontFamily="monospace" fontWeight="700">NO 38%</text>
    </svg>
  );
}

export function EmptyMarketsArt() {
  return (
    <svg width="120" height="100" viewBox="0 0 120 100" fill="none" aria-hidden>
      <rect x="10" y="18" width="100" height="64" rx="14" stroke="rgba(120,200,170,0.25)" strokeWidth="2" strokeDasharray="5 4" />
      <path d="M30 62 L48 42 L62 54 L90 30" stroke="#2ee6a8" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
      <circle cx="90" cy="30" r="4" fill="#2ee6a8" opacity="0.8" />
      <circle cx="60" cy="70" r="3" fill="rgba(120,200,170,0.35)" />
    </svg>
  );
}

export function EmptyVaultArt() {
  return (
    <svg width="120" height="100" viewBox="0 0 120 100" fill="none" aria-hidden>
      <rect x="28" y="22" width="64" height="54" rx="12" stroke="#2ee6a8" strokeWidth="2.2" opacity="0.7" />
      <circle cx="60" cy="48" r="10" stroke="#2ee6a8" strokeWidth="2" />
      <path d="M60 42v8l5 3" stroke="#2ee6a8" strokeWidth="2" strokeLinecap="round" />
      <path d="M40 22v-4a4 4 0 014-4h32a4 4 0 014 4v4" stroke="#2ee6a8" strokeWidth="2" opacity="0.5" />
    </svg>
  );
}

export function WinBadgeArt() {
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" fill="none" aria-hidden>
      <circle cx="28" cy="28" r="26" fill="rgba(34,211,138,0.12)" stroke="#22d38a" strokeWidth="2" />
      <path d="M18 29l7 7 14-16" stroke="#22d38a" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg className="brand-logo" viewBox="0 0 32 32" width={size} height={size} aria-hidden>
      <defs>
        <linearGradient id="blm" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2ee6a8" />
          <stop offset="1" stopColor="#22d38a" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="rgba(46,230,168,.14)" />
      <path d="M8 22 L14 12 L19 17 L24 8" stroke="url(#blm)" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="24" cy="8" r="2.2" fill="#2ee6a8" />
    </svg>
  );
}

export function LoadingSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="skel-list" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skel-card">
          <div className="skel-line w40" />
          <div className="skel-line w90" />
          <div className="skel-line w70" />
          <div className="skel-bar" />
        </div>
      ))}
    </div>
  );
}
