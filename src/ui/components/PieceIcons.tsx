import React from 'react';
import type { UnitType } from '../../engine/types';

interface IconProps {
  size?: number;
  color?: string;
}

// Acorazado — heavy battleship profile
export const IconAcorazado: React.FC<IconProps> = ({ size = 20, color = '#fff' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path
      d="M2 16 L4 12 L6 11 L8 10 L10 9 L14 9 L16 10 L18 11 L20 12 L22 13 L22 16 Z"
      fill={color} opacity="0.9"
    />
    {/* Tower */}
    <rect x="9" y="6" width="6" height="4" fill={color} opacity="0.95" rx="1" />
    {/* Cannon */}
    <rect x="14" y="7" width="5" height="1.5" fill={color} rx="0.5" />
    {/* Hull detail */}
    <path d="M3 16 L21 16 L20 18 L4 18 Z" fill={color} opacity="0.7" />
    {/* Waterline */}
    <path d="M2 18 Q12 19.5 22 18" stroke={color} strokeWidth="0.8" fill="none" opacity="0.4" />
  </svg>
);

// Crucero — slimmer, faster cruiser
export const IconCrucero: React.FC<IconProps> = ({ size = 20, color = '#fff' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path
      d="M3 15 L6 12 L8 11 L12 10 L16 11 L19 13 L21 15 Z"
      fill={color} opacity="0.9"
    />
    <rect x="10" y="7" width="4" height="4" fill={color} opacity="0.95" rx="1" />
    <rect x="13" y="8" width="4" height="1.2" fill={color} rx="0.5" />
    <path d="M4 15 L20 15 L19 17 L5 17 Z" fill={color} opacity="0.7" />
  </svg>
);

// Fragata — nimble frigate, narrower hull
export const IconFragata: React.FC<IconProps> = ({ size = 20, color = '#fff' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path
      d="M4 15 L7 13 L10 12 L14 12 L17 13 L20 15 Z"
      fill={color} opacity="0.9"
    />
    <rect x="10" y="9" width="4" height="4" fill={color} opacity="0.9" rx="1" />
    <rect x="13" y="10" width="3" height="1" fill={color} rx="0.4" />
    <path d="M5 15 L19 15 L18 17 L6 17 Z" fill={color} opacity="0.65" />
  </svg>
);

// Minador — mine layer, distinctive wide deck
export const IconMinador: React.FC<IconProps> = ({ size = 20, color = '#fff' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path
      d="M3 15 L5 13 L8 12 L16 12 L19 13 L21 15 Z"
      fill={color} opacity="0.9"
    />
    <rect x="8" y="9" width="8" height="3" fill={color} opacity="0.85" rx="1" />
    {/* Mines on deck */}
    <circle cx="10" cy="10.5" r="1.2" fill="none" stroke={color} strokeWidth="0.8" />
    <circle cx="14" cy="10.5" r="1.2" fill="none" stroke={color} strokeWidth="0.8" />
    <path d="M4 15 L20 15 L19 17 L5 17 Z" fill={color} opacity="0.65" />
  </svg>
);

// Submarino — distinctive sub profile
export const IconSubmarino: React.FC<IconProps> = ({ size = 20, color = '#fff' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    {/* Main body */}
    <ellipse cx="12" cy="15" rx="9" ry="3" fill={color} opacity="0.9" />
    {/* Conning tower */}
    <rect x="10" y="9" width="4" height="6" fill={color} opacity="0.95" rx="1" />
    {/* Periscope */}
    <rect x="13" y="6" width="1" height="4" fill={color} rx="0.5" />
    <rect x="12.5" y="6" width="2" height="0.8" fill={color} rx="0.3" />
    {/* Propeller hint */}
    <path d="M21 14 L22 12 M21 14 L22 16" stroke={color} strokeWidth="1" strokeLinecap="round" />
    {/* Depth fins */}
    <path d="M5 15 L3 13 M5 15 L3 17" stroke={color} strokeWidth="1" strokeLinecap="round" />
  </svg>
);

// Avión de Combate — fighter jet, delta wings
export const IconAvionCombate: React.FC<IconProps> = ({ size = 20, color = '#fff' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    {/* Fuselage */}
    <path d="M2 12 L22 12 L20 13 L2 12 Z" fill={color} opacity="0.95" />
    {/* Delta wings */}
    <path d="M6 12 L4 18 L16 12 Z" fill={color} opacity="0.85" />
    <path d="M6 12 L4 6 L16 12 Z" fill={color} opacity="0.85" />
    {/* Tail */}
    <path d="M19 12 L17 9 L21 12 Z" fill={color} opacity="0.75" />
    <path d="M19 12 L17 15 L21 12 Z" fill={color} opacity="0.75" />
    {/* Cockpit */}
    <ellipse cx="8" cy="12" rx="2" ry="1" fill={color} opacity="0.6" />
  </svg>
);

// Avión de Reconocimiento — reconnaissance plane, longer fuselage
export const IconAvionReconocimiento: React.FC<IconProps> = ({ size = 20, color = '#fff' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    {/* Long fuselage */}
    <path d="M1 12 L23 12 L21 12.8 L1 12 Z" fill={color} opacity="0.95" />
    {/* Straight wings */}
    <rect x="8" y="9" width="8" height="1.5" fill={color} opacity="0.85" rx="0.5" />
    <rect x="8" y="13.5" width="8" height="1.5" fill={color} opacity="0.85" rx="0.5" />
    {/* Nose */}
    <circle cx="3" cy="12" r="1.2" fill={color} opacity="0.7" />
    {/* Camera pod */}
    <ellipse cx="13" cy="12" rx="2" ry="0.8" fill={color} opacity="0.5" />
    {/* Tail fins */}
    <path d="M20 12 L18 9.5 L22 12 Z" fill={color} opacity="0.7" />
    <path d="M20 12 L18 14.5 L22 12 Z" fill={color} opacity="0.7" />
  </svg>
);

// Mine icon for board display
export const IconMine: React.FC<IconProps> = ({ size = 14, color = '#fbbf24' }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="5" stroke={color} strokeWidth="1.5" fill={color} fillOpacity="0.25" />
    {/* Spikes */}
    {[0, 45, 90, 135, 180, 225, 270, 315].map(deg => {
      const rad = (deg * Math.PI) / 180;
      return (
        <line
          key={deg}
          x1={8 + 5 * Math.cos(rad)}
          y1={8 + 5 * Math.sin(rad)}
          x2={8 + 7.5 * Math.cos(rad)}
          y2={8 + 7.5 * Math.sin(rad)}
          stroke={color}
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      );
    })}
  </svg>
);

export function getUnitIcon(type: UnitType, size: number, color: string): React.ReactElement {
  switch (type) {
    case 'Acorazado': return <IconAcorazado size={size} color={color} />;
    case 'Crucero': return <IconCrucero size={size} color={color} />;
    case 'Fragata': return <IconFragata size={size} color={color} />;
    case 'Minador': return <IconMinador size={size} color={color} />;
    case 'Submarino': return <IconSubmarino size={size} color={color} />;
    case 'AvionCombate': return <IconAvionCombate size={size} color={color} />;
    case 'AvionReconocimiento': return <IconAvionReconocimiento size={size} color={color} />;
  }
}
