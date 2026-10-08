import React from 'react';

export const mix = (cssColor: string, pct: number) =>
  `color-mix(in srgb, ${cssColor} ${pct}%, transparent)`;

export const Card: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{
    background: 'var(--panel)',
    border: '1px solid var(--line)',
    borderRadius: 6,
    padding: '10px 12px',
    ...style,
  }}>
    {children}
  </div>
);

export const Label: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{
    fontSize: 10, letterSpacing: 1.4, color: 'var(--main-mute)',
    textTransform: 'uppercase', fontWeight: 600, ...style,
  }}>
    {children}
  </div>
);

export const Btn: React.FC<{
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  accent?: boolean;
  disabled?: boolean;
  style?: React.CSSProperties;
  title?: string;
}> = ({ children, onClick, active, accent, disabled, style, title }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={title}
    style={{
      padding: '7px 10px',
      border: `1px solid ${accent || active ? 'var(--main)' : 'var(--line)'}`,
      borderRadius: 4,
      background: accent ? mix('var(--main)', 18) : active ? mix('var(--main)', 12) : 'transparent',
      color: disabled ? 'var(--main-mute)' : accent || active ? 'var(--main)' : 'var(--main-soft)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      fontSize: 12, fontWeight: 600, letterSpacing: 0.6,
      textAlign: 'left', width: '100%',
      opacity: disabled ? 0.5 : 1,
      transition: 'background 0.12s, border-color 0.12s',
      ...style,
    }}
  >
    {children}
  </button>
);
