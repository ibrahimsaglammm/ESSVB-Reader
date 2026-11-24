import { useState, type CSSProperties } from "react";
import {
  BookA,
  Compass,
  Copy,
  FileSearch,
  Headphones,
  Highlighter,
  Languages,
  PencilLine,
  Settings,
  Sparkles,
  Volume2,
  X,
} from "lucide-react";
import { translate } from "../../i18n";
import type {
  AppLanguage,
  AppSettings,
  HighlightColor,
  HighlightStyle,
  TextAssistMode,
  TextAssistRequest,
  TextAssistResponse,
} from "../../types/models";
import { HIGHLIGHT_STYLES, HIGHLIGHT_THEME, POPUP_SWATCH_COLORS } from "../../utils/highlights";

export interface SelectionPopupRect {
  left: number;
  top: number;
  bottom: number;
  containerWidth: number;
  containerHeight: number;
}

interface SelectionPopupMenuProps {
  lang: AppLanguage;
  settings: AppSettings;
  selectedText: string;
  rect: SelectionPopupRect;
  selectedColor: HighlightColor;
  selectedStyle: HighlightStyle;
  onSelectColor: (color: HighlightColor) => void;
  onSelectStyle: (style: HighlightStyle) => void;
  onHighlight: (color: HighlightColor, style: HighlightStyle) => Promise<void>;
  onSaveNote: (noteText: string, color: HighlightColor, style: HighlightStyle) => Promise<void>;
  onCopy: (text: string) => Promise<void>;
  onSearchInBook: (query: string) => Promise<void>;
  onSearchWeb: (query: string) => Promise<void>;
  onOpenExternalUrl: (url: string) => Promise<void>;
  onSpeakSelected: (text: string) => Promise<void>;
  onReadFromHere: () => Promise<void>;
  onAssistText: (request: TextAssistRequest) => Promise<TextAssistResponse>;
  onOpenSettings: () => void;
  onClose: () => void;
}

type ActiveSubPanel = "none" | "note" | "translate" | "dictionary" | "ask";

interface ActionItem {
  id: string;
  labelKey:
    | "popupNote"
    | "popupHighlight"
    | "popupTranslate"
    | "popupCopy"
    | "popupSearchBook"
    | "popupDictionary"
    | "popupSearchWeb"
    | "popupReadAloud"
    | "popupReadFromHere"
    | "popupAskAi"
    | "popupSettings";
  colorHex: string;
  icon: typeof PencilLine;
  onClick: () => void;
  active?: boolean;
}

