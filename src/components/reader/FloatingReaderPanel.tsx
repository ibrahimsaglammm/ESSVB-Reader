import {
  BookMarked,
  Bookmark,
  BookOpen,
  Columns2,
  List,
  Minus,
  Plus,
  ScrollText,
  Volume2,
  X,
} from "lucide-react";
import { translate } from "../../i18n";
import type { AppLanguage, AppSettings, ReaderLayoutMode, ThemePreset } from "../../types/models";

interface FloatingReaderPanelProps {
  open: boolean;
  onClose: () => void;
  lang: AppLanguage;
  settings: AppSettings;
  onUpdateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  isPdf?: boolean;
  pdfZoom?: number;
  onChangePdfZoom?: (zoom: number) => void;
  isBookmarked: boolean;
  onToggleBookmark: () => void;
  onOpenSidePanel: (panel: "toc" | "notes" | "bookmarks") => void;
  ttsPlaying: boolean;
  onToggleTts: () => void;
}

export function FloatingReaderPanel({
  open,
  onClose,
  lang,
  settings,
  onUpdateSettings,
  isPdf = false,
  pdfZoom = 1,
  onChangePdfZoom,
  isBookmarked,
  onToggleBookmark,
  onOpenSidePanel,
  ttsPlaying,
  onToggleTts,
}: FloatingReaderPanelProps) {
  if (!open) return null;

  const setLayout = (mode: ReaderLayoutMode) => {
    void onUpdateSettings({ readerLayoutMode: mode });
  };

  const setTheme = (preset: ThemePreset) => {
    void onUpdateSettings({ followSystemTheme: false, themePreset: preset });
  };

  const themes: { id: ThemePreset; label: string }[] = [
    { id: "light", label: translate(lang, "themeLight") },
    { id: "sepia", label: translate(lang, "themeSepia") },
    { id: "dark", label: translate(lang, "themeDark") },
    { id: "high-contrast", label: translate(lang, "themeHighContrast") },
  ];

  return (
    <div
      className="floating-reader-panel"
      role="dialog"
      aria-label={translate(lang, "readerTypography")}
      data-testid="floating-reader-panel"
    >
      <div className="floating-panel-header">
        <strong>Okuma Düzeni ve Ayarlar</strong>
        <button
          type="button"
          className="icon-btn"
          onClick={onClose}
          aria-label={translate(lang, "close")}
        >
          <X size={15} />
        </button>
      </div>

      <div className="floating-panel-section">
        <span className="floating-label">Sayfa Düzeni</span>
        <div className="floating-btn-row">
          <button
            type="button"
            className={settings.readerLayoutMode === "paginated-1" ? "primary" : ""}
            onClick={() => setLayout("paginated-1")}
            data-testid="floating-layout-paginated-1"
          >
            <BookOpen size={14} />
            Sabit Sayfa (Sağ/Sol)
          </button>
          <button
            type="button"
            className={settings.readerLayoutMode === "scroll" ? "primary" : ""}
            onClick={() => setLayout("scroll")}
            data-testid="floating-layout-scroll"
          >
            <ScrollText size={14} />
            Dikey Akış (Yukarı/Aşağı)
          </button>
          <button
            type="button"
            className={`hide-on-phone ${settings.readerLayoutMode === "paginated-2" ? "primary" : ""}`}
            onClick={() => setLayout("paginated-2")}
            data-testid="floating-layout-paginated-2"
          >
            <Columns2 size={14} />
            {translate(lang, "layoutPaginated2")}
          </button>
        </div>
      </div>

      <div className="floating-panel-section">
        <span className="floating-label">{translate(lang, "tabThemes")}</span>
        <div className="floating-btn-row">
          {themes.map((t) => (
            <button
              key={t.id}
              type="button"
              className={
                !settings.followSystemTheme && settings.themePreset === t.id ? "primary" : ""
              }
              onClick={() => setTheme(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="floating-panel-section">
        {isPdf ? (
          <>
            <span className="floating-label">Yakınlaştırma ({Math.round(pdfZoom * 100)}%)</span>
            <div className="floating-btn-row">
              <button
                type="button"
                onClick={() =>
                  onChangePdfZoom?.(Math.max(0.5, Number((pdfZoom - 0.15).toFixed(2))))
                }
                aria-label="Uzaklaştır"
              >
                <Minus size={14} />
              </button>
              <button type="button" onClick={() => onChangePdfZoom?.(1)}>
                Sığdır (100%)
              </button>
              <button
                type="button"
                onClick={() =>
                  onChangePdfZoom?.(Math.min(3.0, Number((pdfZoom + 0.15).toFixed(2))))
                }
                aria-label="Yakınlaştır"
              >
                <Plus size={14} />
              </button>
            </div>
          </>
        ) : (
          <>
            <span className="floating-label">
              {translate(lang, "fontSizeLabel")}: {settings.fontSizePx}px
            </span>
            <div className="floating-btn-row">
              <button
                type="button"
                onClick={() =>
                  void onUpdateSettings({ fontSizePx: Math.max(12, settings.fontSizePx - 1) })
                }
                aria-label="Yazıyı Küçült"
              >
                <Minus size={14} />
              </button>
              <input
                type="range"
                min={12}
                max={36}
                value={settings.fontSizePx}
                onChange={(e) => void onUpdateSettings({ fontSizePx: Number(e.target.value) })}
                style={{ flex: 1, minWidth: "100px" }}
              />
              <button
                type="button"
                onClick={() =>
                  void onUpdateSettings({ fontSizePx: Math.min(36, settings.fontSizePx + 1) })
                }
                aria-label="Yazıyı Büyüt"
              >
                <Plus size={14} />
              </button>
            </div>
          </>
        )}
      </div>

      <div className="floating-panel-section">
        <span className="floating-label">Araçlar</span>
        <div className="floating-btn-row">
          <button type="button" onClick={() => onOpenSidePanel("toc")}>
            <List size={14} />
            {translate(lang, "readerToc")}
          </button>
          <button
            type="button"
            className={isBookmarked ? "primary" : ""}
            onClick={onToggleBookmark}
          >
            <Bookmark size={14} />
            {translate(lang, "bookmarkAdd")}
          </button>
          {!isPdf && (
            <button type="button" onClick={() => onOpenSidePanel("notes")}>
              <BookMarked size={14} />
              {translate(lang, "readerNotes")}
            </button>
          )}
          <button type="button" onClick={onToggleTts}>
            <Volume2 size={14} />
            {ttsPlaying ? translate(lang, "ttsStop") : translate(lang, "ttsPlay")}
          </button>
        </div>
      </div>
    </div>
  );
}
