/* eslint-disable @typescript-eslint/no-unused-vars */
// 20 logo + 10 favicon SVG concepts for the firefly app.
// Each is a self-contained inline SVG component so the user can compare in
// one place at /design. After picking, copy the chosen SVG into layout.tsx
// (logo) and app/icon.svg (favicon).

import * as React from "react";

type LogoProps = { size?: number; className?: string };

const Wrap = ({ size = 64, className, children }: LogoProps & { children: React.ReactNode }) => (
  <svg
    viewBox="0 0 64 64"
    width={size}
    height={size}
    xmlns="http://www.w3.org/2000/svg"
    className={className}
  >
    {children}
  </svg>
);

const AMBER = "#f59e0b";
const AMBER_LIGHT = "#fbbf24";
const AMBER_DEEP = "#b45309";
const CREAM = "#fef3c7";
const INK = "#1c1917";

// --- Glow definition reused across many logos
const Glow = ({ id }: { id: string }) => (
  <defs>
    <radialGradient id={id} cx="50%" cy="50%" r="50%">
      <stop offset="0%" stopColor={AMBER_LIGHT} stopOpacity="1" />
      <stop offset="60%" stopColor={AMBER} stopOpacity="0.6" />
      <stop offset="100%" stopColor={AMBER} stopOpacity="0" />
    </radialGradient>
  </defs>
);

// =============================================================================
// 20 LOGO CONCEPTS
// =============================================================================

