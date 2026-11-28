import { useEffect } from "react";
import { BookOpen, Info, Library, NotebookPen, Settings } from "lucide-react";
import { translate } from "./i18n";
import { useAppStore } from "./store/useAppStore";
import { UpdatePromptBanner } from "./components/common/UpdatePromptBanner";
import { UpdateAvailableModal } from "./components/common/UpdateAvailableModal";
import { LibraryView } from "./components/library/LibraryView";
import { ReaderView } from "./components/reader/ReaderView";
import { GlobalNotesView } from "./components/notes/GlobalNotesView";
import { SettingsModal } from "./components/settings/SettingsModal";

export function App() {
  const settings = useAppStore((s) => s.settings);
  const versionInfo = useAppStore((s) => s.versionInfo);
  const activeView = useAppStore((s) => s.activeView);
  const activeBook = useAppStore((s) => s.activeBook);
  const currentChapter = useAppStore((s) => s.currentChapter);
  const shortcutsOpen = useAppStore((s) => s.shortcutsOpen);
  const toast = useAppStore((s) => s.toast);

  const initialize = useAppStore((s) => s.initialize);
  const initialized = useAppStore((s) => s.initialized);
  const triggerUpdateCheck = useAppStore((s) => s.triggerUpdateCheck);
  const setSystemPrefersDark = useAppStore((s) => s.setSystemPrefersDark);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const openSettings = useAppStore((s) => s.openSettings);
  const closeSettings = useAppStore((s) => s.closeSettings);
  const setShortcutsOpen = useAppStore((s) => s.setShortcutsOpen);
  const importWithFileDialog = useAppStore((s) => s.importWithFileDialog);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const ttsState = useAppStore((s) => s.ttsState);
  const pauseTts = useAppStore((s) => s.pauseTts);
  const resumeTts = useAppStore((s) => s.resumeTts);
  const clearToast = useAppStore((s) => s.clearToast);

  const lang = settings.language;
  const version = versionInfo?.version ?? "0.2.1";

  useEffect(() => {
    void initialize();
  }, [initialize]);

  // Continuous periodic GitHub Releases update check when enabled
  useEffect(() => {
    if (!initialized || !settings.autoUpdateEnabled) return;
    const minutes = Math.max(5, Math.min(1440, settings.updateCheckIntervalMinutes || 60));
    const timerId = window.setInterval(() => {
      void triggerUpdateCheck(false);
    }, minutes * 60_000);
    return () => window.clearInterval(timerId);
  }, [
    initialized,
    settings.autoUpdateEnabled,
    settings.updateCheckIntervalMinutes,
    triggerUpdateCheck,
  ]);

  // Listen to OS system theme preference changes
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const listener = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches);
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, [setSystemPrefersDark]);

  // Global keyboard shortcuts with input safety guard
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inInput =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      if (e.key === "Escape") {
        closeSettings();
        setShortcutsOpen(false);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        void importWithFileDialog();
        return;
      }

      if (inInput) return;

      if (e.key === "?") {
        setShortcutsOpen(true);
        return;
      }

      if (activeView === "reader" && currentChapter) {
        if ((e.ctrlKey || e.metaKey) && (e.key === "+" || e.key === "=")) {
          e.preventDefault();
          void updateSettings({ fontSizePx: Math.min(36, settings.fontSizePx + 1) });
        } else if ((e.ctrlKey || e.metaKey) && e.key === "-") {
          e.preventDefault();
          void updateSettings({ fontSizePx: Math.max(12, settings.fontSizePx - 1) });
        } else if (e.code === "Space") {
          if (ttsState === "playing") {
            e.preventDefault();
            pauseTts();
          } else if (ttsState === "paused") {
            e.preventDefault();
            void resumeTts();
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activeView,
    closeSettings,
    currentChapter,
    importWithFileDialog,
    pauseTts,
    resumeTts,
    setShortcutsOpen,
    settings.fontSizePx,
    ttsState,
    updateSettings,
  ]);

  return (
    <div className="app-shell">
      <header className="top-nav">
        <div className="brand-group">
          <span className="brand-title">{translate(lang, "appName")}</span>
          <span className="version-pill" data-testid="header-version-pill">
            {translate(lang, "versionBadge", { version })}
          </span>
        </div>

        <nav className="nav-tabs" aria-label="Ana Gezinme">
          <button
            type="button"
            className={`nav-tab ${activeView === "library" ? "active" : ""}`}
            onClick={() => setActiveView("library")}
            data-testid="nav-library-btn"
          >
            <Library size={15} />
            {translate(lang, "navLibrary")}
          </button>

          {activeBook && (
            <button
              type="button"
              className={`nav-tab ${activeView === "reader" ? "active" : ""}`}
              onClick={() => setActiveView("reader")}
              data-testid="nav-reader-btn"
            >
              <BookOpen size={15} />
              {translate(lang, "navReader")}
            </button>
          )}

          <button
            type="button"
            className={`nav-tab ${activeView === "notes" ? "active" : ""}`}
            onClick={() => setActiveView("notes")}
            data-testid="nav-notes-btn"
          >
            <NotebookPen size={15} />
            {translate(lang, "navNotes")}
          </button>

          <button
            type="button"
            onClick={() => openSettings("general")}
            data-testid="nav-settings-btn"
          >
            <Settings size={15} />
            {translate(lang, "navSettings")}
          </button>

          <button type="button" onClick={() => openSettings("about")} data-testid="nav-about-btn">
            <Info size={15} />
            {translate(lang, "navAbout")}
          </button>
        </nav>
      </header>

      <UpdatePromptBanner />

      <main className="main-body">
        {activeView === "library" && <LibraryView />}
        {activeView === "reader" && <ReaderView />}
        {activeView === "notes" && <GlobalNotesView />}
      </main>

      <SettingsModal />
      <UpdateAvailableModal />

      {shortcutsOpen && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="shortcuts-title"
        >
          <div className="modal-card" style={{ maxWidth: "480px" }}>
            <div className="modal-header">
              <h3 id="shortcuts-title" style={{ margin: 0 }}>
                {translate(lang, "shortcutsTitle")}
              </h3>
            </div>
            <div className="modal-body">{translate(lang, "shortcutsHelp")}</div>
            <div className="modal-footer">
              <button type="button" className="primary" onClick={() => setShortcutsOpen(false)}>
                {translate(lang, "close")}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          className={`toast-banner ${toast.kind === "error" ? "error" : ""}`}
          role="status"
          aria-live="polite"
          onClick={clearToast}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
export default App;
