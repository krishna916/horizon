import { useEffect, useState } from 'react';

export function useLocalDay(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;

    const scheduleNextMidnight = () => {
      const current = new Date();
      const nextMidnight = new Date(
        current.getFullYear(),
        current.getMonth(),
        current.getDate() + 1
      );
      timeoutId = setTimeout(() => {
        setNow(new Date());
        scheduleNextMidnight();
      }, nextMidnight.getTime() - current.getTime());
    };

    const refreshAndReschedule = () => {
      clearTimeout(timeoutId);
      setNow(new Date());
      scheduleNextMidnight();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshAndReschedule();
      }
    };

    scheduleNextMidnight();
    window.addEventListener('focus', refreshAndReschedule);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('focus', refreshAndReschedule);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return now;
}
