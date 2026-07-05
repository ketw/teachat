import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

// ── Theme shape ───────────────────────────────────────────────────────────────
export interface Theme {
  // Background
  bgMode:         'color' | 'image';
  bgColor:        string;
  bgImage:        string;       // data URL or ''
  bgImageBlur:    number;       // px 0–20
  bgImageOpacity: number;       // 0–1
  bgImageSize:    'cover' | 'contain' | 'auto' | 'fill' | 'fit-width' | 'fit-height' | 'center' | 'tile' | 'tile-x' | 'tile-y' | 'stretch';

  // Core colors
  fgColor:        string;       // foreground / text
  accentColor:    string;       // highlight accent
  paperColor:     string;       // window/panel background

  // Borders
  borderOpacity:  number;

  // Corner radii — granular per-element control
  radii: {
    globalEnabled:    boolean;
    globalValue:      number;
    frameInnerEnabled: boolean;  // whether inner frame radius is applied
    frameInner:       number;
    frameOuter:       boolean;   // whether outer frame radius is applied
    windows:          number;
    panels:           number;
    buttons:          number;
    inputs:           number;
    bar:              number;
  };

  // Frame (outer margin border)
  frameSize:      number;       // px
  frameColor:     string;       // defaults to bgColor

  // Windows
  windowTitlebarHeight: number; // px
  windowFocusedBorder:  string; // color
  windowUnfocusedOp:    number; // opacity 0–1

  // Floating bar
  barScale:       number;       // 0.7–1.5 multiplier

  // Noise
  noiseOpacity:   number;       // 0–1 (0 = off)

  // Font
  fontMono:       string;
  fontDisplay:    string;
}

// ── Defaults ─────────────────────────────────────────────────────────────────
export const DEFAULT_THEME: Theme = {
  bgMode:               'color',
  bgColor:              '#231f20',   // Nordic Hearth — smoky espresso
  bgImage:              '',
  bgImageBlur:          0,
  bgImageOpacity:       0.55,
  bgImageSize:          'cover',

  fgColor:              '#f4f1de',   // alabaster cream
  accentColor:          '#e07a5f',   // terracotta
  paperColor:           '#2f2b2c',   // warm charcoal

  borderOpacity:        0.22,
  radii: {
    globalEnabled: false,
    globalValue:   4,
    frameInnerEnabled: true,
    frameInner:    4,
    frameOuter:    false,
    windows:       4,
    panels:        4,
    buttons:       4,
    inputs:        4,
    bar:           4,
  },

  frameSize:            10,
  frameColor:           '',

  windowTitlebarHeight: 32,
  windowFocusedBorder:  '',
  windowUnfocusedOp:    0.88,

  barScale:             1,

  noiseOpacity:         0.07,

  fontMono:    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Courier New", monospace',
  fontDisplay: '"Georgia", "Times New Roman", serif',
};

