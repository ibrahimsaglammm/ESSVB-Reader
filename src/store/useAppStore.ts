import { create } from "zustand";
import { getApiBridge } from "../services/tauriBridge";
import { TtsQueueController } from "../services/ttsQueue";
import { applyThemeToDocument, buildReaderIframeCss, resolvePalette } from "../themes/presets";
import type {
  AnnotationDto,
  AppSettings,
  AppVersionInfo,
  BookDto,
  BookFilterQuery,
  BookMetadataUpdate,
  BookSearchMatch,
  ChapterContent,
  CreateAnnotationInput,
  ReadingStatus,
  ShelfDto,
  TextChunk,
  TocItem,
  TtsCacheStats,
  TtsProviderStatus,
  UpdateApplyResult,
  UpdateAssetInfo,
  UpdateCheckResult,
} from "../types/models";

export type ActiveView = "library" | "reader" | "notes";
export type SettingsTab = "general" | "themes" | "tts" | "privacy" | "backup" | "about";

interface ToastMessage {
  id: number;
  kind: "info" | "success" | "error";
  message: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  language: "tr",
  themePreset: "light",
  followSystemTheme: true,
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
  ollamaModel: "",
  geminiTtsEnabled: false,
  geminiModel: "gemini-2.5-flash-preview-tts",
  geminiVoice: "Kore",
  geminiConfirmBeforeSend: true,
  askUpdateOnStartup: true,
  autoUpdateEnabled: true,
  updateCheckIntervalMinutes: 60,
  updateManifestUrl: "https://api.github.com/repos/ibrahimsaglammm/ESSVB-Reader/releases/latest",
};

interface AppStore {
  initialized: boolean;
  versionInfo: AppVersionInfo | null;
  settings: AppSettings;
  systemPrefersDark: boolean;
  geminiKeySaved: boolean;
  books: BookDto[];
  shelves: ShelfDto[];
  allTags: string[];
  selectedBookIds: string[];
  filter: BookFilterQuery;
  activeView: ActiveView;
  activeBook: BookDto | null;
  toc: TocItem[];
  currentChapter: ChapterContent | null;
  bookSearchResults: BookSearchMatch[];
  bookAnnotations: AnnotationDto[];
  globalAnnotations: AnnotationDto[];
  ttsStatuses: TtsProviderStatus[];
  ttsState: "idle" | "playing" | "paused" | "loading" | "error";
  ttsChunks: TextChunk[];
  ttsChunkIndex: number;
  ttsActiveChunk: TextChunk | null;
  ttsActiveVoice: string;
  ttsError: string | null;
  ttsPendingConsentText: string | null;
  ttsCacheStats: TtsCacheStats | null;
  ollamaModels: string[];
  updateBannerDismissed: boolean;
  updateCheckResult: UpdateCheckResult | null;
  updateChecking: boolean;
  updateError: string | null;
  updateModalSnoozedVersion: string | null;
  updateDownloading: boolean;
  updateApplyResult: UpdateApplyResult | null;
  settingsOpen: boolean;
  settingsTab: SettingsTab;
  shortcutsOpen: boolean;
  toast: ToastMessage | null;

  initialize: () => Promise<void>;
  setSystemPrefersDark: (dark: boolean) => void;
  showToast: (kind: ToastMessage["kind"], message: string) => void;
  clearToast: () => void;
  setActiveView: (view: ActiveView) => void;
  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;
  setShortcutsOpen: (open: boolean) => void;

  // Library & Shelves
  refreshLibrary: (overrideFilter?: BookFilterQuery) => Promise<void>;
  setFilter: (patch: Partial<BookFilterQuery>) => Promise<void>;
  resetFilters: () => Promise<void>;
  toggleSelectBook: (bookId: string) => void;
  toggleSelectAllBooks: () => void;
  clearSelectedBooks: () => void;
  importFilesPaths: (paths: string[]) => Promise<void>;
  importWithFileDialog: () => Promise<void>;
  importWithFolderDialog: () => Promise<void>;
  updateMetadataAndTags: (
    bookId: string,
    update: BookMetadataUpdate,
    tags: string[],
    shelfIds: string[],
  ) => Promise<void>;
  deleteBooks: (bookIds: string[]) => Promise<void>;
  createShelf: (name: string) => Promise<void>;
  renameShelf: (shelfId: string, newName: string) => Promise<void>;
  deleteShelf: (shelfId: string) => Promise<void>;
  assignBooksToShelf: (bookIds: string[], shelfId: string) => Promise<void>;
  removeBookFromShelf: (bookId: string, shelfId: string) => Promise<void>;
  bulkAddTags: (tags: string[]) => Promise<void>;
  bulkSetStatus: (status: ReadingStatus) => Promise<void>;

