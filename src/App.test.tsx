import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "./App";
import { createBrowserPreviewBridge, setApiBridgeForTests } from "./services/tauriBridge";

describe("App integration (GitHub update flow & privacy defaults)", () => {
  beforeEach(() => {
    setApiBridgeForTests(createBrowserPreviewBridge());
  });

  it("renders Turkish default UI with v0.2.0, checks GitHub releases on startup, and asks user before downloading", async () => {
    const bridge = createBrowserPreviewBridge();
    const checkSpy = vi.spyOn(bridge, "checkForUpdates").mockResolvedValue({
      currentVersion: "0.2.0",
      latestVersion: "0.3.0",
      updateAvailable: true,
      releaseNotes: "Windows 11 ve CachyOS paketleri hazır.",
      releasePageUrl: "https://github.com/ibrahimsaglammm/ESSVB-Reader/releases/tag/v0.3.0",
      downloadUrl:
        "https://github.com/ibrahimsaglammm/ESSVB-Reader/releases/download/v0.3.0/ESSVB-Reader_0.3.0_x64-setup.exe",
      recommendedAsset: {
        name: "ESSVB-Reader_0.3.0_x64-setup.exe",
        downloadUrl:
          "https://github.com/ibrahimsaglammm/ESSVB-Reader/releases/download/v0.3.0/ESSVB-Reader_0.3.0_x64-setup.exe",
        sizeBytes: 5_200_000,
        sha256: "a".repeat(64),
        platformTag: "windows-nsis",
      },
      assets: [
        {
          name: "ESSVB-Reader_0.3.0_x64-setup.exe",
          downloadUrl:
            "https://github.com/ibrahimsaglammm/ESSVB-Reader/releases/download/v0.3.0/ESSVB-Reader_0.3.0_x64-setup.exe",
          sizeBytes: 5_200_000,
          sha256: "a".repeat(64),
          platformTag: "windows-nsis",
        },
      ],
      checkedAt: new Date().toISOString(),
    });
    const downloadSpy = vi.spyOn(bridge, "downloadAndApplyUpdate");
    setApiBridgeForTests(bridge);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("header-version-pill")).toHaveTextContent("0.2.0");
      expect(screen.getByTestId("update-available-modal")).toBeInTheDocument();
    });

    // Checked GitHub Releases automatically, NEVER downloaded without user consent
    expect(checkSpy).toHaveBeenCalled();
    expect(downloadSpy).not.toHaveBeenCalled();

    // User explicitly confirms download & install
    fireEvent.click(screen.getByTestId("update-modal-confirm-btn"));
    await waitFor(() => {
      expect(downloadSpy).toHaveBeenCalledTimes(1);
    });

    // Snooze modal before testing library/settings
    fireEvent.click(screen.getByTestId("update-modal-later-btn"));

    // User creates a new shelf
    fireEvent.change(screen.getByTestId("new-shelf-input"), { target: { value: "Felsefe" } });
    fireEvent.click(screen.getByTestId("create-shelf-btn"));
    await waitFor(() => {
      expect(screen.getByText("Felsefe")).toBeInTheDocument();
    });

    // Verify Gemini TTS stays OFF by default while autoUpdateEnabled is ON
    fireEvent.click(screen.getByTestId("nav-about-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("about-version-text")).toHaveTextContent("0.2.0");
    });

    fireEvent.click(screen.getByTestId("settings-tab-tts"));
    await waitFor(() => {
      const geminiToggle = screen.getByTestId("gemini-enable-checkbox") as HTMLInputElement;
      expect(geminiToggle.checked).toBe(false);
    });

    fireEvent.click(screen.getByTestId("settings-tab-privacy"));
    await waitFor(() => {
      const autoUpdateToggle = screen.getByTestId("auto-update-checkbox") as HTMLInputElement;
      expect(autoUpdateToggle.checked).toBe(true);
    });
  });
});
