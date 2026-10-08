import React from 'react';
import { useSettings } from '../../store/settingsStore';

export const CRTOverlay: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const glitchOn = useSettings(s => s.glitchOn);
  const glitchRate = useSettings(s => s.glitchRate);
  const flickerOn = useSettings(s => s.flickerOn);
  const period = 12 / glitchRate;

  return (
    <div style={{
      position: 'relative',
      width: '100%',
      height: '100%',
      overflow: 'hidden',
      background: '#000a02',
      animation: flickerOn ? 'crt-flicker 8s infinite, flicker-fast 0.15s infinite' : 'none',
    }}>
      <div style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        animation: glitchOn ? `glitch-h ${period}s infinite, glitch-rgb ${period}s infinite` : 'none',
      }}>
        {children}
      </div>

      {/* Scanlines overlay */}
      <div style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 9998,
        backgroundImage: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.18) 0px, rgba(0,0,0,0.18) 1px, transparent 1px, transparent 4px)',
        backgroundSize: '100% 4px',
        animation: 'scanline-scroll 0.12s linear infinite',
      }} />

      {/* Vignette */}
      <div style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 9999,
        background: 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.75) 100%)',
      }} />

      {/* Screen curve reflection */}
      <div style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 9997,
        background: 'radial-gradient(ellipse at 30% 20%, rgba(0,255,100,0.03) 0%, transparent 60%)',
      }} />
    </div>
  );
};