  // Reader & Notes
  openBook: (book: BookDto, overrideSpineIndex?: number) => Promise<void>;
  loadChapterIndex: (spineIndex: number) => Promise<void>;
  saveReaderProgress: (spineIndex: number, scrollOffset: number) => Promise<void>;
  searchInBook: (query: string) => Promise<void>;
  createAnnotation: (input: CreateAnnotationInput) => Promise<void>;
  updateAnnotation: (id: string, noteText: string, color: string) => Promise<void>;
  deleteAnnotation: (id: string) => Promise<void>;
  loadGlobalAnnotations: (bookId?: string, search?: string) => Promise<void>;
  exportNotes: (format: "md" | "json", bookId: string | null) => Promise<void>;

  // Settings, Security & Updates
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  refreshTtsStatuses: () => Promise<void>;
  fetchOllamaModels: () => Promise<void>;
  saveGeminiKey: (key: string) => Promise<void>;
  deleteGeminiKey: () => Promise<void>;
  clearTtsCache: () => Promise<void>;
  exportBackup: () => Promise<void>;
  importBackup: () => Promise<void>;
  dismissUpdateBanner: () => void;
  snoozeUpdateModal: () => void;
  triggerUpdateCheck: (explicitUserRequest: boolean) => Promise<void>;
  applyUpdate: (asset: UpdateAssetInfo) => Promise<void>;

  // TTS Playback
  speakText: (text: string, bypassGeminiPrompt?: boolean) => Promise<void>;
  confirmGeminiSpeak: () => Promise<void>;
  cancelGeminiSpeak: () => void;
  pauseTts: () => void;
  resumeTts: () => Promise<void>;
  stopTts: () => void;
  prevTtsChunk: () => Promise<void>;
  nextTtsChunk: () => Promise<void>;
}

let ttsController: TtsQueueController | null = null;

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

