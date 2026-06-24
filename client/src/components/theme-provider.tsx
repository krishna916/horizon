import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export type Theme = 'light' | 'dark' | 'system';

interface ThemeProviderProps {
  children: ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
}

interface ThemeProviderState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeProviderContext = createContext<ThemeProviderState | undefined>(undefined);

const getSafeStorageItem = (key: string): Theme | null => {
  try {
    if (typeof window !== 'undefined' && window.localStorage && typeof window.localStorage.getItem === 'function') {
      return window.localStorage.getItem(key) as Theme | null;
    }
  } catch (e) {
    // Ignore storage issues in test/restricted environments
  }
  return null;
};

const setSafeStorageItem = (key: string, value: Theme): void => {
  try {
    if (typeof window !== 'undefined' && window.localStorage && typeof window.localStorage.setItem === 'function') {
      window.localStorage.setItem(key, value);
    }
  } catch (e) {
    // Ignore storage issues
  }
};

export function ThemeProvider({
  children,
  defaultTheme = 'system',
  storageKey = 'horizon-ui-theme',
  ...props
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(
    () => getSafeStorageItem(storageKey) || defaultTheme
  );

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');

    if (theme === 'system') {
      const isSystemDark =
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.classList.add(isSystemDark ? 'dark' : 'light');
      return;
    }

    root.classList.add(theme);
  }, [theme]);

  // Listen to system changes
  useEffect(() => {
    if (theme !== 'system') return;
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      const root = window.document.documentElement;
      root.classList.remove('light', 'dark');
      root.classList.add(mediaQuery.matches ? 'dark' : 'light');
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

  const setTheme = (newTheme: Theme) => {
    setSafeStorageItem(storageKey, newTheme);
    setThemeState(newTheme);
  };

  const value = useMemo(() => ({ theme, setTheme }), [theme]);

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
