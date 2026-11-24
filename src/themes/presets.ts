import type { AppSettings, CustomThemeColors, FontFamily, ThemePreset } from "../types/models";

export interface ResolvedPalette {
  background: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  accentText: string;
}

export const THEME_PALETTES: Record<Exclude<ThemePreset, "custom">, ResolvedPalette> = {
  light: {
    background: "#f8f9fa",
    surface: "#ffffff",
    surfaceAlt: "#eef2f6",
    text: "#18212b",
    muted: "#52606d",
    border: "#d8dee6",
    accent: "#0f766e",
    accentText: "#ffffff",
  },
  dark: {
    background: "#12161b",
    surface: "#1a2028",
    surfaceAlt: "#242c37",
    text: "#e6edf3",
    muted: "#9aa8b8",
    border: "#303a47",
    accent: "#2dd4bf",
    accentText: "#0b1917",
  },
  sepia: {
    background: "#f4ecd8",
    surface: "#fbf5e6",
    surfaceAlt: "#eadfc6",
    text: "#3a2e21",
    muted: "#6d5c49",
    border: "#d7c7a7",
    accent: "#9a4a1a",
    accentText: "#ffffff",
  },
  "high-contrast": {
    background: "#000000",
    surface: "#0a0a0a",
    surfaceAlt: "#1a1a1a",
    text: "#ffffff",
    muted: "#ffd600",
    border: "#ffffff",
    accent: "#00e5ff",
    accentText: "#000000",
  },
};

export function resolvePalette(
  settings: Pick<AppSettings, "themePreset" | "followSystemTheme" | "customTheme">,
  systemPrefersDark: boolean,
): ResolvedPalette {
  if (settings.themePreset === "custom") {
    return buildCustomPalette(settings.customTheme);
  }
  if (settings.followSystemTheme && settings.themePreset !== "high-contrast") {
    return systemPrefersDark ? THEME_PALETTES.dark : THEME_PALETTES.light;
  }
  return THEME_PALETTES[settings.themePreset];
}

function buildCustomPalette(custom: CustomThemeColors): ResolvedPalette {
  return {
    background: custom.background,
    surface: custom.surface,
    surfaceAlt: custom.surface,
    text: custom.text,
    muted: custom.text,
    border: custom.accent,
    accent: custom.accent,
    accentText: "#ffffff",
  };
}

export function getLocalFontStack(family: FontFamily): string {
  switch (family) {
    case "sans":
      return '"Segoe UI", "Noto Sans", "Liberation Sans", system-ui, -apple-system, sans-serif';
    case "mono":
      return '"Cascadia Mono", "Consolas", "JetBrains Mono", "Liberation Mono", monospace';
    case "serif":
    default:
      return '"Georgia", "Liberation Serif", "Noto Serif", "Times New Roman", serif';
  }
}

export function buildReaderIframeCss(
  settings: Pick<
    AppSettings,
    | "themePreset"
    | "followSystemTheme"
    | "customTheme"
    | "fontFamily"
    | "fontSizePx"
    | "lineHeight"
    | "marginPx"
    | "textAlign"
  >,
  systemPrefersDark: boolean,
): string {
  const pal = resolvePalette(settings, systemPrefersDark);
  const stack = getLocalFontStack(settings.fontFamily);
  return `
    :root { color-scheme: ${pal.background === "#12161b" || pal.background === "#000000" ? "dark" : "light"}; }
    html, body {
      background-color: ${pal.background} !important;
      color: ${pal.text} !important;
      font-family: ${stack} !important;
      font-size: ${settings.fontSizePx}px !important;
      line-height: ${settings.lineHeight} !important;
      text-align: ${settings.textAlign} !important;
      padding: 28px ${settings.marginPx}px 64px ${settings.marginPx}px !important;
      max-width: 78ch;
      margin: 0 auto !important;
    }
    a { color: ${pal.accent}; }
    blockquote { border-left: 3px solid ${pal.accent}; padding-left: 14px; opacity: 0.9; }
    code, pre { background: ${pal.surfaceAlt}; padding: 2px 5px; border-radius: 4px; }
    mark.essvb-highlight { color: inherit; cursor: pointer; transition: box-shadow 0.25s ease; }
    mark.essvb-highlight-pulse {
      outline: 2px solid ${pal.accent};
      box-shadow: 0 0 0 4px rgba(45, 212, 191, 0.35);
    }
    mark.essvb-tts-active {
      background-color: rgba(45, 212, 191, 0.32);
      color: inherit;
      border-radius: 3px;
    }
  `;
}

export function applyThemeToDocument(palette: ResolvedPalette): void {
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  root.style.setProperty("--bg", palette.background);
  root.style.setProperty("--surface", palette.surface);
  root.style.setProperty("--surface-alt", palette.surfaceAlt);
  root.style.setProperty("--text", palette.text);
  root.style.setProperty("--muted", palette.muted);
  root.style.setProperty("--border", palette.border);
  root.style.setProperty("--accent", palette.accent);
  root.style.setProperty("--accent-text", palette.accentText);
}
