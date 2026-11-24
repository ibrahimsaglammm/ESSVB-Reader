import { RefreshCw, Settings, X } from "lucide-react";
import { translate } from "../../i18n";
import { useAppStore } from "../../store/useAppStore";

export function UpdatePromptBanner() {
  const settings = useAppStore((s) => s.settings);
  const versionInfo = useAppStore((s) => s.versionInfo);
  const dismissed = useAppStore((s) => s.updateBannerDismissed);
  const checking = useAppStore((s) => s.updateChecking);
  const result = useAppStore((s) => s.updateCheckResult);
  const error = useAppStore((s) => s.updateError);
  const dismissUpdateBanner = useAppStore((s) => s.dismissUpdateBanner);
  const triggerUpdateCheck = useAppStore((s) => s.triggerUpdateCheck);
  const openSettings = useAppStore((s) => s.openSettings);

  const lang = settings.language;
  const version = versionInfo?.version ?? "0.1.0";

  if (!settings.askUpdateOnStartup || dismissed) {
    return null;
  }

  return (
    <section
      className="update-banner"
      aria-label={translate(lang, "updateBannerTitle", { version })}
      data-testid="update-prompt-banner"
    >
      <div>
        <strong>{translate(lang, "updateBannerTitle", { version })}</strong>
        <div style={{ fontSize: "13px", color: "var(--muted)" }}>
          {result
            ? result.updateAvailable
              ? translate(lang, "updateAvailable", {
                  latest: result.latestVersion,
                  current: result.currentVersion,
                })
              : translate(lang, "updateUpToDate", { version: result.currentVersion })
            : error
              ? `${translate(lang, "updateErrorPrefix")} ${error}`
              : translate(lang, "updateBannerDesc")}
        </div>
      </div>

      <div className="update-banner-actions">
        <button
          type="button"
          className="primary"
          disabled={checking}
          onClick={() => void triggerUpdateCheck(true)}
          data-testid="update-check-now-btn"
        >
          <RefreshCw size={14} aria-hidden="true" />
          {checking ? translate(lang, "updateChecking") : translate(lang, "updateCheckNow")}
        </button>
        <button
          type="button"
          onClick={() => openSettings("privacy")}
          aria-label={translate(lang, "navSettings")}
        >
          <Settings size={14} aria-hidden="true" />
          {translate(lang, "navSettings")}
        </button>
        <button type="button" onClick={dismissUpdateBanner} data-testid="update-ask-later-btn">
          <X size={14} aria-hidden="true" />
          {translate(lang, "updateAskLater")}
        </button>
      </div>
    </section>
  );
}
