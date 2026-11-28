import { useState } from "react";
import { Download, KeyRound, RefreshCw, ShieldCheck, Trash2, Upload, X } from "lucide-react";
import { translate } from "../../i18n";
import { useAppStore, type SettingsTab } from "../../store/useAppStore";
import type { AppLanguage, AppSettings, ThemePreset, TtsProviderId } from "../../types/models";

export function SettingsModal() {
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const settingsTab = useAppStore((s) => s.settingsTab);
  const settings = useAppStore((s) => s.settings);
  const versionInfo = useAppStore((s) => s.versionInfo);
  const geminiKeySaved = useAppStore((s) => s.geminiKeySaved);
  const ttsStatuses = useAppStore((s) => s.ttsStatuses);
  const ttsCacheStats = useAppStore((s) => s.ttsCacheStats);
  const ollamaModels = useAppStore((s) => s.ollamaModels);
  const updateChecking = useAppStore((s) => s.updateChecking);
  const updateCheckResult = useAppStore((s) => s.updateCheckResult);
  const updateError = useAppStore((s) => s.updateError);

  const openSettings = useAppStore((s) => s.openSettings);
  const closeSettings = useAppStore((s) => s.closeSettings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const refreshTtsStatuses = useAppStore((s) => s.refreshTtsStatuses);
  const fetchOllamaModels = useAppStore((s) => s.fetchOllamaModels);
  const saveGeminiKey = useAppStore((s) => s.saveGeminiKey);
  const deleteGeminiKey = useAppStore((s) => s.deleteGeminiKey);
  const clearTtsCache = useAppStore((s) => s.clearTtsCache);
  const exportBackup = useAppStore((s) => s.exportBackup);
  const importBackup = useAppStore((s) => s.importBackup);
  const triggerUpdateCheck = useAppStore((s) => s.triggerUpdateCheck);

  const [geminiInput, setGeminiInput] = useState("");
  const lang = settings.language;

  if (!settingsOpen) return null;

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: "general", label: translate(lang, "tabGeneral") },
    { id: "themes", label: translate(lang, "tabThemes") },
    { id: "tts", label: translate(lang, "tabTts") },
    { id: "privacy", label: translate(lang, "tabPrivacy") },
    { id: "backup", label: translate(lang, "tabBackup") },
    { id: "about", label: translate(lang, "tabAbout") },
  ];

  const version = versionInfo?.version ?? "0.2.2";
  const stage =
    lang === "tr"
      ? (versionInfo?.stageTr ?? "Hazırlık Aşaması (Ön Sürüm)")
      : (versionInfo?.stageEn ?? "Development Preview (Pre-release)");

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
      data-testid="settings-modal"
    >
      <div className="modal-card">
        <div className="modal-header">
          <h2 id="settings-modal-title" style={{ margin: 0, fontSize: "16px" }}>
            {translate(lang, "settingsTitle")}
          </h2>
          <button
            type="button"
            className="icon-btn"
            onClick={closeSettings}
            aria-label={translate(lang, "close")}
          >
            <X size={16} />
          </button>
        </div>

        <div
          style={{
            display: "flex",
            gap: "6px",
            padding: "8px 16px",
            borderBottom: "1px solid var(--border)",
            flexWrap: "wrap",
          }}
          role="tablist"
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={settingsTab === tab.id}
              className={`nav-tab ${settingsTab === tab.id ? "active" : ""}`}
              onClick={() => openSettings(tab.id)}
              data-testid={`settings-tab-${tab.id}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="modal-body">
          {settingsTab === "general" && (
            <>
              <div className="field-group">
                <label htmlFor="set-lang">{translate(lang, "languageLabel")}</label>
                <select
                  id="set-lang"
                  value={settings.language}
                  onChange={(e) => void updateSettings({ language: e.target.value as AppLanguage })}
                >
                  <option value="tr">Türkçe (Varsayılan)</option>
                  <option value="en">English</option>
                </select>
              </div>
              <div className="field-group">
                <label htmlFor="set-layout">{translate(lang, "defaultLayoutLabel")}</label>
                <select
                  id="set-layout"
                  value={settings.readerLayoutMode}
                  onChange={(e) =>
                    void updateSettings({
                      readerLayoutMode: e.target.value as AppSettings["readerLayoutMode"],
                    })
                  }
                >
                  <option value="paginated-1">{translate(lang, "layoutPaginated1")}</option>
                  <option value="paginated-2">{translate(lang, "layoutPaginated2")}</option>
                  <option value="scroll">{translate(lang, "layoutScroll")}</option>
                </select>
              </div>
              <label style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                <input
                  type="checkbox"
                  checked={settings.reopenLastBookOnStartup}
                  onChange={(e) =>
                    void updateSettings({ reopenLastBookOnStartup: e.target.checked })
                  }
                />
                {translate(lang, "reopenLastBookLabel")}
              </label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                <input
                  type="checkbox"
                  checked={settings.ttsFollowPage}
                  onChange={(e) => void updateSettings({ ttsFollowPage: e.target.checked })}
                />
                {translate(lang, "ttsFollowLabel")}
              </label>
              <div className="alert-box">
                <strong>{translate(lang, "shortcutsTitle")}</strong>
                <p style={{ margin: "6px 0 0", fontSize: "13px" }}>
                  {translate(lang, "shortcutsHelp")}
                </p>
              </div>
            </>
          )}

          {settingsTab === "themes" && (
            <>
              <div className="field-group">
                <label htmlFor="set-theme">{translate(lang, "themePresetLabel")}</label>
                <select
                  id="set-theme"
                  value={settings.themePreset}
                  onChange={(e) =>
                    void updateSettings({ themePreset: e.target.value as ThemePreset })
                  }
                  data-testid="theme-preset-select"
                >
                  <option value="light">{translate(lang, "themeLight")}</option>
                  <option value="dark">{translate(lang, "themeDark")}</option>
                  <option value="sepia">{translate(lang, "themeSepia")}</option>
                  <option value="high-contrast">{translate(lang, "themeHighContrast")}</option>
                  <option value="custom">{translate(lang, "themeCustom")}</option>
                </select>
              </div>

              <label style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                <input
                  type="checkbox"
                  checked={settings.followSystemTheme}
                  onChange={(e) => void updateSettings({ followSystemTheme: e.target.checked })}
                />
                {translate(lang, "followSystemTheme")}
              </label>

              {settings.themePreset === "custom" && (
                <div className="form-grid">
                  <div className="field-group">
                    <label htmlFor="c-bg">{translate(lang, "customBg")}</label>
                    <input
                      id="c-bg"
                      type="color"
                      value={settings.customTheme.background}
                      onChange={(e) =>
                        void updateSettings({
                          customTheme: { ...settings.customTheme, background: e.target.value },
                        })
                      }
                    />
                  </div>
                  <div className="field-group">
                    <label htmlFor="c-surf">{translate(lang, "customSurface")}</label>
                    <input
                      id="c-surf"
                      type="color"
                      value={settings.customTheme.surface}
                      onChange={(e) =>
                        void updateSettings({
                          customTheme: { ...settings.customTheme, surface: e.target.value },
                        })
                      }
                    />
                  </div>
                  <div className="field-group">
                    <label htmlFor="c-text">{translate(lang, "customText")}</label>
                    <input
                      id="c-text"
                      type="color"
                      value={settings.customTheme.text}
                      onChange={(e) =>
                        void updateSettings({
                          customTheme: { ...settings.customTheme, text: e.target.value },
                        })
                      }
                    />
                  </div>
                  <div className="field-group">
                    <label htmlFor="c-acc">{translate(lang, "customAccent")}</label>
                    <input
                      id="c-acc"
                      type="color"
                      value={settings.customTheme.accent}
                      onChange={(e) =>
                        void updateSettings({
                          customTheme: { ...settings.customTheme, accent: e.target.value },
                        })
                      }
                    />
                  </div>
                </div>
              )}
            </>
          )}

          {settingsTab === "tts" && (
            <>
              <div className="field-group">
                <label htmlFor="set-tts-provider">{translate(lang, "ttsProviderLabel")}</label>
                <select
                  id="set-tts-provider"
                  value={settings.ttsProvider}
                  onChange={(e) =>
                    void updateSettings({ ttsProvider: e.target.value as TtsProviderId })
                  }
                  data-testid="tts-provider-select"
                >
                  <option value="local">{translate(lang, "ttsLocalLabel")}</option>
                  <option value="ollama">{translate(lang, "ttsOllamaLabel")}</option>
                  <option value="gemini">{translate(lang, "ttsGeminiLabel")}</option>
                </select>
              </div>

              <div
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
              >
                <strong>Sağlayıcı Durumları</strong>
                <button type="button" onClick={() => void refreshTtsStatuses()}>
                  <RefreshCw size={14} />
                  {translate(lang, "ttsRefreshStatus")}
                </button>
              </div>

              {ttsStatuses.map((st) => (
                <div key={st.providerId} className="alert-box">
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <strong>{st.providerId.toUpperCase()}</strong>
                    <span className="chip">
                      {st.available
                        ? `${translate(lang, "ttsAvailable")}: ${st.voiceName}`
                        : translate(lang, "ttsUnavailable")}
                    </span>
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "4px" }}>
                    {st.details}
                  </div>
                  {(lang === "tr" ? st.setupHintTr : st.setupHintEn) && (
                    <div style={{ fontSize: "12px", marginTop: "4px" }}>
                      {lang === "tr" ? st.setupHintTr : st.setupHintEn}
                    </div>
                  )}
                </div>
              ))}

              <div className="field-group">
                <label htmlFor="set-piper-path">{translate(lang, "ttsPiperPathLabel")}</label>
                <input
                  id="set-piper-path"
                  type="text"
                  value={settings.linuxPiperModelPath}
                  onChange={(e) => void updateSettings({ linuxPiperModelPath: e.target.value })}
                  placeholder="/usr/share/piper-voices/tr_TR-dfki-medium.onnx"
                />
              </div>

              <div className="alert-box">
                <div className="form-grid">
                  <div className="field-group">
                    <label htmlFor="set-ollama-url">{translate(lang, "ttsOllamaUrlLabel")}</label>
                    <input
                      id="set-ollama-url"
                      type="url"
                      value={settings.ollamaUrl}
                      onChange={(e) => void updateSettings({ ollamaUrl: e.target.value })}
                    />
                  </div>
                  <div className="field-group">
                    <label htmlFor="set-ollama-model">
                      {translate(lang, "ttsOllamaModelLabel")}
                    </label>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <input
                        id="set-ollama-model"
                        type="text"
                        value={settings.ollamaModel}
                        onChange={(e) => void updateSettings({ ollamaModel: e.target.value })}
                        list="ollama-models-datalist"
                        style={{ flex: 1 }}
                      />
                      <datalist id="ollama-models-datalist">
                        {ollamaModels.map((m) => (
                          <option key={m} value={m} />
                        ))}
                      </datalist>
                      <button type="button" onClick={() => void fetchOllamaModels()}>
                        {translate(lang, "ttsOllamaFetchModels")}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="alert-box alert-warn">
                <label
                  style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 600 }}
                >
                  <input
                    type="checkbox"
                    checked={settings.geminiTtsEnabled}
                    onChange={(e) => void updateSettings({ geminiTtsEnabled: e.target.checked })}
                    data-testid="gemini-enable-checkbox"
                  />
                  {translate(lang, "ttsGeminiEnableLabel")}
                </label>
                <p style={{ fontSize: "12px", margin: "6px 0" }}>
                  {translate(lang, "ttsGeminiWarning")}
                </p>
                <div className="field-group" style={{ marginTop: "8px" }}>
                  <label htmlFor="set-gemini-key">
                    {translate(lang, "ttsGeminiKeyLabel")} —{" "}
                    <span>
                      {geminiKeySaved
                        ? translate(lang, "ttsGeminiKeySaved")
                        : translate(lang, "ttsGeminiKeyMissing")}
                    </span>
                  </label>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <input
                      id="set-gemini-key"
                      type="password"
                      value={geminiInput}
                      onChange={(e) => setGeminiInput(e.target.value)}
                      placeholder="AIza..."
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      className="primary"
                      disabled={!geminiInput.trim()}
                      onClick={() => {
                        void saveGeminiKey(geminiInput);
                        setGeminiInput("");
                      }}
                    >
                      <KeyRound size={14} />
                      {translate(lang, "ttsGeminiKeySaveBtn")}
                    </button>
                    {geminiKeySaved && (
                      <button
                        type="button"
                        className="danger"
                        onClick={() => void deleteGeminiKey()}
                      >
                        <Trash2 size={14} />
                        {translate(lang, "ttsGeminiKeyDeleteBtn")}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div
                className="alert-box"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "8px",
                }}
              >
                <div>
                  <strong>{translate(lang, "ttsCacheTitle")}</strong>
                  <div style={{ fontSize: "12px", color: "var(--muted)" }}>
                    {ttsCacheStats
                      ? `${ttsCacheStats.fileCount} dosya • ${(ttsCacheStats.totalBytes / 1024 / 1024).toFixed(2)} MB / ${settings.ttsCacheMaxMb} MB`
                      : "0 MB"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <label style={{ fontSize: "12px" }}>
                    {translate(lang, "ttsCacheMaxLabel")}:{" "}
                    <input
                      type="number"
                      min={5}
                      max={500}
                      value={settings.ttsCacheMaxMb}
                      onChange={(e) =>
                        void updateSettings({ ttsCacheMaxMb: Number(e.target.value) })
                      }
                      style={{ width: "76px" }}
                    />
                  </label>
                  <button type="button" onClick={() => void clearTtsCache()}>
                    {translate(lang, "ttsCacheClearBtn")}
                  </button>
                </div>
              </div>
            </>
          )}

          {settingsTab === "privacy" && (
            <>
              <div className="alert-box">
                <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <input
                    type="checkbox"
                    checked={settings.askUpdateOnStartup}
                    onChange={(e) => void updateSettings({ askUpdateOnStartup: e.target.checked })}
                  />
                  {translate(lang, "privacyAskStartupLabel")}
                </label>
              </div>

              <div className="alert-box alert-warn">
                <label
                  style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 600 }}
                >
                  <input
                    type="checkbox"
                    checked={settings.autoUpdateEnabled}
                    onChange={(e) => void updateSettings({ autoUpdateEnabled: e.target.checked })}
                    data-testid="auto-update-checkbox"
                  />
                  {translate(lang, "privacyAutoUpdateLabel")}
                </label>
                <p style={{ fontSize: "12px", margin: "6px 0 0" }}>
                  {translate(lang, "privacyAutoUpdateWarn")}
                </p>
              </div>

              <div className="form-grid">
                <div className="field-group">
                  <label htmlFor="set-manifest-url">
                    {translate(lang, "privacyManifestUrlLabel")}
                  </label>
                  <input
                    id="set-manifest-url"
                    type="url"
                    value={settings.updateManifestUrl}
                    onChange={(e) => void updateSettings({ updateManifestUrl: e.target.value })}
                  />
                </div>
                <div className="field-group">
                  <label htmlFor="set-update-interval">
                    {translate(lang, "updateCheckIntervalLabel")}
                  </label>
                  <input
                    id="set-update-interval"
                    type="number"
                    min={5}
                    max={1440}
                    value={settings.updateCheckIntervalMinutes}
                    onChange={(e) =>
                      void updateSettings({
                        updateCheckIntervalMinutes: Number(e.target.value) || 60,
                      })
                    }
                  />
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <button
                  type="button"
                  className="primary"
                  disabled={updateChecking}
                  onClick={() => void triggerUpdateCheck(true)}
                >
                  <RefreshCw size={14} />
                  {updateChecking
                    ? translate(lang, "updateChecking")
                    : translate(lang, "updateCheckNow")}
                </button>
                {updateCheckResult && (
                  <span style={{ fontSize: "13px" }}>
                    {updateCheckResult.updateAvailable
                      ? translate(lang, "updateAvailable", {
                          latest: updateCheckResult.latestVersion,
                          current: updateCheckResult.currentVersion,
                        })
                      : translate(lang, "updateUpToDate", {
                          version: updateCheckResult.currentVersion,
                        })}
                  </span>
                )}
                {updateError && (
                  <span style={{ fontSize: "13px", color: "var(--danger)" }}>{updateError}</span>
                )}
              </div>
            </>
          )}

          {settingsTab === "backup" && (
            <>
              <div className="alert-box">{translate(lang, "backupNote")}</div>
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                <button type="button" className="primary" onClick={() => void exportBackup()}>
                  <Download size={15} />
                  {translate(lang, "backupExportBtn")}
                </button>
                <button type="button" onClick={() => void importBackup()}>
                  <Upload size={15} />
                  {translate(lang, "backupImportBtn")}
                </button>
              </div>
            </>
          )}

          {settingsTab === "about" && (
            <div
              style={{ display: "flex", flexDirection: "column", gap: "12px" }}
              data-testid="about-panel"
            >
              <div className="alert-box">
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <ShieldCheck size={18} />
                  <strong style={{ fontSize: "16px" }}>ESSVB-Reader</strong>
                </div>
                <p style={{ margin: "6px 0" }} data-testid="about-version-text">
                  {translate(lang, "aboutVersion", { version, stage })}
                </p>
                <p style={{ margin: "4px 0", fontSize: "13px", color: "var(--muted)" }}>
                  {versionInfo?.isPortable
                    ? translate(lang, "aboutModePortable")
                    : translate(lang, "aboutModeStandard")}
                </p>
                <p style={{ margin: "4px 0", fontSize: "13px", color: "var(--muted)" }}>
                  Lisans / License: {versionInfo?.license ?? "MIT"}
                </p>
                <p style={{ margin: "4px 0", fontSize: "13px", color: "var(--muted)" }}>
                  GitHub: https://github.com/ibrahimsaglammm/ESSVB-Reader
                </p>
              </div>

              <div className="alert-box">{translate(lang, "aboutPrivacyPromise")}</div>

              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <button
                  type="button"
                  className="primary"
                  disabled={updateChecking}
                  onClick={() => void triggerUpdateCheck(true)}
                >
                  <RefreshCw size={14} />
                  {updateChecking
                    ? translate(lang, "updateChecking")
                    : translate(lang, "updateCheckNow")}
                </button>
                <button type="button" onClick={() => openSettings("privacy")}>
                  {translate(lang, "tabPrivacy")}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="primary" onClick={closeSettings}>
            {translate(lang, "close")}
          </button>
        </div>
      </div>
    </div>
  );
}
