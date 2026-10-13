import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';
/** Font pairings under evaluation (see globals.css html[data-font]); the user picks one. */
export type FontChoice = 'fredoka' | 'nunito' | 'baloo' | 'quicksand' | 'lexend' | 'system';
export const FONTS: { id: FontChoice; label: string }[] = [
  { id: 'fredoka', label: 'Fredoka + Nunito' },
  { id: 'nunito', label: 'Nunito' },
  { id: 'baloo', label: 'Baloo 2 + Nunito Sans' },
  { id: 'quicksand', label: 'Quicksand + Nunito Sans' },
  { id: 'lexend', label: 'Lexend' },
  { id: 'system', label: 'System (Segoe UI)' },
];
type ThemeState = {
  theme: ThemeChoice;
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: ThemeChoice) => void;
  font: FontChoice;
  setFont: (font: FontChoice) => void;
};
const KEY = 'theme',
  FONT_KEY = 'appFont';
const ThemeContext = createContext<ThemeState>({
  theme: 'system',
  resolvedTheme: 'light',
  setTheme: () => {},
  font: 'fredoka',
  setFont: () => {},
});
const isFont = (v: unknown): v is FontChoice => FONTS.some((f) => f.id === v);
const media = () => matchMedia('(prefers-color-scheme: dark)');
const resolve = (theme: ThemeChoice) =>
  theme === 'system' ? (media().matches ? 'dark' : 'light') : theme;

/**
 * Light/dark/system theme shared by every extension page. The choice lives in
 * chrome.storage.local so the recorder and editor stay in sync; `.dark` on <html> drives tokens.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setChoice] = useState<ThemeChoice>('system');
  const [font, setFontChoice] = useState<FontChoice>('fredoka');
  const [resolvedTheme, setResolved] = useState<'light' | 'dark'>(() => resolve('system'));
  useEffect(() => {
    void chrome.storage?.local
      ?.get([KEY, FONT_KEY])
      .then((stored) => {
        const value = stored[KEY];
        if (value === 'light' || value === 'dark' || value === 'system') setChoice(value);
        if (isFont(stored[FONT_KEY])) setFontChoice(stored[FONT_KEY]);
      })
      .catch(() => {});
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      const value = changes[KEY]?.newValue;
      if (area === 'local' && (value === 'light' || value === 'dark' || value === 'system'))
        setChoice(value);
      const nextFont = changes[FONT_KEY]?.newValue;
      if (area === 'local' && isFont(nextFont)) setFontChoice(nextFont);
    };
    chrome.storage?.onChanged?.addListener(changed);
    return () => chrome.storage?.onChanged?.removeListener(changed);
  }, []);
  useEffect(() => {
    const apply = () => {
      const next = resolve(theme);
      setResolved(next);
      document.documentElement.classList.toggle('dark', next === 'dark');
      document.documentElement.style.colorScheme = next;
    };
    apply();
    const query = media();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, [theme]);
  useEffect(() => {
    document.documentElement.dataset.font = font;
  }, [font]);
  const setFont = useCallback((next: FontChoice) => {
    setFontChoice(next);
    void chrome.storage?.local?.set({ [FONT_KEY]: next }).catch(() => {});
  }, []);
  const setTheme = useCallback((next: ThemeChoice) => {
    setChoice(next);
    void chrome.storage?.local?.set({ [KEY]: next }).catch(() => {});
  }, []);
  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, font, setFont }}>
      {children}
    </ThemeContext.Provider>
  );
}
export const useTheme = () => useContext(ThemeContext);
