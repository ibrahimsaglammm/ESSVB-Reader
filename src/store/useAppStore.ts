import { create } from "zustand";
import { getApiBridge } from "../services/tauriBridge";
import { TtsQueueController } from "../services/ttsQueue";
import { applyThemeToDocument, buildReaderIframeCss, resolvePalette } from "../themes/presets";
import { computeTtsGlobalPage, resolveGlobalPageTarget } from "../utils/pagination";
import type {
  AnnotationDto,
  AppSettings,
  AppVersionInfo,
  BookDto,
  BookFilterQuery,
  BookMetadataUpdate,
  BookSearchMatch,
  BookmarkDto,
  ChapterContent,
  CreateAnnotationInput,
  ReadingStatus,
  ShelfDto,
  TextAssistRequest,
  TextAssistResponse,
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
export type ChapterLandingHint = "start" | "end" | { pageIndex?: number; charOffset?: number };

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
  lastOpenedBookId: null,
  reopenLastBookOnStartup: true,
  readerLayoutMode: "paginated-1",
  ttsFollowPage: true,
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
  bookPageMap: number[];
  bookBookmarks: BookmarkDto[];
  pendingChapterLanding: ChapterLandingHint | null;
  pendingJumpAnnotation: {
    id: string;
    spineIndex: number;
    startOffset: number;
    quoteText: string;
  } | null;
  ttsStatuses: TtsProviderStatus[];
  ttsState: "idle" | "playing" | "paused" | "loading" | "error";
  ttsChunks: TextChunk[];
  ttsChunkIndex: number;
  ttsActiveChunk: TextChunk | null;
  ttsActiveVoice: string;
  ttsError: string | null;
  ttsPendingConsentText: string | null;
  ttsBookId: string | null;
  ttsSpineIndex: number;
  ttsBaseCharOffset: number;
  ttsFollowStream: boolean;
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
  openBook: (
    book: BookDto,
    overrideSpineIndex?: number,
    landing?: ChapterLandingHint,
  ) => Promise<void>;
  loadChapterIndex: (spineIndex: number, landing?: ChapterLandingHint) => Promise<void>;
  clearPendingChapterLanding: () => void;
  saveReaderProgress: (
    spineIndex: number,
    scrollOffset: number,
    pageIndex?: number,
    charOffset?: number,
  ) => Promise<void>;
  jumpToGlobalPage: (globalPage: number) => Promise<void>;
  toggleBookmarkAtCurrentPage: (
    spineIndex: number,
    pageIndex: number,
    charOffset: number,
    label: string,
    pageLabel?: string,
  ) => Promise<void>;
  deleteBookmark: (bookmarkId: string) => Promise<void>;
  jumpToBookmark: (bm: BookmarkDto) => Promise<void>;
  searchInBook: (query: string) => Promise<void>;
  createAnnotation: (input: CreateAnnotationInput) => Promise<void>;
  updateAnnotation: (
    id: string,
    noteText: string,
    color: string,
    highlightStyle?: string,
  ) => Promise<void>;
  deleteAnnotation: (id: string) => Promise<void>;
  jumpToAnnotation: (ann: AnnotationDto) => Promise<void>;
  clearPendingJumpAnnotation: () => void;
  loadGlobalAnnotations: (bookId?: string, search?: string) => Promise<void>;
  exportNotes: (format: "md" | "json", bookId: string | null) => Promise<void>;
  assistSelectedText: (request: TextAssistRequest) => Promise<TextAssistResponse>;
  openExternalUrl: (url: string) => Promise<void>;

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
  updateTtsProgress: (
    ttsSpineIndex: number,
    ttsCharOffset: number,
    ttsPageNumber: number,
    ttsSnippet: string,
  ) => Promise<void>;
  speakText: (text: string, bypassGeminiPrompt?: boolean) => Promise<void>;
  startTtsFromPosition: (
    bookId: string,
    spineIndex: number,
    charOffset: number,
    textSlice: string,
    followStream?: boolean,
    bypassGeminiPrompt?: boolean,
  ) => Promise<void>;
  resumeOrStartTtsFromSaved: (bypassGeminiPrompt?: boolean) => Promise<void>;
  jumpVisualToTtsLocation: () => Promise<void>;
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
          const st = get();
          set({
            ttsChunkIndex: index,
            ttsActiveChunk: chunk,
            ttsActiveVoice: resp.voiceName,
            ttsError: null,
          });
          if (st.ttsFollowStream && st.ttsBookId && st.activeBook?.id === st.ttsBookId) {
            const absOffset = st.ttsBaseCharOffset + chunk.startOffset;
            const ttsPage = computeTtsGlobalPage(st.bookPageMap, st.ttsSpineIndex, absOffset);
            void st.updateTtsProgress(
              st.ttsSpineIndex,
              absOffset,
              ttsPage,
              chunk.text.slice(0, 80),
            );
          }
        },
        onStateChange: (state) => set({ ttsState: state }),
        onError: (message) => {
          set({ ttsError: message });
          get().showToast("error", message);
        },
        onComplete: () => {
          const st = get();
          if (
            st.ttsFollowStream &&
            st.ttsBookId &&
            st.activeBook?.id === st.ttsBookId &&
            st.ttsSpineIndex + 1 < st.activeBook.spineCount
          ) {
            const nextSpine = st.ttsSpineIndex + 1;
            const themeCss = buildReaderIframeCss(st.settings, st.systemPrefersDark);
            void getApiBridge()
              .loadChapter(st.activeBook.id, nextSpine, themeCss)
              .then((nextChapter) => {
                if (get().activeBook?.id !== st.ttsBookId) return;
                if (get().settings.ttsFollowPage && get().activeView === "reader") {
                  set({ currentChapter: nextChapter, pendingChapterLanding: "start" });
                }
                return get().startTtsFromPosition(
                  st.ttsBookId!,
                  nextSpine,
                  0,
                  nextChapter.plainText,
                  true,
                  true,
                );
              })
              .catch(() => {
                set({ ttsState: "idle", ttsActiveChunk: null });
              });
            return;
          }
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
    bookPageMap: [],
    bookBookmarks: [],
    pendingChapterLanding: null,
    pendingJumpAnnotation: null,
    ttsStatuses: [],
    ttsState: "idle",
    ttsChunks: [],
    ttsChunkIndex: 0,
    ttsActiveChunk: null,
    ttsActiveVoice: "",
    ttsError: null,
    ttsPendingConsentText: null,
    ttsBookId: null,
    ttsSpineIndex: 0,
    ttsBaseCharOffset: 0,
    ttsFollowStream: false,
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

        if (settings.reopenLastBookOnStartup && settings.lastOpenedBookId) {
          const lastBook = get().books.find((b) => b.id === settings.lastOpenedBookId);
          if (lastBook) {
            await get().openBook(lastBook);
          }
        }

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
    setActiveView: (activeView) => {
      const prevView = get().activeView;
      set({ activeView });
      if (activeView === "library" && prevView === "reader") {
        const curSettings = get().settings;
        if (curSettings.lastOpenedBookId !== null) {
          const updatedSettings = { ...curSettings, lastOpenedBookId: null };
          set({ settings: updatedSettings });
          void getApiBridge()
            .saveSettings(updatedSettings)
            .catch(() => undefined);
        }
      }
    },
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

    openBook: async (book, overrideSpineIndex, landing) => {
      const api = getApiBridge();
      const prevTtsBookId = get().ttsBookId;
      if (prevTtsBookId && prevTtsBookId !== book.id) {
        get().stopTts();
      }
      const targetSpine = overrideSpineIndex ?? book.lastSpineIndex;
      const themeCss = buildReaderIframeCss(get().settings, get().systemPrefersDark);
      try {
        const [toc, chapter, notes, pageMap, bookmarks] = await Promise.all([
          api.getBookToc(book.id),
          api.loadChapter(book.id, targetSpine, themeCss),
          api.listAnnotations(book.id),
          api.getBookPageMap(book.id).catch(() => [] as number[]),
          api.listBookmarks(book.id).catch(() => [] as BookmarkDto[]),
        ]);
        const landingHint: ChapterLandingHint =
          landing ??
          (overrideSpineIndex !== undefined
            ? "start"
            : { pageIndex: book.lastPageIndex, charOffset: book.lastCharOffset });
        set({
          activeBook: book,
          toc,
          currentChapter: chapter,
          bookAnnotations: notes,
          bookPageMap: pageMap,
          bookBookmarks: bookmarks,
          pendingChapterLanding: landingHint,
          bookSearchResults: [],
          activeView: "reader",
        });

        const curSettings = get().settings;
        if (curSettings.lastOpenedBookId !== book.id) {
          const updatedSettings = { ...curSettings, lastOpenedBookId: book.id };
          set({ settings: updatedSettings });
          void api.saveSettings(updatedSettings).catch(() => undefined);
        }
      } catch (err) {
        get().showToast("error", extractErrorMessage(err));
      }
    },

    loadChapterIndex: async (spineIndex, landing = "start") => {
      const book = get().activeBook;
      if (!book) return;
      const clampedSpine = Math.max(0, Math.min(Math.max(0, book.spineCount - 1), spineIndex));
      const themeCss = buildReaderIframeCss(get().settings, get().systemPrefersDark);
      try {
        const chapter = await getApiBridge().loadChapter(book.id, clampedSpine, themeCss);
        set({ currentChapter: chapter, pendingChapterLanding: landing });
        await get().saveReaderProgress(clampedSpine, landing === "end" ? 1 : 0, 0, 0);
      } catch (err) {
        get().showToast("error", extractErrorMessage(err));
      }
    },

    clearPendingChapterLanding: () => set({ pendingChapterLanding: null }),

    saveReaderProgress: async (spineIndex, scrollOffset, pageIndex = 0, charOffset = 0) => {
      const book = get().activeBook;
      const ch = get().currentChapter;
      if (!book) return;
      const total = Math.max(1, ch?.chapterCount ?? book.spineCount);
      const clampedScroll = Math.max(0, Math.min(1, scrollOffset));
      const pct = Math.min(
        100,
        Math.round(((spineIndex + Math.max(0.05, clampedScroll)) / total) * 100),
      );
      await getApiBridge().updateReadingProgress(
        book.id,
        spineIndex,
        clampedScroll,
        pct,
        undefined,
        pageIndex,
        charOffset,
      );
      set({
        activeBook: {
          ...book,
          lastSpineIndex: spineIndex,
          lastScrollOffset: clampedScroll,
          lastPageIndex: pageIndex,
          lastCharOffset: charOffset,
          progressPercent: pct,
        },
        books: get().books.map((b) =>
          b.id === book.id
            ? {
                ...b,
                lastSpineIndex: spineIndex,
                lastScrollOffset: clampedScroll,
                lastPageIndex: pageIndex,
                lastCharOffset: charOffset,
                progressPercent: pct,
              }
            : b,
        ),
      });
    },

    jumpToGlobalPage: async (globalPage) => {
      const book = get().activeBook;
      if (!book) return;
      const target = resolveGlobalPageTarget(get().bookPageMap, globalPage);
      if (get().currentChapter?.spineIndex === target.spineIndex) {
        set({ pendingChapterLanding: { pageIndex: target.pageIndexInChapter } });
      } else {
        await get().loadChapterIndex(target.spineIndex, { pageIndex: target.pageIndexInChapter });
      }
    },

    toggleBookmarkAtCurrentPage: async (spineIndex, pageIndex, charOffset, label, pageLabel) => {
      const book = get().activeBook;
      if (!book) return;
      const existing = get().bookBookmarks.find(
        (bm) => bm.spineIndex === spineIndex && bm.pageIndex === pageIndex,
      );
      if (existing) {
        await get().deleteBookmark(existing.id);
        return;
      }
      await getApiBridge().createBookmark({
        bookId: book.id,
        spineIndex,
        pageIndex,
        charOffset,
        pageLabel: pageLabel ?? `S. ${pageIndex + 1}`,
        label,
      });
      const updated = await getApiBridge().listBookmarks(book.id);
      set({ bookBookmarks: updated });
      get().showToast("success", "Yer imi eklendi.");
    },

    deleteBookmark: async (bookmarkId) => {
      const book = get().activeBook;
      await getApiBridge().deleteBookmark(bookmarkId);
      if (book) {
        const updated = await getApiBridge().listBookmarks(book.id);
        set({ bookBookmarks: updated });
      }
    },

    jumpToBookmark: async (bm) => {
      const book = get().activeBook;
      if (!book) return;
      const hint: ChapterLandingHint = { pageIndex: bm.pageIndex, charOffset: bm.charOffset };
      if (get().currentChapter?.spineIndex === bm.spineIndex) {
        set({ pendingChapterLanding: hint });
      } else {
        await get().loadChapterIndex(bm.spineIndex, hint);
      }
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

    updateAnnotation: async (id, noteText, color, highlightStyle) => {
      await getApiBridge().updateAnnotation(id, noteText, color, highlightStyle);
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

    jumpToAnnotation: async (ann) => {
      const targetBook =
        get().activeBook?.id === ann.bookId
          ? get().activeBook
          : (get().books.find((b) => b.id === ann.bookId) ?? null);
      if (!targetBook) {
        get().showToast("error", "Hedef kitap kütüphanede bulunamadı.");
        return;
      }

      set({
        pendingJumpAnnotation: {
          id: ann.id,
          spineIndex: ann.spineIndex,
          startOffset: ann.startOffset,
          quoteText: ann.quoteText,
        },
      });

      if (get().activeBook?.id === targetBook.id && get().activeView === "reader") {
        if (get().currentChapter?.spineIndex !== ann.spineIndex) {
          await get().loadChapterIndex(ann.spineIndex);
        }
      } else {
        await get().openBook(targetBook, ann.spineIndex);
      }
    },

    clearPendingJumpAnnotation: () => set({ pendingJumpAnnotation: null }),

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

    assistSelectedText: async (request) => {
      return getApiBridge().assistSelectedText(request);
    },

    openExternalUrl: async (url) => {
      try {
        await getApiBridge().openExternalUrl(url);
      } catch (err) {
        get().showToast("error", extractErrorMessage(err));
      }
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

    updateTtsProgress: async (ttsSpineIndex, ttsCharOffset, ttsPageNumber, ttsSnippet) => {
      const book = get().activeBook;
      if (!book) return;
      await getApiBridge().updateTtsProgress(
        book.id,
        ttsSpineIndex,
        ttsCharOffset,
        ttsPageNumber,
        ttsSnippet,
      );
      set({
        activeBook: {
          ...book,
          ttsSpineIndex,
          ttsCharOffset,
          ttsPageNumber,
          ttsSnippet,
        },
        books: get().books.map((b) =>
          b.id === book.id
            ? {
                ...b,
                ttsSpineIndex,
                ttsCharOffset,
                ttsPageNumber,
                ttsSnippet,
              }
            : b,
        ),
      });
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
      set({
        ttsChunks: chunks,
        ttsChunkIndex: 0,
        ttsError: null,
        ttsFollowStream: false,
      });
      const ctrl = ensureTtsController();
      await ctrl.start(chunks, settings.ttsRate);
    },

    startTtsFromPosition: async (
      bookId,
      spineIndex,
      charOffset,
      textSlice,
      followStream = true,
      bypassGeminiPrompt = false,
    ) => {
      const trimmed = textSlice.trim();
      if (!trimmed) return;
      const { settings } = get();
      if (
        settings.ttsProvider === "gemini" &&
        settings.geminiConfirmBeforeSend &&
        !bypassGeminiPrompt
      ) {
        set({
          ttsPendingConsentText: trimmed,
          ttsBookId: bookId,
          ttsSpineIndex: spineIndex,
          ttsBaseCharOffset: charOffset,
          ttsFollowStream: followStream,
        });
        return;
      }

      const chunks = await getApiBridge().splitTtsChunks(trimmed, 340);
      set({
        ttsBookId: bookId,
        ttsSpineIndex: spineIndex,
        ttsBaseCharOffset: charOffset,
        ttsFollowStream: followStream,
        ttsChunks: chunks,
        ttsChunkIndex: 0,
        ttsError: null,
      });
      const ctrl = ensureTtsController();
      await ctrl.start(chunks, settings.ttsRate);
    },

    resumeOrStartTtsFromSaved: async (bypassGeminiPrompt = false) => {
      const book = get().activeBook;
      const ch = get().currentChapter;
      if (!book) return;
      const targetSpine = Math.max(
        0,
        Math.min(Math.max(0, book.spineCount - 1), book.ttsSpineIndex),
      );
      const targetOffset = Math.max(0, book.ttsCharOffset);
      const themeCss = buildReaderIframeCss(get().settings, get().systemPrefersDark);
      const chapter =
        ch && ch.spineIndex === targetSpine
          ? ch
          : await getApiBridge().loadChapter(book.id, targetSpine, themeCss);

      const safeOffset = targetOffset < chapter.plainText.length ? targetOffset : 0;
      const slice = chapter.plainText.slice(safeOffset);
      if (get().settings.ttsFollowPage && ch?.spineIndex !== targetSpine) {
        set({
          currentChapter: chapter,
          pendingChapterLanding: { charOffset: safeOffset },
        });
      }
      await get().startTtsFromPosition(
        book.id,
        targetSpine,
        safeOffset,
        slice,
        true,
        bypassGeminiPrompt,
      );
    },

    jumpVisualToTtsLocation: async () => {
      const book = get().activeBook;
      if (!book) return;
      const targetSpine = Math.max(
        0,
        Math.min(Math.max(0, book.spineCount - 1), book.ttsSpineIndex),
      );
      const hint: ChapterLandingHint = { charOffset: Math.max(0, book.ttsCharOffset) };
      if (get().currentChapter?.spineIndex === targetSpine) {
        set({ pendingChapterLanding: hint });
      } else {
        await get().loadChapterIndex(targetSpine, hint);
      }
    },

    confirmGeminiSpeak: async () => {
      const pending = get().ttsPendingConsentText;
      const st = get();
      set({ ttsPendingConsentText: null });
      if (pending) {
        if (st.ttsFollowStream && st.ttsBookId) {
          await get().startTtsFromPosition(
            st.ttsBookId,
            st.ttsSpineIndex,
            st.ttsBaseCharOffset,
            pending,
            true,
            true,
          );
        } else {
          await get().speakText(pending, true);
        }
      }
    },

    cancelGeminiSpeak: () => set({ ttsPendingConsentText: null }),
    pauseTts: () => ensureTtsController().pause(),
    resumeTts: async () => ensureTtsController().resume(),
    stopTts: () => {
      if (ttsController) {
        ttsController.stop();
      }
      set({
        ttsState: "idle",
        ttsActiveChunk: null,
        ttsChunks: [],
        ttsChunkIndex: 0,
        ttsFollowStream: false,
      });
    },
    prevTtsChunk: async () => ensureTtsController().prev(),
    nextTtsChunk: async () => ensureTtsController().next(),
  };
});
