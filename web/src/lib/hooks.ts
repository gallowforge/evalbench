import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, type Meta } from '../api';

export function useMeta() {
  return useQuery({ queryKey: ['meta'], queryFn: () => api.get<Meta>('/meta'), staleTime: 30_000 });
}

const RATER_KEY = 'evalbench:rater';

function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

/** The rater's name lives in this browser only; it labels ratings, it is not an account. */
export function useRater(): [string, (name: string) => void] {
  const [name, setName] = useState(() => read(RATER_KEY));
  useEffect(() => {
    const onChange = () => setName(read(RATER_KEY));
    window.addEventListener('evalbench:rater', onChange);
    return () => window.removeEventListener('evalbench:rater', onChange);
  }, []);
  const save = (value: string) => {
    try {
      localStorage.setItem(RATER_KEY, value.trim());
    } catch {
      /* private mode: keep it in memory */
    }
    setName(value.trim());
    window.dispatchEvent(new Event('evalbench:rater'));
  };
  return [name, save];
}

export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
