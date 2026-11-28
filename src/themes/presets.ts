import type {
  AppSettings,
  CustomThemeColors,
  FontFamily,
  ReaderLayoutMode,
  ThemePreset,
} from "../types/models";

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
  > & { readerLayoutMode?: ReaderLayoutMode },
  systemPrefersDark: boolean,
): string {
  const pal = resolvePalette(settings, systemPrefersDark);
  const stack = getLocalFontStack(settings.fontFamily);
  const mode = settings.readerLayoutMode ?? "paginated-1";
  const isPaginated = mode === "paginated-1" || mode === "paginated-2";
  const padX = Math.max(16, Math.min(80, settings.marginPx));
  const twoColGap = padX * 2;

  const layoutCss = !isPaginated
    ? `
    html, body {
      padding: 28px ${settings.marginPx}px 64px ${settings.marginPx}px !important;
      max-width: 78ch;
      margin: 0 auto !important;
    }`
    : mode === "paginated-2"
      ? `
    html {
      margin: 0 !important;
      padding: 0 !important;
      width: 100%;
      height: 100vh !important;
      overflow-x: hidden !important;
      overflow-y: hidden !important;
      scrollbar-width: none !important;
      background-color: ${pal.background} !important;
    }
    body {
      margin: 0 !important;
      box-sizing: border-box !important;
      width: 100%;
      height: 100vh !important;
      padding: 26px ${padX}px 28px ${padX}px !important;
      column-count: 2 !important;
      column-gap: ${twoColGap}px !important;
      column-rule: 1px solid ${pal.border};
      column-fill: auto !important;
      background-color: ${pal.background} !important;
    }
    @media (max-width: 760px) {
      body {
        column-count: 1 !important;
        column-gap: 32px !important;
        column-rule: none !important;
        padding: 18px 16px 22px 16px !important;
      }
    }`
      : `
    html {
      margin: 0 !important;
      padding: 0 !important;
      width: 100%;
      height: 100vh !important;
      overflow-x: hidden !important;
      overflow-y: hidden !important;
      scrollbar-width: none !important;
      background-color: ${pal.background} !important;
    }
    body {
      margin: 0 !important;
      box-sizing: border-box !important;
      width: 100%;
      height: 100vh !important;
      padding: 26px ${padX}px 28px ${padX}px !important;
      column-width: calc(100vw - ${padX * 2}px) !important;
      column-gap: ${padX * 2}px !important;
      column-fill: auto !important;
      background-color: ${pal.background} !important;
    }
    @media (max-width: 640px) {
      body {
        padding: 18px 18px 22px 18px !important;
        column-width: calc(100vw - 36px) !important;
        column-gap: 36px !important;
      }
    }`;

  return `
    :root { color-scheme: ${pal.background === "#12161b" || pal.background === "#000000" ? "dark" : "light"}; }
    html, body {
      background-color: ${pal.background} !important;
      color: ${pal.text} !important;
      font-family: ${stack} !important;
      font-size: ${settings.fontSizePx}px !important;
      line-height: ${settings.lineHeight} !important;
      text-align: ${settings.textAlign} !important;
    }
    ${layoutCss}
    img, svg, pre, table { max-width: 100%; break-inside: avoid; }
    h1, h2, h3 { break-after: avoid; }
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