export const LOGOS: { id: number; name: string; description: string; render: (p?: LogoProps) => React.ReactElement }[] = [
  {
    id: 1,
    name: "Solid dot",
    description: "Pure amber circle — minimal, current style.",
    render: (p) => (
      <Wrap {...p}>
        <circle cx="32" cy="32" r="14" fill={AMBER} />
      </Wrap>
    ),
  },
  {
    id: 2,
    name: "Glowing dot",
    description: "Solid dot with soft amber halo.",
    render: (p) => (
      <Wrap {...p}>
        <Glow id="g2" />
        <circle cx="32" cy="32" r="28" fill="url(#g2)" />
        <circle cx="32" cy="32" r="10" fill={AMBER_LIGHT} />
      </Wrap>
    ),
  },
  {
    id: 3,
    name: "Spark / 4-point star",
    description: "Diamond burst — energetic.",
    render: (p) => (
      <Wrap {...p}>
        <path
          d="M32 6 L37 28 L58 32 L37 36 L32 58 L27 36 L6 32 L27 28 Z"
          fill={AMBER}
        />
      </Wrap>
    ),
  },
  {
    id: 4,
    name: "Trail dot",
    description: "Dot with a curved tail — firefly in motion.",
    render: (p) => (
      <Wrap {...p}>
        <path
          d="M52 18 Q 32 24 18 44"
          stroke={AMBER}
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
          opacity="0.4"
        />
        <circle cx="52" cy="18" r="8" fill={AMBER} />
      </Wrap>
    ),
  },
  {
    id: 5,
    name: "Two dots",
    description: "Large + small dot — pair of fireflies.",
    render: (p) => (
      <Wrap {...p}>
        <circle cx="38" cy="36" r="14" fill={AMBER} />
        <circle cx="18" cy="20" r="6" fill={AMBER_LIGHT} />
      </Wrap>
    ),
  },
  {
    id: 6,
    name: "Cluster",
    description: "Five scattered fireflies.",
    render: (p) => (
      <Wrap {...p}>
        <circle cx="18" cy="20" r="4" fill={AMBER} />
        <circle cx="40" cy="14" r="3" fill={AMBER_LIGHT} />
        <circle cx="28" cy="32" r="6" fill={AMBER} />
        <circle cx="48" cy="40" r="4" fill={AMBER} />
        <circle cx="22" cy="48" r="3" fill={AMBER_LIGHT} />
      </Wrap>
    ),
  },
  {
    id: 7,
    name: "Lowercase f, glowing tittle",
    description: "Brand letter; the dot above is the glow.",
    render: (p) => (
      <Wrap {...p}>
        <Glow id="g7" />
        <circle cx="32" cy="14" r="14" fill="url(#g7)" />
        <text
          x="32"
          y="56"
          textAnchor="middle"
          fontSize="48"
          fontWeight="900"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
          fill={INK}
        >
          f
        </text>
        <circle cx="32" cy="14" r="6" fill={AMBER_LIGHT} />
      </Wrap>
    ),
  },
  {
    id: 8,
    name: "f in circle",
    description: "Lowercase f inside an amber ring.",
    render: (p) => (
      <Wrap {...p}>
        <circle cx="32" cy="32" r="26" fill="none" stroke={AMBER} strokeWidth="4" />
        <text
          x="32"
          y="44"
          textAnchor="middle"
          fontSize="32"
          fontWeight="900"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
          fill={AMBER}
        >
          f
        </text>
      </Wrap>
    ),
  },
  {
    id: 9,
    name: "F in square (filled)",
    description: "Bold amber square, cream F inside.",
    render: (p) => (
      <Wrap {...p}>
        <rect x="6" y="6" width="52" height="52" rx="10" fill={AMBER} />
        <text
          x="32"
          y="44"
          textAnchor="middle"
          fontSize="32"
          fontWeight="900"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
          fill={CREAM}
        >
          F
        </text>
      </Wrap>
    ),
  },
  {
    id: 10,
    name: "Concentric rings",
    description: "Dot with two radiating amber rings.",
    render: (p) => (
      <Wrap {...p}>
        <circle cx="32" cy="32" r="26" fill="none" stroke={AMBER} strokeWidth="2" opacity="0.3" />
        <circle cx="32" cy="32" r="18" fill="none" stroke={AMBER} strokeWidth="2" opacity="0.6" />
        <circle cx="32" cy="32" r="10" fill={AMBER} />
      </Wrap>
    ),
  },
  {
    id: 11,
    name: "Lightning bolt",
    description: "Stylized amber bolt — bright spark.",
    render: (p) => (
      <Wrap {...p}>
        <path
          d="M36 6 L18 36 L30 36 L28 58 L46 28 L34 28 Z"
          fill={AMBER}
        />
      </Wrap>
    ),
  },
  {
    id: 12,
    name: "Lantern (minimal)",
    description: "Tiny lantern silhouette with amber inside.",
    render: (p) => (
      <Wrap {...p}>
        <rect x="22" y="20" width="20" height="28" rx="3" fill="none" stroke={INK} strokeWidth="3" />
        <circle cx="32" cy="34" r="6" fill={AMBER} />
        <path d="M26 14 L26 20 M38 14 L38 20" stroke={INK} strokeWidth="3" strokeLinecap="round" />
        <path d="M28 14 L36 14" stroke={INK} strokeWidth="3" strokeLinecap="round" />
      </Wrap>
    ),
  },
  {
    id: 13,
    name: "Crescent moon + dot",
    description: "Dark crescent with amber firefly beside it.",
    render: (p) => (
      <Wrap {...p}>
        <path
          d="M44 12 A 22 22 0 1 0 44 52 A 16 16 0 1 1 44 12 Z"
          fill={INK}
        />
        <circle cx="14" cy="20" r="5" fill={AMBER} />
      </Wrap>
    ),
  },
  {
    id: 14,
    name: "Triangle + dot",
    description: "Geometric triangle outlined, glowing dot center.",
    render: (p) => (
      <Wrap {...p}>
        <path
          d="M32 8 L56 52 L8 52 Z"
          fill="none"
          stroke={INK}
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <circle cx="32" cy="38" r="7" fill={AMBER} />
      </Wrap>
    ),
  },
  {
    id: 15,
    name: "Hexagon + dot",
    description: "Bold amber hexagon with cream dot.",
    render: (p) => (
      <Wrap {...p}>
        <path
          d="M32 6 L54 19 L54 45 L32 58 L10 45 L10 19 Z"
          fill={AMBER}
        />
        <circle cx="32" cy="32" r="8" fill={CREAM} />
      </Wrap>
    ),
  },
  {
    id: 16,
    name: "Eye / watchful lens",
    description: "Almond eye shape, amber pupil — cozy presence.",
    render: (p) => (
      <Wrap {...p}>
        <path
          d="M6 32 Q 32 6 58 32 Q 32 58 6 32 Z"
          fill="none"
          stroke={INK}
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <circle cx="32" cy="32" r="8" fill={AMBER} />
      </Wrap>
    ),
  },
  {
    id: 17,
    name: "Spiral",
    description: "Spiraling amber line — firefly path.",
    render: (p) => (
      <Wrap {...p}>
        <path
          d="M32 32 m-4 0 a 4 4 0 1 1 8 0 a 8 8 0 1 1 -16 0 a 12 12 0 1 1 24 0 a 16 16 0 1 1 -32 0"
          fill="none"
          stroke={AMBER}
          strokeWidth="3"
          strokeLinecap="round"
        />
      </Wrap>
    ),
  },
  {
    id: 18,
    name: "Wing + dot",
    description: "Abstract wing curve with firefly dot.",
    render: (p) => (
      <Wrap {...p}>
        <path
          d="M8 44 Q 24 12 56 8"
          fill="none"
          stroke={INK}
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path
          d="M8 44 Q 32 28 56 8"
          fill="none"
          stroke={INK}
          strokeWidth="3"
          strokeLinecap="round"
          opacity="0.4"
        />
        <circle cx="56" cy="8" r="6" fill={AMBER} />
      </Wrap>
    ),
  },
  {
    id: 19,
    name: "Vertical streak",
    description: "Single firefly rising — tall amber gradient streak.",
    render: (p) => (
      <Wrap {...p}>
        <defs>
          <linearGradient id="streak19" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={AMBER_LIGHT} stopOpacity="0" />
            <stop offset="100%" stopColor={AMBER} stopOpacity="1" />
          </linearGradient>
        </defs>
        <rect x="28" y="6" width="8" height="44" rx="4" fill="url(#streak19)" />
        <circle cx="32" cy="52" r="8" fill={AMBER} />
      </Wrap>
    ),
  },
  {
    id: 20,
    name: "Diamond + dot",
    description: "Bold diamond outline with center amber dot.",
    render: (p) => (
      <Wrap {...p}>
        <path
          d="M32 6 L58 32 L32 58 L6 32 Z"
          fill={INK}
        />
        <circle cx="32" cy="32" r="10" fill={AMBER_LIGHT} />
      </Wrap>
    ),
  },
];

