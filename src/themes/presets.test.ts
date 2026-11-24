import { describe, expect, it } from "vitest";
import { buildReaderIframeCss, resolvePalette, THEME_PALETTES } from "./presets";

describe("theme presets", () => {
  it("follows system dark preference when enabled for non-high-contrast presets", () => {
    const pal = resolvePalette(
      {
        themePreset: "light",
        followSystemTheme: true,
        customTheme: {
          background: "#111111",
          text: "#eeeeee",
          surface: "#222222",
          accent: "#00aa88",
        },
      },
      true,
    );
    expect(pal.background).toBe(THEME_PALETTES.dark.background);
  });

  it("respects custom theme and high-contrast without system override", () => {
    const hc = resolvePalette(
      {
        themePreset: "high-contrast",
        followSystemTheme: true,
        customTheme: {
          background: "#111111",
          text: "#eeeeee",
          surface: "#222222",
          accent: "#00aa88",
        },
      },
      false,
    );
    expect(hc.background).toBe("#000000");

    const custom = resolvePalette(
      {
        themePreset: "custom",
        followSystemTheme: true,
        customTheme: {
          background: "#101010",
          text: "#fafafa",
          surface: "#202020",
          accent: "#ff6600",
        },
      },
      false,
    );
    expect(custom.background).toBe("#101010");
  });

  it("produces local-only CSS without external URLs or @import", () => {
    const css = buildReaderIframeCss(
      {
        themePreset: "sepia",
        followSystemTheme: false,
        customTheme: {
          background: "#f4ecd8",
          text: "#3a2e21",
          surface: "#fbf5e6",
          accent: "#9a4a1a",
        },
        fontFamily: "serif",
        fontSizePx: 19,
        lineHeight: 1.8,
        marginPx: 40,
        textAlign: "justify",
      },
      false,
    );
    expect(css).not.toMatch(/https?:\/\//i);
    expect(css).not.toMatch(/@import/i);
    expect(css).toContain("19px");
  });
});
