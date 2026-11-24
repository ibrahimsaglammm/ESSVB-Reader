import { useState } from "react";
import { Download, ExternalLink, RefreshCw, X } from "lucide-react";
import { translate } from "../../i18n";
import { useAppStore } from "../../store/useAppStore";

export function UpdateAvailableModal() {
  const settings = useAppStore((s) => s.settings);
  const result = useAppStore((s) => s.updateCheckResult);
  const snoozedVersion = useAppStore((s) => s.updateModalSnoozedVersion);
  const downloading = useAppStore((s) => s.updateDownloading);
  const applyResult = useAppStore((s) => s.updateApplyResult);
  const snoozeUpdateModal = useAppStore((s) => s.snoozeUpdateModal);
  const applyUpdate = useAppStore((s) => s.applyUpdate);

  const lang = settings.language;
  const available = Boolean(result?.updateAvailable);
  const visible = available && result?.latestVersion !== snoozedVersion;

  const [selectedAssetName, setSelectedAssetName] = useState("");

  if (!visible || !result) {
    return null;
  }

  const activeAsset =
    result.assets.find((a) => a.name === selectedAssetName) ??
    result.recommendedAsset ??
    result.assets[0] ??
    null;

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-available-title"
      data-testid="update-available-modal"
    >
      <div className="modal-card" style={{ maxWidth: "560px" }}>
        <div className="modal-header">
          <h3 id="update-available-title" style={{ margin: 0, fontSize: "16px" }}>
            <RefreshCw size={16} style={{ marginRight: "6px", verticalAlign: "text-bottom" }} />
            {translate(lang, "updateModalTitle", { latest: result.latestVersion })}
          </h3>
          <button
            type="button"
            className="icon-btn"
            onClick={snoozeUpdateModal}
            aria-label={translate(lang, "close")}
          >
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <p style={{ margin: 0 }}>
            {translate(lang, "updateModalQuestion", {
              current: result.currentVersion,
              latest: result.latestVersion,
            })}
          </p>

          {result.releaseNotes && (
            <div
              className="alert-box"
              style={{
                maxHeight: "150px",
                overflowY: "auto",
                fontSize: "13px",
                whiteSpace: "pre-wrap",
              }}
            >
              {result.releaseNotes}
            </div>
          )}

          {result.assets.length > 0 && (
            <div className="field-group">
              <label htmlFor="update-asset-select">
                {translate(lang, "updateModalPackageLabel")}
              </label>
              <select
                id="update-asset-select"
                value={activeAsset?.name ?? ""}
                onChange={(e) => setSelectedAssetName(e.target.value)}
                data-testid="update-asset-select"
              >
                {result.assets.map((asset) => (
                  <option key={asset.name} value={asset.name}>
                    {asset.name} ({asset.platformTag} • {(asset.sizeBytes / 1024 / 1024).toFixed(2)}{" "}
                    MB)
                  </option>
                ))}
              </select>
              {activeAsset?.sha256 && (
                <div style={{ fontSize: "11px", color: "var(--muted)", wordBreak: "break-all" }}>
                  SHA-256: {activeAsset.sha256}
                </div>
              )}
            </div>
          )}

          {applyResult && (
            <div className="alert-box">
              <strong>{applyResult.fileName}</strong>
              <p style={{ margin: "4px 0 0", fontSize: "13px" }}>
                {lang === "tr" ? applyResult.actionHintTr : applyResult.actionHintEn}
              </p>
            </div>
          )}
        </div>

        <div className="modal-footer" style={{ justifyContent: "space-between" }}>
          <div>
            {result.releasePageUrl && (
              <a
                href={result.releasePageUrl}
                target="_blank"
                rel="noreferrer"
                style={{
                  fontSize: "13px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <ExternalLink size={14} />
                {translate(lang, "updateModalOpenRelease")}
              </a>
            )}
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button type="button" onClick={snoozeUpdateModal} data-testid="update-modal-later-btn">
              {translate(lang, "updateModalLater")}
            </button>
            {activeAsset && (
              <button
                type="button"
                className="primary"
                disabled={downloading}
                onClick={() => void applyUpdate(activeAsset)}
                data-testid="update-modal-confirm-btn"
              >
                <Download size={14} />
                {downloading
                  ? translate(lang, "updateModalDownloading")
                  : translate(lang, "updateModalConfirm")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
