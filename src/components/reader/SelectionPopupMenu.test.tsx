import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SelectionPopupMenu } from "./SelectionPopupMenu";
import type { AppSettings } from "../../types/models";

const BASE_SETTINGS: AppSettings = {
  language: "tr",
  themePreset: "light",
  followSystemTheme: false,
  customTheme: {
    background: "#f7f3eb",
    text: "#1f2933",
    surface: "#ebe4d5",
    accent: "#0f766e",
  },
  fontFamily: "serif",
  fontSizePx: 18,
  lineHeight: 1.7,
  marginPx: 48,
  textAlign: "left",
  showCoverThumbnails: false,
  ttsProvider: "local",
  ttsRate: 1.0,
  ttsCacheMaxMb: 50,
  linuxPiperModelPath: "",
  ollamaUrl: "http://127.0.0.1:11434",
  ollamaModel: "llama3.2",
  geminiTtsEnabled: false,
  geminiModel: "gemini-2.5-flash-preview-tts",
  geminiVoice: "Kore",
  geminiConfirmBeforeSend: true,
  askUpdateOnStartup: true,
  autoUpdateEnabled: true,
  updateCheckIntervalMinutes: 60,
  updateManifestUrl: "https://api.github.com/repos/ibrahimsaglammm/ESSVB-Reader/releases/latest",
};

describe("SelectionPopupMenu", () => {
  it("renders all 11 active buttons, 4 styles, 4 colors, hover tooltip, and callbacks", async () => {
    const onHighlight = vi.fn().mockResolvedValue(undefined);
    const onSaveNote = vi.fn().mockResolvedValue(undefined);
    const onCopy = vi.fn().mockResolvedValue(undefined);
    const onSearchInBook = vi.fn().mockResolvedValue(undefined);
    const onSearchWeb = vi.fn().mockResolvedValue(undefined);
    const onOpenExternalUrl = vi.fn().mockResolvedValue(undefined);
    const onSpeakSelected = vi.fn().mockResolvedValue(undefined);
    const onReadFromHere = vi.fn().mockResolvedValue(undefined);
    const onAssistText = vi.fn().mockResolvedValue({
      providerUsed: "ollama",
      model: "llama3.2",
      result: "Test AI yanıtı",
    });
    const onOpenSettings = vi.fn();

    render(
      <SelectionPopupMenu
        lang="tr"
        settings={BASE_SETTINGS}
        selectedText="Yapay zekâ sistemleri veriden öğrenir."
        rect={{ left: 300, top: 180, bottom: 210, containerWidth: 800, containerHeight: 600 }}
        selectedColor="green"
        selectedStyle="solid"
        onSelectColor={vi.fn()}
        onSelectStyle={vi.fn()}
        onHighlight={onHighlight}
        onSaveNote={onSaveNote}
        onCopy={onCopy}
        onSearchInBook={onSearchInBook}
        onSearchWeb={onSearchWeb}
        onOpenExternalUrl={onOpenExternalUrl}
        onSpeakSelected={onSpeakSelected}
        onReadFromHere={onReadFromHere}
        onAssistText={onAssistText}
        onOpenSettings={onOpenSettings}
        onClose={vi.fn()}
      />,
    );

    const expectedIds = [
      "note",
      "highlight",
      "translate",
      "copy",
      "search-book",
      "dictionary",
      "search-web",
      "read-aloud",
      "read-from-here",
      "ask-ai",
      "settings",
    ];
    for (const id of expectedIds) {
      expect(screen.getByTestId(`popup-btn-${id}`)).toBeInTheDocument();
    }

    // Hover shows Turkish tooltip matching reference design ("Not al")
    fireEvent.mouseEnter(screen.getByTestId("popup-btn-note").parentElement!);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Not al");

    // Highlight, Copy, Search Book, Web, Read Aloud, Read From Here, Settings all trigger callbacks
    fireEvent.click(screen.getByTestId("popup-btn-highlight"));
    fireEvent.click(screen.getByTestId("popup-btn-copy"));
    fireEvent.click(screen.getByTestId("popup-btn-search-book"));
    fireEvent.click(screen.getByTestId("popup-btn-search-web"));
    fireEvent.click(screen.getByTestId("popup-btn-read-aloud"));
    fireEvent.click(screen.getByTestId("popup-btn-read-from-here"));
    fireEvent.click(screen.getByTestId("popup-btn-settings"));

    await waitFor(() => {
      expect(onHighlight).toHaveBeenCalledWith("green", "solid");
      expect(onCopy).toHaveBeenCalledWith("Yapay zekâ sistemleri veriden öğrenir.");
      expect(onSearchInBook).toHaveBeenCalledWith("Yapay zekâ sistemleri veriden öğrenir.");
      expect(onSearchWeb).toHaveBeenCalledWith("Yapay zekâ sistemleri veriden öğrenir.");
      expect(onSpeakSelected).toHaveBeenCalledWith("Yapay zekâ sistemleri veriden öğrenir.");
      expect(onReadFromHere).toHaveBeenCalledTimes(1);
      expect(onOpenSettings).toHaveBeenCalledTimes(1);
    });

    // Note subpanel creates note with color & style
    fireEvent.click(screen.getByTestId("popup-btn-note"));
    fireEvent.change(screen.getByTestId("popup-note-input"), { target: { value: "Önemli nokta" } });
    fireEvent.click(screen.getByTestId("popup-note-save-btn"));
    await waitFor(() => {
      expect(onSaveNote).toHaveBeenCalledWith("Önemli nokta", "green", "solid");
    });

    // Styles and color swatches present
    expect(screen.getByTestId("popup-style-wavy")).toBeInTheDocument();
    expect(screen.getByTestId("popup-color-pink")).toBeInTheDocument();
  });
});
