import { useState, useEffect, useCallback } from 'react';

/**
 * Hook genérico para persistir estado en localStorage.
 * Lee del storage al montar; escribe al storage cuando el valor cambia.
 * Maneja errores de parse/stringify silenciosamente.
 */
export function useLocalStorage<T>(
  key: string,
  initialValue: T | (() => T)
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored !== null) return JSON.parse(stored);
    } catch {
      // parse error — use initial
    }
    return typeof initialValue === 'function'
      ? (initialValue as () => T)()
      : initialValue;
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage full o no disponible
    }
  }, [key, value]);

  return [value, setValue];
}
