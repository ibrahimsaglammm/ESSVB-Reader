import type { CSSProperties } from "react";
import type { HighlightColor, HighlightStyle } from "../types/models";

export interface HighlightThemeToken {
  swatchHex: string;
  iframeBg: string;
  borderHex: string;
  noteCardBg: string;
  decorationColor: string;
}

export const HIGHLIGHT_THEME: Record<HighlightColor, HighlightThemeToken> = {
  pink: {
    swatchHex: "#f4c2c2",
    iframeBg: "rgba(244, 194, 194, 0.50)",
    borderHex: "#db6f7b",
    noteCardBg: "rgba(244, 194, 194, 0.24)",
    decorationColor: "#db6f7b",
  },
  yellow: {
    swatchHex: "#fde68a",
    iframeBg: "rgba(253, 224, 71, 0.48)",
    borderHex: "#ca8a04",
    noteCardBg: "rgba(253, 224, 71, 0.22)",
    decorationColor: "#ca8a04",
  },
  green: {
    swatchHex: "#bbf7d0",
    iframeBg: "rgba(134, 239, 172, 0.48)",
    borderHex: "#16a34a",
    noteCardBg: "rgba(134, 239, 172, 0.22)",
    decorationColor: "#16a34a",
  },
  blue: {
    swatchHex: "#bfdbfe",
    iframeBg: "rgba(147, 197, 253, 0.48)",
    borderHex: "#2563eb",
    noteCardBg: "rgba(147, 197, 253, 0.22)",
    decorationColor: "#2563eb",
  },
  purple: {
    swatchHex: "#ddd6fe",
    iframeBg: "rgba(216, 180, 254, 0.48)",
    borderHex: "#7c3aed",
    noteCardBg: "rgba(216, 180, 254, 0.22)",
    decorationColor: "#7c3aed",
  },
};

export const POPUP_SWATCH_COLORS: HighlightColor[] = ["pink", "yellow", "green", "blue"];

export const HIGHLIGHT_STYLES: HighlightStyle[] = ["solid", "underline", "strikethrough", "wavy"];

export function getHighlightToken(color: string): HighlightThemeToken {
  if (color in HIGHLIGHT_THEME) {
    return HIGHLIGHT_THEME[color as HighlightColor];
  }
  return HIGHLIGHT_THEME.yellow;
}

export function applyHighlightStyleToMark(
  mark: HTMLElement,
  color: HighlightColor | string,
  style: HighlightStyle | string = "solid",
): void {
  const token = getHighlightToken(color);
  mark.style.backgroundColor = "transparent";
  mark.style.textDecoration = "none";
  mark.style.borderBottom = "none";
  mark.style.borderRadius = "3px";
  mark.style.padding = "0 1px";

  switch (style) {
    case "underline":
      mark.style.borderBottom = `2px solid ${token.decorationColor}`;
      mark.style.backgroundColor = token.noteCardBg;
      break;
    case "strikethrough":
      mark.style.textDecorationLine = "line-through";
      mark.style.textDecorationColor = token.decorationColor;
      mark.style.textDecorationThickness = "2px";
      break;
    case "wavy":
      mark.style.textDecorationLine = "underline";
      mark.style.textDecorationStyle = "wavy";
      mark.style.textDecorationColor = token.decorationColor;
      mark.style.textDecorationThickness = "1.75px";
      break;
    case "solid":
    default:
      mark.style.backgroundColor = token.iframeBg;
      break;
  }
}

export function getNoteQuoteStyle(
  color: HighlightColor | string,
  style: HighlightStyle | string = "solid",
): CSSProperties {
  const token = getHighlightToken(color);
  const base: CSSProperties = {
    borderLeft: `4px solid ${token.borderHex}`,
    backgroundColor: token.noteCardBg,
    padding: "8px 10px",
    borderRadius: "6px",
    margin: "6px 0",
  };

  if (style === "strikethrough") {
    base.textDecoration = `line-through 2px ${token.decorationColor}`;
  } else if (style === "underline") {
    base.textDecoration = `underline 2px ${token.decorationColor}`;
  } else if (style === "wavy") {
    base.textDecoration = `underline wavy 1.75px ${token.decorationColor}`;
  }
  return base;
}