const PRESETS: Record<string, Partial<Theme>> = {
  'Nordic Hearth': {},  // all defaults
  'Dusk': {
    bgColor: '#1c1b22', fgColor: '#c9c5d3', accentColor: '#9d8cff',
    paperColor: '#252330', borderOpacity: 0.22,
    frameSize: 12, frameColor: '', windowTitlebarHeight: 32,
    windowFocusedBorder: '', windowUnfocusedOp: 0.85,
    barScale: 1, noiseOpacity: 0.06,
  },
  'Ket': {
    bgColor: '#302b3f', fgColor: '#d2afb4', accentColor: '#d2afb4',
    paperColor: '#302b3f', borderOpacity: 0.55,
    radii: { globalEnabled: false, globalValue: 0, frameInner: 0, frameOuter: false, windows: 0, panels: 0, buttons: 0, inputs: 0, bar: 0 },
    frameSize: 4, frameColor: '#d2afb4', windowTitlebarHeight: 24,
    windowFocusedBorder: '', windowUnfocusedOp: 1,
    barScale: 1.03, noiseOpacity: 0.09,
  },
  'Hermes Blue': {
    bgColor: '#0000f2', fgColor: '#f5f5f5', accentColor: '#edff45',
    paperColor: '#ffffff', borderOpacity: 0.14,
    radii: { globalEnabled: false, globalValue: 0, frameInner: 0, frameOuter: false, windows: 0, panels: 0, buttons: 0, inputs: 0, bar: 0 },
    frameSize: 22, frameColor: '', windowTitlebarHeight: 38,
    windowFocusedBorder: '', windowUnfocusedOp: 1, barScale: 1, noiseOpacity: 0.18,
  },
  'Dark Slate': {
    bgColor: '#0f1117', fgColor: '#e8e8e8', accentColor: '#7c6af7',
    paperColor: '#1a1d27', frameSize: 16,
    windowFocusedBorder: 'rgba(124,106,247,0.5)',
  },
  'Terminal Green': {
    bgColor: '#030f03', fgColor: '#00ff41', accentColor: '#00ff41',
    paperColor: '#071007', borderOpacity: 0.25,
    windowFocusedBorder: 'rgba(0,255,65,0.4)',
    radii: { globalEnabled: false, globalValue: 0, frameInner: 0, frameOuter: false, windows: 0, panels: 0, buttons: 0, inputs: 0, bar: 0 },
  },
  'Warm Cream': {
    bgColor: '#1a1208', fgColor: '#f0e6c8', accentColor: '#f5a623',
    paperColor: '#f5edd8', borderOpacity: 0.12,
    windowFocusedBorder: 'rgba(245,166,35,0.5)',
  },
  'Deep Purple': {
    bgColor: '#12002b', fgColor: '#e8d5ff', accentColor: '#bf5fff',
    paperColor: '#1e0040', borderOpacity: 0.2,
    windowFocusedBorder: 'rgba(191,95,255,0.55)',
  },
  'Twilight Spruce': {
    bgColor: '#1e2522', fgColor: '#e2e8f0', accentColor: '#dda15e',
    paperColor: '#2a332f', borderOpacity: 0.2,
    frameSize: 10, frameColor: '', windowTitlebarHeight: 32,
    windowFocusedBorder: '', windowUnfocusedOp: 0.88, barScale: 1, noiseOpacity: 0.07,
  },
  'Velvet Eclipse': {
    bgColor: '#1f1f2e', fgColor: '#eaeaea', accentColor: '#94d2bd',
    paperColor: '#2a2b3d', borderOpacity: 0.2,
    radii: { globalEnabled: false, globalValue: 6, frameInner: 6, frameOuter: false, windows: 6, panels: 6, buttons: 6, inputs: 6, bar: 6 },
    frameSize: 10, frameColor: '', windowTitlebarHeight: 32,
    windowFocusedBorder: '', windowUnfocusedOp: 0.88, barScale: 1, noiseOpacity: 0.05,
  },
};

// ── helpers ───────────────────────────────────────────────────────────────────
function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}

function fgDerived(fgColor: string, opacity: number): string {
  const rgb = hexToRgb(fgColor);
  if (!rgb) return `rgba(245,245,245,${opacity})`;
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${opacity})`;
}

// border-paper: blend of paper color with bg color at borderOpacity
// creates a subtle tint of bg on paper backgrounds
function paperDerived(paperColor: string, bgColor: string, opacity: number): string {
  const rgb = hexToRgb(bgColor);
  if (!rgb) return `rgba(0,0,0,${opacity * 0.5})`;
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${Math.min(opacity, 0.35)})`;
}