// =============================================================================
// 10 FAVICON CONCEPTS (smaller, simpler — must read at 16-32px)
// =============================================================================

export const FAVICONS: { id: number; name: string; render: (p?: LogoProps) => React.ReactElement }[] = [
  {
    id: 1,
    name: "Solid dot",
    render: (p) => (
      <Wrap {...p}>
        <circle cx="32" cy="32" r="22" fill={AMBER} />
      </Wrap>
    ),
  },
  {
    id: 2,
    name: "Dot on dark",
    render: (p) => (
      <Wrap {...p}>
        <rect x="0" y="0" width="64" height="64" rx="14" fill={INK} />
        <circle cx="32" cy="32" r="16" fill={AMBER} />
      </Wrap>
    ),
  },
  {
    id: 3,
    name: "Ring",
    render: (p) => (
      <Wrap {...p}>
        <circle cx="32" cy="32" r="22" fill="none" stroke={AMBER} strokeWidth="8" />
      </Wrap>
    ),
  },
  {
    id: 4,
    name: "Bold f",
    render: (p) => (
      <Wrap {...p}>
        <rect x="0" y="0" width="64" height="64" rx="14" fill={AMBER} />
        <text
          x="32"
          y="50"
          textAnchor="middle"
          fontSize="48"
          fontWeight="900"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
          fill={INK}
        >
          f
        </text>
      </Wrap>
    ),
  },
  {
    id: 5,
    name: "Lightning bolt",
    render: (p) => (
      <Wrap {...p}>
        <rect x="0" y="0" width="64" height="64" rx="14" fill={INK} />
        <path d="M36 8 L18 36 L30 36 L28 56 L46 28 L34 28 Z" fill={AMBER} />
      </Wrap>
    ),
  },
  {
    id: 6,
    name: "Triangle",
    render: (p) => (
      <Wrap {...p}>
        <rect x="0" y="0" width="64" height="64" rx="14" fill={AMBER} />
        <path d="M32 14 L52 46 L12 46 Z" fill={CREAM} />
      </Wrap>
    ),
  },
  {
    id: 7,
    name: "Hexagon",
    render: (p) => (
      <Wrap {...p}>
        <path d="M32 4 L58 18 L58 46 L32 60 L6 46 L6 18 Z" fill={AMBER} />
        <circle cx="32" cy="32" r="10" fill={CREAM} />
      </Wrap>
    ),
  },
  {
    id: 8,
    name: "Spark",
    render: (p) => (
      <Wrap {...p}>
        <path
          d="M32 4 L38 26 L60 32 L38 38 L32 60 L26 38 L4 32 L26 26 Z"
          fill={AMBER}
        />
      </Wrap>
    ),
  },
  {
    id: 9,
    name: "Two dots",
    render: (p) => (
      <Wrap {...p}>
        <rect x="0" y="0" width="64" height="64" rx="14" fill={INK} />
        <circle cx="40" cy="36" r="14" fill={AMBER} />
        <circle cx="18" cy="18" r="6" fill={AMBER_LIGHT} />
      </Wrap>
    ),
  },
  {
    id: 10,
    name: "Concentric rings",
    render: (p) => (
      <Wrap {...p}>
        <circle cx="32" cy="32" r="28" fill="none" stroke={AMBER} strokeWidth="4" opacity="0.3" />
        <circle cx="32" cy="32" r="18" fill="none" stroke={AMBER} strokeWidth="4" opacity="0.6" />
        <circle cx="32" cy="32" r="10" fill={AMBER} />
      </Wrap>
    ),
  },
];