export function SelectionPopupMenu({
  lang,
  settings,
  selectedText,
  rect,
  selectedColor,
  selectedStyle,
  onSelectColor,
  onSelectStyle,
  onHighlight,
  onSaveNote,
  onCopy,
  onSearchInBook,
  onSearchWeb,
  onOpenExternalUrl,
  onSpeakSelected,
  onReadFromHere,
  onAssistText,
  onOpenSettings,
  onClose,
}: SelectionPopupMenuProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [subPanel, setSubPanel] = useState<ActiveSubPanel>("none");
  const [noteDraft, setNoteDraft] = useState("");
  const [targetLang, setTargetLang] = useState(lang === "tr" ? "tr" : "en");
  const [askQuestion, setAskQuestion] = useState("");
  const [assistLoading, setAssistLoading] = useState(false);
  const [assistError, setAssistError] = useState<string | null>(null);
  const [assistResult, setAssistResult] = useState<TextAssistResponse | null>(null);
  const [pendingCloudMode, setPendingCloudMode] = useState<{
    mode: TextAssistMode;
    prompt?: string;
  } | null>(null);

  const usesGeminiDefault = !settings.ollamaModel.trim() && settings.geminiTtsEnabled;

  const runAssist = async (
    mode: TextAssistMode,
    prompt?: string,
    cloudConfirmed = false,
  ): Promise<void> => {
    setAssistError(null);
    if (usesGeminiDefault && !cloudConfirmed) {
      setPendingCloudMode({ mode, prompt });
      return;
    }
    setPendingCloudMode(null);
    setAssistLoading(true);
    try {
      const resp = await onAssistText({
        mode,
        text: selectedText,
        targetLang: mode === "translate" ? targetLang : undefined,
        userPrompt: prompt,
        cloudConfirmed,
      });
      setAssistResult(resp);
    } catch (err) {
      setAssistError(err instanceof Error ? err.message : String(err));
    } finally {
      setAssistLoading(false);
    }
  };

  const openAssistSubPanel = (next: "translate" | "dictionary" | "ask") => {
    setSubPanel(next);
    setAssistResult(null);
    setAssistError(null);
    setPendingCloudMode(null);
    if (next === "translate" || next === "dictionary") {
      if (settings.ollamaModel.trim() || settings.geminiTtsEnabled) {
        void runAssist(next);
      }
    }
  };

  const row1: ActionItem[] = [
    {
      id: "note",
      labelKey: "popupNote",
      colorHex: "#22c55e",
      icon: PencilLine,
      active: subPanel === "note",
      onClick: () => setSubPanel((cur) => (cur === "note" ? "none" : "note")),
    },
    {
      id: "highlight",
      labelKey: "popupHighlight",
      colorHex: "#6366f1",
      icon: Highlighter,
      onClick: () => void onHighlight(selectedColor, selectedStyle),
    },
    {
      id: "translate",
      labelKey: "popupTranslate",
      colorHex: "#ef4444",
      icon: Languages,
      active: subPanel === "translate",
      onClick: () => openAssistSubPanel("translate"),
    },
    {
      id: "copy",
      labelKey: "popupCopy",
      colorHex: "#f59e0b",
      icon: Copy,
      onClick: () => void onCopy(selectedText),
    },
    {
      id: "search-book",
      labelKey: "popupSearchBook",
      colorHex: "#8b5cf6",
      icon: FileSearch,
      onClick: () => void onSearchInBook(selectedText),
    },
    {
      id: "dictionary",
      labelKey: "popupDictionary",
      colorHex: "#3b82f6",
      icon: BookA,
      active: subPanel === "dictionary",
      onClick: () => openAssistSubPanel("dictionary"),
    },
  ];

  const row2: ActionItem[] = [
    {
      id: "search-web",
      labelKey: "popupSearchWeb",
      colorHex: "#14b8a6",
      icon: Compass,
      onClick: () => void onSearchWeb(selectedText),
    },
    {
      id: "read-aloud",
      labelKey: "popupReadAloud",
      colorHex: "#a855f7",
      icon: Volume2,
      onClick: () => void onSpeakSelected(selectedText),
    },
    {
      id: "read-from-here",
      labelKey: "popupReadFromHere",
      colorHex: "#f97316",
      icon: Headphones,
      onClick: () => void onReadFromHere(),
    },
    {
      id: "ask-ai",
      labelKey: "popupAskAi",
      colorHex: "#10b981",
      icon: Sparkles,
      active: subPanel === "ask",
      onClick: () => openAssistSubPanel("ask"),
    },
    {
      id: "settings",
      labelKey: "popupSettings",
      colorHex: "#9ca3af",
      icon: Settings,
      onClick: () => onOpenSettings(),
    },
  ];

  const halfMenuWidth = 148;
  const clampedLeft = Math.max(
    halfMenuWidth + 12,
    Math.min(rect.containerWidth - halfMenuWidth - 12, rect.left),
  );
  const placeBelow = rect.bottom + 185 < rect.containerHeight || rect.top < 160;
  const anchorStyle: CSSProperties = placeBelow
    ? {
        left: `${clampedLeft}px`,
        top: `${Math.max(12, rect.bottom + 10)}px`,
        transform: "translateX(-50%)",
      }
    : {
        left: `${clampedLeft}px`,
        top: `${Math.max(12, rect.top - 12)}px`,
        transform: "translate(-50%, -100%)",
      };

  const styleLabels: Record<HighlightStyle, string> = {
    solid: translate(lang, "styleSolid"),
    underline: translate(lang, "styleUnderline"),
    strikethrough: translate(lang, "styleStrikethrough"),
    wavy: translate(lang, "styleWavy"),
  };

  const renderStyleGlyph = (st: HighlightStyle) => {
    const common: CSSProperties = { fontSize: "12px", fontWeight: 600, lineHeight: 1 };
    if (st === "underline") {
      return <span style={{ ...common, borderBottom: "2px solid #ef4444" }}>Aa</span>;
    }
    if (st === "strikethrough") {
      return <span style={{ ...common, textDecoration: "line-through 2px #ef4444" }}>Aa</span>;
    }
    if (st === "wavy") {
      return (
        <span
          style={{
            ...common,
            textDecorationLine: "underline",
            textDecorationStyle: "wavy",
            textDecorationColor: "#ef4444",
          }}
        >
          Aa
        </span>
      );
    }
    return <span style={common}>Aa</span>;
  };

  const renderButton = (item: ActionItem) => {
    const Icon = item.icon;
    const label = translate(lang, item.labelKey);
    return (
      <div
        key={item.id}
        className="selection-popup-btn-wrap"
        onMouseEnter={() => setHoveredId(item.id)}
        onMouseLeave={() => setHoveredId((cur) => (cur === item.id ? null : cur))}
      >
        {hoveredId === item.id && (
          <div className="selection-popup-tooltip" role="tooltip">
            {label}
          </div>
        )}
        <button
          type="button"
          className={`selection-popup-btn ${item.active ? "active" : ""}`}
          aria-label={label}
          title={label}
          data-testid={`popup-btn-${item.id}`}
          onClick={item.onClick}
        >
          <Icon size={17} color={item.colorHex} strokeWidth={2.1} aria-hidden="true" />
        </button>
      </div>
    );
  };

  return (
    <div
      className="selection-popup-anchor"
      style={anchorStyle}
      role="dialog"
      aria-label={translate(lang, "selectionHighlight")}
      data-testid="selection-popup-menu"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Top Floating 11-Button Action Card */}
      <div className="selection-popup-card">
        <div className="selection-popup-row">{row1.map(renderButton)}</div>
        <div className="selection-popup-row">{row2.map(renderButton)}</div>
      </div>

      {/* Bottom Highlight Style & Color Bar */}
      <div className="selection-style-bar">
        <div className="selection-style-group">
          {HIGHLIGHT_STYLES.map((st) => (
            <button
              key={st}
              type="button"
              className={`style-pill-btn ${selectedStyle === st ? "active" : ""}`}
              aria-label={styleLabels[st]}
              title={styleLabels[st]}
              data-testid={`popup-style-${st}`}
              onClick={() => onSelectStyle(st)}
            >
              {renderStyleGlyph(st)}
            </button>
          ))}
        </div>

        <div className="selection-color-group">
          {POPUP_SWATCH_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className={`swatch-dot ${selectedColor === color ? "active" : ""}`}
              style={{ backgroundColor: HIGHLIGHT_THEME[color].swatchHex }}
              aria-label={`${translate(lang, "selectionHighlight")}: ${color}`}
              title={`${translate(lang, "selectionHighlight")}: ${color}`}
              data-testid={`popup-color-${color}`}
              onClick={() => {
                onSelectColor(color);
                void onHighlight(color, selectedStyle);
              }}
            />
          ))}
        </div>
      </div>

      {/* Contextual Expandable Subpanel (Note / Translate / Dictionary / Ask AI) */}
      {subPanel !== "none" && (
        <div className="selection-subpanel" data-testid={`popup-subpanel-${subPanel}`}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong style={{ fontSize: "12px" }}>
              {subPanel === "note" && translate(lang, "popupNote")}
              {subPanel === "translate" && translate(lang, "popupTranslate")}
              {subPanel === "dictionary" && translate(lang, "popupDictionary")}
              {subPanel === "ask" && translate(lang, "popupAskAi")}
            </strong>
            <button
              type="button"
              aria-label={translate(lang, "close")}
              style={{ padding: "2px 6px" }}
              onClick={() => setSubPanel("none")}
            >
              <X size={13} />
            </button>
          </div>

          {subPanel === "note" && (
            <>
              <div
                style={{
                  fontSize: "12px",
                  padding: "6px 8px",
                  borderRadius: "6px",
                  backgroundColor: HIGHLIGHT_THEME[selectedColor].noteCardBg,
                  borderLeft: `3px solid ${HIGHLIGHT_THEME[selectedColor].borderHex}`,
                }}
              >
                &ldquo;{selectedText.slice(0, 140)}
                {selectedText.length > 140 ? "..." : ""}&rdquo;
              </div>
              <textarea
                rows={3}
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder={translate(lang, "notePlaceholder")}
                data-testid="popup-note-input"
              />
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "6px" }}>
                <button type="button" onClick={onClose}>
                  {translate(lang, "cancel")}
                </button>
                <button
                  type="button"
                  className="primary"
                  data-testid="popup-note-save-btn"
                  onClick={() => void onSaveNote(noteDraft, selectedColor, selectedStyle)}
                >
                  {translate(lang, "saveNote")}
                </button>
              </div>
            </>
          )}

          {subPanel === "translate" && (
            <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
              <label style={{ fontSize: "12px" }}>{translate(lang, "assistTargetLang")}:</label>
              <select
                value={targetLang}
                onChange={(e) => setTargetLang(e.target.value)}
                style={{ flex: 1 }}
              >
                <option value="tr">Türkçe</option>
                <option value="en">English</option>
                <option value="de">Deutsch</option>
                <option value="fr">Français</option>
                <option value="ar">العربية</option>
              </select>
              <button
                type="button"
                className="primary"
                disabled={assistLoading}
                onClick={() => void runAssist("translate")}
              >
                {translate(lang, "assistRun")}
              </button>
            </div>
          )}

          {subPanel === "ask" && (
            <>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  disabled={assistLoading}
                  onClick={() =>
                    void runAssist("ask", "Bu bölümü örneklerle açık ve anlaşılır şekilde açıkla.")
                  }
                >
                  {translate(lang, "assistQuickExplain")}
                </button>
                <button
                  type="button"
                  disabled={assistLoading}
                  onClick={() => void runAssist("ask", "Bu metni 2-3 maddede özetle.")}
                >
                  {translate(lang, "assistQuickSummarize")}
                </button>
                <button
                  type="button"
                  disabled={assistLoading}
                  onClick={() =>
                    void runAssist("ask", "Bu metni daha sade bir dille yeniden anlat.")
                  }
                >
                  {translate(lang, "assistQuickSimplify")}
                </button>
              </div>
              <form
                style={{ display: "flex", gap: "6px" }}
                onSubmit={(e) => {
                  e.preventDefault();
                  void runAssist("ask", askQuestion);
                }}
              >
                <input
                  type="text"
                  value={askQuestion}
                  onChange={(e) => setAskQuestion(e.target.value)}
                  placeholder={translate(lang, "assistAskPlaceholder")}
                  style={{ flex: 1 }}
                />
                <button type="submit" className="primary" disabled={assistLoading}>
                  {translate(lang, "assistRun")}
                </button>
              </form>
            </>
          )}

          {pendingCloudMode && (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "12px" }}>
              <span style={{ color: "#fde68a" }}>
                {translate(lang, "assistCloudConsentPrompt")}
              </span>
              <button
                type="button"
                className="primary"
                onClick={() => void runAssist(pendingCloudMode.mode, pendingCloudMode.prompt, true)}
              >
                {translate(lang, "assistCloudConfirmBtn")}
              </button>
            </div>
          )}

          {assistLoading && (
            <span style={{ fontSize: "12px", color: "#9ca3af" }}>
              {translate(lang, "assistLoading")}
            </span>
          )}

          {assistError && <span style={{ fontSize: "12px", color: "#fca5a5" }}>{assistError}</span>}

          {assistResult && (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <div
                style={{
                  fontSize: "12px",
                  lineHeight: 1.5,
                  background: "#1b1d20",
                  padding: "8px",
                  borderRadius: "6px",
                  maxHeight: "170px",
                  overflowY: "auto",
                  whiteSpace: "pre-wrap",
                }}
              >
                {assistResult.result}
              </div>
              <div style={{ display: "flex", gap: "6px", justifyContent: "space-between" }}>
                <span style={{ fontSize: "11px", color: "#9ca3af" }}>
                  {assistResult.providerUsed} ({assistResult.model})
                </span>
                <button
                  type="button"
                  onClick={() => void onSaveNote(assistResult.result, selectedColor, selectedStyle)}
                >
                  {translate(lang, "assistSaveAsNote")}
                </button>
              </div>
            </div>
          )}

          {subPanel === "dictionary" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <span style={{ fontSize: "11px", color: "#9ca3af" }}>
                {translate(lang, "dictionaryExternalHint")}
              </span>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() =>
                    void onOpenExternalUrl(
                      `https://sozluk.gov.tr/?ara=${encodeURIComponent(selectedText.slice(0, 80))}`,
                    )
                  }
                >
                  {translate(lang, "dictionaryOpenTdk")}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void onOpenExternalUrl(
                      `https://tr.wiktionary.org/wiki/${encodeURIComponent(selectedText.trim().split(/\s+/)[0] ?? "")}`,
                    )
                  }
                >
                  {translate(lang, "dictionaryOpenWiktionary")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