function applyTheme(t: Theme) {
  const r = document.documentElement.style;
  const effectiveBg = t.bgMode === 'image' && t.bgImage ? t.bgColor : t.bgColor;
  const effectiveFrame = t.frameColor || t.bgColor;

  r.setProperty('--hw-bg',           t.bgColor);
  r.setProperty('--hw-fg',           t.fgColor);
  r.setProperty('--hw-accent',       t.accentColor);
  r.setProperty('--hw-paper',        t.paperColor);

  // fg opacity variants — derived from fgColor
  r.setProperty('--hw-fg-50',  fgDerived(t.fgColor, 0.50));
  r.setProperty('--hw-fg-30',  fgDerived(t.fgColor, 0.30));
  r.setProperty('--hw-fg-15',  fgDerived(t.fgColor, 0.15));
  r.setProperty('--hw-fg-08',  fgDerived(t.fgColor, 0.08));
  r.setProperty('--hw-fg-04',  fgDerived(t.fgColor, 0.04));

  r.setProperty('--border',          fgDerived(t.fgColor, t.borderOpacity));
  r.setProperty('--border-paper',    paperDerived(t.paperColor, t.bgColor, t.borderOpacity));

  // ── Corner radii — resolve effective values ────────────────
  const R = t.radii;
  const eff = (v: number) => R.globalEnabled ? R.globalValue : v;

  r.setProperty('--r-window',      `${eff(R.windows)}px`);
  r.setProperty('--r-panel',       `${eff(R.panels)}px`);
  r.setProperty('--r-button',      `${eff(R.buttons)}px`);
  r.setProperty('--r-input',       `${eff(R.inputs)}px`);
  r.setProperty('--r-bar',         `${eff(R.bar)}px`);

  // inner toggle gates whether inner radius is applied — fully independent
  const innerVal = R.frameInnerEnabled ? eff(R.frameInner) : 0;
  r.setProperty('--r-frame-inner', `${innerVal}px`);

  // outer toggle gates whether outer radius is applied — fully independent
  // outer uses its OWN resolved value, NOT innerVal, so toggling inner never affects outer
  const outerVal = R.frameOuter ? eff(R.frameInner) + t.frameSize : 0;
  r.setProperty('--r-frame-outer', `${outerVal}px`);

  // --border-radius alias for windows
  r.setProperty('--border-radius', `${eff(R.windows)}px`);

  r.setProperty('--frame-size',      `${t.frameSize}px`);
  r.setProperty('--frame-color',     effectiveFrame);

  r.setProperty('--win-titlebar-h',  `${t.windowTitlebarHeight}px`);
  // focused border — if empty or not set, derive from accent color
  const focusBorder = t.windowFocusedBorder || fgDerived(t.accentColor, 0.7);
  r.setProperty('--win-focus-border', focusBorder);
  r.setProperty('--win-unfocus-op',  String(t.windowUnfocusedOp));

  r.setProperty('--bar-scale',       String(t.barScale));

  r.setProperty('--noise-opacity',   String(t.noiseOpacity));

  r.setProperty('--font-mono',       t.fontMono);
  r.setProperty('--font-display',    t.fontDisplay);
}

// ── Context ───────────────────────────────────────────────────────────────────
interface ThemeContextValue {
  theme: Theme;
  set: (patch: Partial<Theme>) => void;
  reset: () => void;
  applyPreset: (name: string) => void;
  presetNames: string[];
  exportTheme: () => string;
  importTheme: (json: string) => boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'teachat_theme_v1';

function loadSaved(): Theme {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_THEME, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_THEME;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(loadSaved);

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
  }, [theme]);

  const set = useCallback((patch: Partial<Theme>) => {
    setTheme(prev => ({ ...prev, ...patch }));
  }, []);

  const reset = useCallback(() => setTheme(DEFAULT_THEME), []);

  const applyPreset = useCallback((name: string) => {
    const preset = PRESETS[name];
    if (preset) setTheme({ ...DEFAULT_THEME, ...preset });
  }, []);

  const exportTheme = useCallback(() => JSON.stringify(theme, null, 2), [theme]);

  const importTheme = useCallback((json: string) => {
    try {
      const parsed = JSON.parse(json);
      setTheme({ ...DEFAULT_THEME, ...parsed });
      return true;
    } catch { return false; }
  }, []);

  return (
    <ThemeContext.Provider value={{
      theme, set, reset, applyPreset,
      presetNames: Object.keys(PRESETS),
      exportTheme, importTheme,
    }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