export const useAppStore = create<AppStore>((set, get) => {
  const ensureTtsController = () => {
    if (!ttsController) {
      ttsController = new TtsQueueController({
        synthesize: async (text, rate) => {
          return getApiBridge().synthesizeTtsChunk(text, rate);
        },
        onChunkStart: (chunk, index, _total, resp) => {
          set({
            ttsChunkIndex: index,
            ttsActiveChunk: chunk,
            ttsActiveVoice: resp.voiceName,
            ttsError: null,
          });
        },
        onStateChange: (state) => set({ ttsState: state }),
        onError: (message) => {
          set({ ttsError: message });
          get().showToast("error", message);
        },
        onComplete: () => {
          set({ ttsState: "idle", ttsActiveChunk: null });
        },
      });
    }
    return ttsController;
  };

  return {
    initialized: false,
    versionInfo: null,
    settings: DEFAULT_SETTINGS,
    systemPrefersDark:
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-color-scheme: dark)")?.matches === true,
    geminiKeySaved: false,
    books: [],
    shelves: [],
    allTags: [],
    selectedBookIds: [],
    filter: { sortBy: "addedAt", sortDir: "desc" },
    activeView: "library",
    activeBook: null,
    toc: [],
    currentChapter: null,
    bookSearchResults: [],
    bookAnnotations: [],
    globalAnnotations: [],
    ttsStatuses: [],
    ttsState: "idle",
    ttsChunks: [],
    ttsChunkIndex: 0,
    ttsActiveChunk: null,
    ttsActiveVoice: "",
    ttsError: null,
    ttsPendingConsentText: null,
    ttsCacheStats: null,
    ollamaModels: [],
    updateBannerDismissed: false,
    updateCheckResult: null,
    updateChecking: false,
    updateError: null,
    updateModalSnoozedVersion: null,
    updateDownloading: false,
    updateApplyResult: null,
    settingsOpen: false,
    settingsTab: "general",
    shortcutsOpen: false,
    toast: null,

    initialize: async () => {
      const api = getApiBridge();
      try {
        const [versionInfo, settings, geminiKeySaved] = await Promise.all([
          api.getVersionInfo(),
          api.getSettings(),
          api.hasGeminiApiKey().catch(() => false),
        ]);
        const palette = resolvePalette(settings, get().systemPrefersDark);
        applyThemeToDocument(palette);
        set({ versionInfo, settings, geminiKeySaved, initialized: true });
        await get().refreshLibrary();
        await get().loadGlobalAnnotations();
        await get().refreshTtsStatuses();

        // Only triggers outbound check on startup if user EXPLICITLY enabled autoUpdateEnabled
        if (settings.autoUpdateEnabled) {
          void get().triggerUpdateCheck(false);
        }
      } catch (err) {
        set({ initialized: true });
        get().showToast("error", extractErrorMessage(err));
      }
    },

    setSystemPrefersDark: (dark) => {
      set({ systemPrefersDark: dark });
      const { settings, activeBook, currentChapter } = get();
      const palette = resolvePalette(settings, dark);
      applyThemeToDocument(palette);
      if (activeBook && currentChapter) {
        void get().loadChapterIndex(currentChapter.spineIndex);
      }
    },

    showToast: (kind, message) => {
      const id = Date.now();
      set({ toast: { id, kind, message } });
      setTimeout(() => {
        if (get().toast?.id === id) {
          set({ toast: null });
        }
      }, 4500);
    },

    clearToast: () => set({ toast: null }),
    setActiveView: (activeView) => set({ activeView }),
    openSettings: (tab = "general") => {
      set({ settingsOpen: true, settingsTab: tab });
      void get().refreshTtsStatuses();
    },
    closeSettings: () => set({ settingsOpen: false }),
    setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),

    refreshLibrary: async (overrideFilter) => {
      const api = getApiBridge();
      const activeFilter = overrideFilter ?? get().filter;
      const [books, shelves, allTags] = await Promise.all([
        api.listBooks(activeFilter),
        api.listShelves(),
        api.listAllTags(),
      ]);
      set({ books, shelves, allTags });
    },

    setFilter: async (patch) => {
      const next = { ...get().filter, ...patch };
      set({ filter: next });
      await get().refreshLibrary(next);
    },

    resetFilters: async () => {
      const next: BookFilterQuery = { sortBy: "addedAt", sortDir: "desc" };
      set({ filter: next });
      await get().refreshLibrary(next);
    },

    toggleSelectBook: (bookId) => {
      const cur = get().selectedBookIds;
      set({
        selectedBookIds: cur.includes(bookId)
          ? cur.filter((id) => id !== bookId)
          : [...cur, bookId],
      });
    },

    toggleSelectAllBooks: () => {
      const { books, selectedBookIds } = get();
      if (selectedBookIds.length === books.length && books.length > 0) {
        set({ selectedBookIds: [] });
      } else {
        set({ selectedBookIds: books.map((b) => b.id) });
      }
    },

    clearSelectedBooks: () => set({ selectedBookIds: [] }),

    importFilesPaths: async (paths) => {
      if (paths.length === 0) return;
      try {
        const res = await getApiBridge().importEpubFiles(paths);
        await get().refreshLibrary();
        if (res.imported.length > 0) {
          get().showToast("success", `${res.imported.length} kitap kütüphaneye eklendi.`);
        } else if (res.skippedDuplicates.length > 0) {
          get().showToast("info", "Seçilen kitap zaten kütüphanede mevcut.");
        }
        if (res.failed.length > 0) {
          get().showToast("error", res.failed[0] ?? "Bazı dosyalar içe aktarılamadı.");
        }
      } catch (err) {
        get().showToast("error", extractErrorMessage(err));
      }
    },

    importWithFileDialog: async () => {
      const paths = await getApiBridge().pickEpubFiles();
      if (paths && paths.length > 0) {
        await get().importFilesPaths(paths);
      }
    },

    importWithFolderDialog: async () => {
      const folder = await getApiBridge().pickFolder();
      if (!folder) return;
      try {
        const res = await getApiBridge().importEpubFolder(folder);
        await get().refreshLibrary();
        get().showToast(
          "success",
          `Klasörden ${res.imported.length} kitap eklendi (${res.skippedDuplicates.length} mükerrer atlandı).`,
        );
      } catch (err) {
        get().showToast("error", extractErrorMessage(err));
      }
    },

    updateMetadataAndTags: async (bookId, update, tags, shelfIds) => {
      const api = getApiBridge();
      const updated = await api.updateBookMetadata(bookId, update);
      await api.setBookTags(bookId, tags);

      const oldShelves = updated.shelfIds;
      for (const sid of oldShelves) {
        if (!shelfIds.includes(sid)) {
          await api.removeBookFromShelf(bookId, sid);
        }
      }
      for (const sid of shelfIds) {
        if (!oldShelves.includes(sid)) {
          await api.assignBooksToShelf([bookId], sid);
        }
      }
      await get().refreshLibrary();
      get().showToast("success", "Kitap bilgileri güncellendi.");
    },

    deleteBooks: async (bookIds) => {
      if (bookIds.length === 0) return;
      await getApiBridge().deleteBooks(bookIds);
      set({ selectedBookIds: [] });
      if (get().activeBook && bookIds.includes(get().activeBook!.id)) {
        get().stopTts();
        set({ activeBook: null, currentChapter: null, activeView: "library" });
      }
      await get().refreshLibrary();
      await get().loadGlobalAnnotations();
    },

    createShelf: async (name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      try {
        await getApiBridge().createShelf(trimmed);
        await get().refreshLibrary();
      } catch (err) {
        get().showToast("error", extractErrorMessage(err));
      }
    },

    renameShelf: async (shelfId, newName) => {
      const trimmed = newName.trim();
      if (!trimmed) return;
      try {
        await getApiBridge().renameShelf(shelfId, trimmed);
        await get().refreshLibrary();
      } catch (err) {
        get().showToast("error", extractErrorMessage(err));
      }
    },

    deleteShelf: async (shelfId) => {
      await getApiBridge().deleteShelf(shelfId);
      if (get().filter.shelfId === shelfId) {
        await get().setFilter({ shelfId: undefined });
      } else {
        await get().refreshLibrary();
      }
    },

    assignBooksToShelf: async (bookIds, shelfId) => {
      if (bookIds.length === 0) return;
      await getApiBridge().assignBooksToShelf(bookIds, shelfId);
      await get().refreshLibrary();
      get().showToast("success", "Kitap(lar) rafa eklendi.");
    },

    removeBookFromShelf: async (bookId, shelfId) => {
      await getApiBridge().removeBookFromShelf(bookId, shelfId);
      await get().refreshLibrary();
    },

    bulkAddTags: async (tags) => {
      const ids = get().selectedBookIds;
      if (ids.length === 0 || tags.length === 0) return;
      await getApiBridge().bulkAddTags(ids, tags);
      await get().refreshLibrary();
      get().showToast("success", "Etiketler eklendi.");
    },

    bulkSetStatus: async (status) => {
      const ids = get().selectedBookIds;
      if (ids.length === 0) return;
      await getApiBridge().bulkSetReadingStatus(ids, status);
      await get().refreshLibrary();
    },

    openBook: async (book, overrideSpineIndex) => {
      const api = getApiBridge();
      get().stopTts();
      const targetSpine = overrideSpineIndex ?? book.lastSpineIndex;
      const themeCss = buildReaderIframeCss(get().settings, get().systemPrefersDark);
      try {
        const [toc, chapter, notes] = await Promise.all([
          api.getBookToc(book.id),
          api.loadChapter(book.id, targetSpine, themeCss),
          api.listAnnotations(book.id),
        ]);
        set({
          activeBook: book,
          toc,
          currentChapter: chapter,
          bookAnnotations: notes,
          bookSearchResults: [],
          activeView: "reader",
        });
      } catch (err) {
        get().showToast("error", extractErrorMessage(err));
      }
    },

    loadChapterIndex: async (spineIndex) => {
      const book = get().activeBook;
      if (!book) return;
      get().stopTts();
      const themeCss = buildReaderIframeCss(get().settings, get().systemPrefersDark);
      try {
        const chapter = await getApiBridge().loadChapter(book.id, spineIndex, themeCss);
        set({ currentChapter: chapter });
        await get().saveReaderProgress(spineIndex, 0);
      } catch (err) {
        get().showToast("error", extractErrorMessage(err));
      }
    },

    saveReaderProgress: async (spineIndex, scrollOffset) => {
      const book = get().activeBook;
      const ch = get().currentChapter;
      if (!book) return;
      const total = Math.max(1, ch?.chapterCount ?? book.spineCount);
      const pct = Math.min(
        100,
        Math.round(((spineIndex + Math.max(0.05, scrollOffset)) / total) * 100),
      );
      await getApiBridge().updateReadingProgress(book.id, spineIndex, scrollOffset, pct);
      set({
        activeBook: {
          ...book,
          lastSpineIndex: spineIndex,
          lastScrollOffset: scrollOffset,
          progressPercent: pct,
        },
      });
      await get().refreshLibrary();
    },

    searchInBook: async (query) => {
      const book = get().activeBook;
      if (!book) return;
      const hits = await getApiBridge().searchBook(book.id, query);
      set({ bookSearchResults: hits });
    },

    createAnnotation: async (input) => {
      await getApiBridge().createAnnotation(input);
      const [bookNotes, globalNotes] = await Promise.all([
        getApiBridge().listAnnotations(input.bookId),
        getApiBridge().listAnnotations(),
      ]);
      set({ bookAnnotations: bookNotes, globalAnnotations: globalNotes });
      get().showToast("success", "Vurgu / not kaydedildi.");
    },

    updateAnnotation: async (id, noteText, color) => {
      await getApiBridge().updateAnnotation(id, noteText, color);
      const bookId = get().activeBook?.id;
      const [bookNotes, globalNotes] = await Promise.all([
        bookId ? getApiBridge().listAnnotations(bookId) : Promise.resolve([]),
        getApiBridge().listAnnotations(),
      ]);
      set({ bookAnnotations: bookNotes, globalAnnotations: globalNotes });
    },

    deleteAnnotation: async (id) => {
      await getApiBridge().deleteAnnotation(id);
      const bookId = get().activeBook?.id;
      const [bookNotes, globalNotes] = await Promise.all([
        bookId ? getApiBridge().listAnnotations(bookId) : Promise.resolve([]),
        getApiBridge().listAnnotations(),
      ]);
      set({ bookAnnotations: bookNotes, globalAnnotations: globalNotes });
    },

    loadGlobalAnnotations: async (bookId, search) => {
      const notes = await getApiBridge().listAnnotations(bookId, search);
      set({ globalAnnotations: notes });
    },

    exportNotes: async (format, bookId) => {
      const api = getApiBridge();
      const dest = await api.pickSavePath(
        format === "md" ? "essvb-notlar.md" : "essvb-notlar.json",
        format === "md" ? "Markdown" : "JSON",
        [format],
      );
      if (!dest) return;
      const count =
        format === "md"
          ? await api.exportNotesMarkdown(bookId, dest)
          : await api.exportNotesJson(bookId, dest);
      get().showToast("success", `${count} not dışa aktarıldı.`);
    },

    updateSettings: async (patch) => {
      const merged = { ...get().settings, ...patch };
      const saved = await getApiBridge().saveSettings(merged);
      const palette = resolvePalette(saved, get().systemPrefersDark);
      applyThemeToDocument(palette);
      set({ settings: saved });
      if (ttsController) {
        ttsController.setRate(saved.ttsRate);
      }
      if (get().activeBook && get().currentChapter) {
        const ch = get().currentChapter!;
        const themeCss = buildReaderIframeCss(saved, get().systemPrefersDark);
        const reloaded = await getApiBridge().loadChapter(
          get().activeBook!.id,
          ch.spineIndex,
          themeCss,
        );
        set({ currentChapter: reloaded });
      }
    },

    refreshTtsStatuses: async () => {
      const api = getApiBridge();
      const [ttsStatuses, ttsCacheStats] = await Promise.all([
        api.getTtsStatuses(),
        api.getTtsCacheStats(),
      ]);
      set({ ttsStatuses, ttsCacheStats });
    },

    fetchOllamaModels: async () => {
      try {
        const models = await getApiBridge().listOllamaModels(get().settings.ollamaUrl);
        set({ ollamaModels: models });
        if (models.length === 0) {
          get().showToast("info", "Ollama'da yüklü model bulunamadı.");
        }
      } catch (err) {
        get().showToast("error", extractErrorMessage(err));
      }
    },

    saveGeminiKey: async (key) => {
      try {
        await getApiBridge().setGeminiApiKey(key);
        set({ geminiKeySaved: true });
        await get().refreshTtsStatuses();
        get().showToast(
          "success",
          "Gemini API anahtarı işletim sistemi anahtar deposuna kaydedildi.",
        );
      } catch (err) {
        get().showToast("error", extractErrorMessage(err));
      }
    },

    deleteGeminiKey: async () => {
      await getApiBridge().deleteGeminiApiKey();
      set({ geminiKeySaved: false });
      await get().refreshTtsStatuses();
      get().showToast("info", "Gemini API anahtarı güvenli depodan silindi.");
    },

    clearTtsCache: async () => {
      const removed = await getApiBridge().clearTtsCache();
      await get().refreshTtsStatuses();
      get().showToast("info", `Önbellekten ${removed} ses dosyası temizlendi.`);
    },

    exportBackup: async () => {
      const api = getApiBridge();
      const dest = await api.pickSavePath("essvb-kutuphane-yedek.json", "JSON", ["json"]);
      if (!dest) return;
      await api.exportLibraryBackup(dest);
      get().showToast("success", "Kütüphane yedeği JSON olarak kaydedildi.");
    },

    importBackup: async () => {
      const api = getApiBridge();
      const src = await api.pickOpenJsonPath();
      if (!src) return;
      try {
        const res = await api.importLibraryBackup(src);
        await get().initialize();
        get().showToast(
          "success",
          `Geri yüklendi: ${res.shelvesRestored} raf, ${res.annotationsRestored} not.`,
        );
      } catch (err) {
        get().showToast("error", extractErrorMessage(err));
      }
    },

    dismissUpdateBanner: () => set({ updateBannerDismissed: true }),

    snoozeUpdateModal: () =>
      set((state) => ({
        updateModalSnoozedVersion: state.updateCheckResult?.latestVersion ?? null,
      })),

    triggerUpdateCheck: async (explicitUserRequest) => {
      set({ updateChecking: true, updateError: null });
      try {
        const result = await getApiBridge().checkForUpdates(explicitUserRequest);
        set({
          updateCheckResult: result,
          updateChecking: false,
          ...(explicitUserRequest ? { updateModalSnoozedVersion: null } : {}),
        });
      } catch (err) {
        const msg = extractErrorMessage(err);
        set({ updateError: msg, updateChecking: false });
        if (explicitUserRequest) {
          get().showToast("error", msg);
        }
      }
    },

    applyUpdate: async (asset) => {
      set({ updateDownloading: true, updateApplyResult: null });
      try {
        const applied = await getApiBridge().downloadAndApplyUpdate(
          asset.downloadUrl,
          asset.name,
          asset.sha256,
          true,
        );
        set({ updateDownloading: false, updateApplyResult: applied });
        const hint = get().settings.language === "tr" ? applied.actionHintTr : applied.actionHintEn;
        get().showToast("success", hint);
      } catch (err) {
        set({ updateDownloading: false });
        get().showToast("error", extractErrorMessage(err));
      }
    },

    speakText: async (text, bypassGeminiPrompt = false) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const { settings } = get();
      if (
        settings.ttsProvider === "gemini" &&
        settings.geminiConfirmBeforeSend &&
        !bypassGeminiPrompt
      ) {
        set({ ttsPendingConsentText: trimmed });
        return;
      }

      const chunks = await getApiBridge().splitTtsChunks(trimmed, 340);
      set({ ttsChunks: chunks, ttsChunkIndex: 0, ttsError: null });
      const ctrl = ensureTtsController();
      await ctrl.start(chunks, settings.ttsRate);
    },

    confirmGeminiSpeak: async () => {
      const pending = get().ttsPendingConsentText;
      set({ ttsPendingConsentText: null });
      if (pending) {
        await get().speakText(pending, true);
      }
    },

    cancelGeminiSpeak: () => set({ ttsPendingConsentText: null }),
    pauseTts: () => ensureTtsController().pause(),
    resumeTts: async () => ensureTtsController().resume(),
    stopTts: () => {
      if (ttsController) {
        ttsController.stop();
      }
      set({ ttsState: "idle", ttsActiveChunk: null, ttsChunks: [], ttsChunkIndex: 0 });
    },
    prevTtsChunk: async () => ensureTtsController().prev(),
    nextTtsChunk: async () => ensureTtsController().next(),
  };
});
