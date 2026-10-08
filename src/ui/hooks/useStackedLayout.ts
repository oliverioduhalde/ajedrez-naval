import { useEffect, useState } from 'react';

function computeStacked(): boolean {
  return !(window.innerWidth >= 700 && window.innerWidth > window.innerHeight);
}

export function useStackedLayout(): boolean {
  const [stacked, setStacked] = useState(computeStacked);
  useEffect(() => {
    const onResize = () => setStacked(computeStacked());
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);
  return stacked;
}

/** Pantallas muy angostas (celulares en vertical): la franja de controles se compacta. */
export function useNarrowScreen(maxWidth = 520): boolean {
  const [narrow, setNarrow] = useState(() => window.innerWidth < maxWidth);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < maxWidth);
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, [maxWidth]);
  return narrow;
}

/** Pantallas muy bajas (celulares en horizontal): la franja vertical se compacta. */
export function useShortScreen(maxHeight = 480): boolean {
  const [short, setShort] = useState(() => window.innerHeight < maxHeight);
  useEffect(() => {
    const onResize = () => setShort(window.innerHeight < maxHeight);
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, [maxHeight]);
  return short;
}
