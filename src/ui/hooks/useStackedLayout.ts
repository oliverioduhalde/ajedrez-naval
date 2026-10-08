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
