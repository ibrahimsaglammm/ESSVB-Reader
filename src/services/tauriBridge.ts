import { invoke } from "@tauri-apps/api/core";
import { open as dialogOpen, save as dialogSave } from "@tauri-apps/plugin-dialog";
import { buildReaderIframeCss } from "../themes/presets";
import type {
  AnnotationDto,
  AppSettings,
  AppVersionInfo,
  BookDto,
  BookFilterQuery,
  BookMetadataUpdate,
  BookmarkDto,
  BookSearchMatch,
  ChapterContent,
  CreateAnnotationInput,
  CreateBookmarkInput,
  ImportSummary,
  RestoreBackupResult,
  ShelfDto,
  TextAssistRequest,
  TextAssistResponse,
  TextChunk,
  TocItem,
  TtsCacheStats,
  TtsProviderStatus,
  TtsSynthesisResponse,
  UpdateApplyResult,
  UpdateCheckResult,
} from "../types/models";

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export interface ApiBridge {
  getVersionInfo(): Promise<AppVersionInfo>;
  checkForUpdates(explicitUserRequest: boolean): Promise<UpdateCheckResult>;
  downloadAndApplyUpdate(
    downloadUrl: string,
    fileName: string,
    expectedSha256: string | null,
    userConfirmed: boolean,
  ): Promise<UpdateApplyResult>;
  importEpubFiles(paths: string[]): Promise<ImportSummary>;
  importEpubFolder(folderPath: string): Promise<ImportSummary>;
  listBooks(filter?: BookFilterQuery): Promise<BookDto[]>;
  updateBookMetadata(bookId: string, update: BookMetadataUpdate): Promise<BookDto>;
  updateReadingProgress(
    bookId: string,
    spineIndex: number,
    scrollOffset: number,
    progressPercent: number,
    readingStatus?: string,
    lastPageIndex?: number,
    lastCharOffset?: number,
  ): Promise<void>;
  updateTtsProgress(
    bookId: string,
    ttsSpineIndex: number,
    ttsCharOffset: number,
    ttsPageNumber: number,
    ttsSnippet: string,
  ): Promise<void>;
  deleteBooks(bookIds: string[]): Promise<number>;
  listAllTags(): Promise<string[]>;
  setBookTags(bookId: string, tags: string[]): Promise<void>;
  bulkAddTags(bookIds: string[], tags: string[]): Promise<void>;
  bulkSetReadingStatus(bookIds: string[], status: string): Promise<void>;
  listShelves(): Promise<ShelfDto[]>;
  createShelf(name: string): Promise<ShelfDto>;
  renameShelf(shelfId: string, newName: string): Promise<void>;
  deleteShelf(shelfId: string): Promise<void>;
  assignBooksToShelf(bookIds: string[], shelfId: string): Promise<void>;
  removeBookFromShelf(bookId: string, shelfId: string): Promise<void>;
  getBookToc(bookId: string): Promise<TocItem[]>;
  loadChapter(bookId: string, spineIndex: number, themeCss: string): Promise<ChapterContent>;
  searchBook(bookId: string, query: string): Promise<BookSearchMatch[]>;
  getBookPageMap(bookId: string): Promise<number[]>;
  listBookmarks(bookId: string): Promise<BookmarkDto[]>;
  createBookmark(input: CreateBookmarkInput): Promise<BookmarkDto>;
  deleteBookmark(bookmarkId: string): Promise<void>;
  listAnnotations(bookId?: string, search?: string): Promise<AnnotationDto[]>;
  createAnnotation(input: CreateAnnotationInput): Promise<AnnotationDto>;
  updateAnnotation(
    annotationId: string,
    noteText: string,
    color: string,
    highlightStyle?: string,
  ): Promise<void>;
  deleteAnnotation(annotationId: string): Promise<void>;
  exportNotesMarkdown(bookId: string | null, destPath: string): Promise<number>;
  exportNotesJson(bookId: string | null, destPath: string): Promise<number>;
  exportLibraryBackup(destPath: string): Promise<void>;
  importLibraryBackup(srcPath: string): Promise<RestoreBackupResult>;
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<AppSettings>;
  hasGeminiApiKey(): Promise<boolean>;
  setGeminiApiKey(apiKey: string): Promise<void>;
  deleteGeminiApiKey(): Promise<void>;
  getTtsStatuses(): Promise<TtsProviderStatus[]>;
  splitTtsChunks(text: string, maxChars?: number): Promise<TextChunk[]>;
  synthesizeTtsChunk(text: string, rate?: number): Promise<TtsSynthesisResponse>;
  listOllamaModels(baseUrl?: string): Promise<string[]>;
  getTtsCacheStats(): Promise<TtsCacheStats>;
  clearTtsCache(): Promise<number>;
  assistSelectedText(request: TextAssistRequest): Promise<TextAssistResponse>;
  openExternalUrl(url: string): Promise<void>;
  pickEpubFiles(): Promise<string[] | null>;
  pickFolder(): Promise<string | null>;
  pickSavePath(
    defaultName: string,
    filterName: string,
    extensions: string[],
  ): Promise<string | null>;
  pickOpenJsonPath(): Promise<string | null>;
}

export const tauriApi: ApiBridge = {
  getVersionInfo: () => invoke("get_app_version_info_cmd"),
  checkForUpdates: (explicitUserRequest) =>
    invoke("check_for_updates_cmd", { explicitUserRequest }),
  downloadAndApplyUpdate: (downloadUrl, fileName, expectedSha256, userConfirmed) =>
    invoke("download_and_apply_update_cmd", {
      downloadUrl,
      fileName,
      expectedSha256,
      userConfirmed,
    }),
  importEpubFiles: (paths) => invoke("import_epub_files", { paths }),
  importEpubFolder: (folderPath) => invoke("import_epub_folder", { folderPath }),
  listBooks: (filter) => invoke("list_books", { filter: filter ?? null }),
  updateBookMetadata: (bookId, update) => invoke("update_book_metadata", { bookId, update }),
  updateReadingProgress: (
    bookId,
    spineIndex,
    scrollOffset,
    progressPercent,
    readingStatus,
    lastPageIndex,
    lastCharOffset,
  ) =>
    invoke("update_reading_progress", {
      bookId,
      spineIndex,
      scrollOffset,
      progressPercent,
      readingStatus: readingStatus ?? null,
      lastPageIndex: lastPageIndex ?? null,
      lastCharOffset: lastCharOffset ?? null,
    }),
  updateTtsProgress: (bookId, ttsSpineIndex, ttsCharOffset, ttsPageNumber, ttsSnippet) =>
    invoke("update_tts_progress", {
      bookId,
      ttsSpineIndex,
      ttsCharOffset,
      ttsPageNumber,
      ttsSnippet,
    }),
  deleteBooks: (bookIds) => invoke("delete_books", { bookIds }),
  listAllTags: () => invoke("list_all_tags"),
  setBookTags: (bookId, tags) => invoke("set_book_tags", { bookId, tags }),
  bulkAddTags: (bookIds, tags) => invoke("bulk_add_tags", { bookIds, tags }),
  bulkSetReadingStatus: (bookIds, status) => invoke("bulk_set_reading_status", { bookIds, status }),
  listShelves: () => invoke("list_shelves"),
  createShelf: (name) => invoke("create_shelf", { name }),
  renameShelf: (shelfId, newName) => invoke("rename_shelf", { shelfId, newName }),
  deleteShelf: (shelfId) => invoke("delete_shelf", { shelfId }),
  assignBooksToShelf: (bookIds, shelfId) => invoke("assign_books_to_shelf", { bookIds, shelfId }),
  removeBookFromShelf: (bookId, shelfId) => invoke("remove_book_from_shelf", { bookId, shelfId }),
  getBookToc: (bookId) => invoke("get_book_toc", { bookId }),
  loadChapter: (bookId, spineIndex, themeCss) =>
    invoke("load_chapter", { bookId, spineIndex, themeCss }),
  searchBook: (bookId, query) => invoke("search_book", { bookId, query }),
  getBookPageMap: (bookId) => invoke("get_book_page_map", { bookId }),
  listBookmarks: (bookId) => invoke("list_bookmarks", { bookId }),
  createBookmark: (input) => invoke("create_bookmark", { input }),
  deleteBookmark: (bookmarkId) => invoke("delete_bookmark", { bookmarkId }),
  listAnnotations: (bookId, search) =>
    invoke("list_annotations", { bookId: bookId ?? null, search: search ?? null }),
  createAnnotation: (input) => invoke("create_annotation", { input }),
  updateAnnotation: (annotationId, noteText, color, highlightStyle) =>
    invoke("update_annotation", {
      annotationId,
      noteText,
      color,
      highlightStyle: highlightStyle ?? null,
    }),
  deleteAnnotation: (annotationId) => invoke("delete_annotation", { annotationId }),
  exportNotesMarkdown: (bookId, destPath) =>
    invoke("export_notes_markdown_cmd", { bookId, destPath }),
  exportNotesJson: (bookId, destPath) => invoke("export_notes_json_cmd", { bookId, destPath }),
  exportLibraryBackup: (destPath) => invoke("export_library_backup_cmd", { destPath }),
  importLibraryBackup: (srcPath) => invoke("import_library_backup_cmd", { srcPath }),
  getSettings: () => invoke("get_settings"),
  saveSettings: (settings) => invoke("save_settings_cmd", { settings }),
  hasGeminiApiKey: () => invoke("has_gemini_api_key_cmd"),
  setGeminiApiKey: (apiKey) => invoke("set_gemini_api_key_cmd", { apiKey }),
  deleteGeminiApiKey: () => invoke("delete_gemini_api_key_cmd"),
  getTtsStatuses: () => invoke("get_tts_statuses"),
  splitTtsChunks: (text, maxChars) =>
    invoke("split_tts_chunks", { text, maxChars: maxChars ?? null }),
  synthesizeTtsChunk: (text, rate) => invoke("synthesize_tts_chunk", { text, rate: rate ?? null }),
  listOllamaModels: (baseUrl) => invoke("list_ollama_models_cmd", { baseUrl: baseUrl ?? null }),
  getTtsCacheStats: () => invoke("get_tts_cache_stats"),
  clearTtsCache: () => invoke("clear_tts_cache"),
  assistSelectedText: (request) => invoke("assist_selected_text_cmd", { request }),
  openExternalUrl: (url) => invoke("open_external_url_cmd", { url }),
  pickEpubFiles: async () => {
    const selected = await dialogOpen({
      multiple: true,
      filters: [{ name: "E-Kitap / Belge", extensions: ["epub", "pdf", "docx", "doc"] }],
    });
    if (!selected) return null;
    return Array.isArray(selected) ? selected : [selected];
  },
  pickFolder: async () => {
    const selected = await dialogOpen({ directory: true, multiple: false });
    return typeof selected === "string" ? selected : null;
  },
  pickSavePath: async (defaultName, filterName, extensions) => {
    const selected = await dialogSave({
      defaultPath: defaultName,
      filters: [{ name: filterName, extensions }],
    });
    return selected ?? null;
  },
  pickOpenJsonPath: async () => {
    const selected = await dialogOpen({
      multiple: false,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    return typeof selected === "string" ? selected : null;
  },
};

export function createBrowserPreviewBridge(): ApiBridge {
  let settings: AppSettings = {
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

  let geminiKeySaved = false;
  let shelves: ShelfDto[] = [
    {
      id: "shelf-demo-1",
      name: "Okuma Listem",
      sortOrder: 1,
      bookCount: 1,
      createdAt: "2026-11-24T12:00:00Z",
    },
  ];
  let books: BookDto[] = [
    {
      id: "demo-book-1",
      title: "Anadolu Masalları (Örnek EPUB)",
      author: "ESSVB Örnek Yazar",
      language: "tr",
      publisher: "Açık Kültür",
      description: "Güvenli sandbox ve Türkçe sesli okuma doğrulama kitabı.",
      series: "Klasikler",
      genre: "Edebiyat",
      readingStatus: "reading",
      progressPercent: 25,
      lastSpineIndex: 0,
      lastScrollOffset: 0,
      lastPageIndex: 0,
      lastCharOffset: 0,
      ttsSpineIndex: 0,
      ttsCharOffset: 0,
      ttsPageNumber: 1,
      ttsSnippet: "",
      spineCount: 2,
      epubVersion: "3.0",
      fileHash: "demo-hash-1",
      coverDataUrl: null,
      shelfIds: ["shelf-demo-1"],
      tags: ["türkçe", "örnek"],
      addedAt: "2026-11-24T12:00:00Z",
      updatedAt: "2026-11-24T12:00:00Z",
      lastOpenedAt: "2026-11-24T12:00:00Z",
    },
  ];
  let annotations: AnnotationDto[] = [];
  let bookmarks: BookmarkDto[] = [];

  const chapters: { title: string; bodyHtml: string; plainText: string }[] = [
    {
      title: "Birinci Bölüm: Başlangıç",
      bodyHtml:
        "<h1>Birinci Bölüm: Başlangıç</h1><p>İstanbul sabahında vapurlar Boğaz sularını yararken okurlar sessizce sayfalarını çeviriyordu. Bu cümle yerel Türkçe sesli okuma testi için hazırlanmıştır.</p><p>İkinci paragraf vurgulama ve not alma denemeleri için temiz HTML içeriği sunar.</p>",
      plainText:
        "Birinci Bölüm: Başlangıç\nİstanbul sabahında vapurlar Boğaz sularını yararken okurlar sessizce sayfalarını çeviriyordu. Bu cümle yerel Türkçe sesli okuma testi için hazırlanmıştır.\nİkinci paragraf vurgulama ve not alma denemeleri için temiz HTML içeriği sunar.",
    },
    {
      title: "İkinci Bölüm: Sandbox Testi",
      bodyHtml:
        "<h1>İkinci Bölüm: Sandbox Testi</h1><p>EPUB içindeki tüm zararlı script ve dış kaynaklar ayrıştırıcı ve iframe sandbox ile engellenir.</p>",
      plainText:
        "İkinci Bölüm: Sandbox Testi\nEPUB içindeki tüm zararlı script ve dış kaynaklar ayrıştırıcı ve iframe sandbox ile engellenir.",
    },
  ];

  const recountShelves = () => {
    shelves = shelves.map((s) => ({
      ...s,
      bookCount: books.filter((b) => b.shelfIds.includes(s.id)).length,
    }));
  };

  return {
    getVersionInfo: async () => ({
      version: "0.2.0",
      stageTr: "Hazırlık Aşaması (Ön Sürüm)",
      stageEn: "Development Preview (Pre-release)",
      isPortable: false,
      license: "MIT",
    }),
    checkForUpdates: async (explicit) => {
      if (!explicit && !settings.autoUpdateEnabled) {
        throw new Error("NETWORK_DISABLED: Açık kullanıcı onayı gerekli");
      }
      return {
        currentVersion: "0.2.0",
        latestVersion: "0.2.0",
        updateAvailable: false,
        releaseNotes: "",
        releasePageUrl: "https://github.com/ibrahimsaglammm/ESSVB-Reader/releases",
        downloadUrl: "",
        recommendedAsset: null,
        assets: [],
        checkedAt: new Date().toISOString(),
      };
    },
    downloadAndApplyUpdate: async (_downloadUrl, fileName, _expectedSha256, userConfirmed) => {
      if (!userConfirmed) {
        throw new Error("NETWORK_DISABLED: Kullanıcı onayı gerekli");
      }
      return {
        filePath: `/mock/updates/${fileName}`,
        fileName,
        sha256: "0".repeat(64),
        launched: false,
        actionHintTr: `Mock indirme tamamlandı: ${fileName}`,
        actionHintEn: `Mock download completed: ${fileName}`,
      };
    },
    importEpubFiles: async (paths) => ({
      imported: [],
      skippedDuplicates: [],
      failed: paths,
    }),
    importEpubFolder: async () => ({ imported: [], skippedDuplicates: [], failed: [] }),
    listBooks: async (filter) => {
      return books.filter((b) => {
        if (filter?.shelfId && !b.shelfIds.includes(filter.shelfId)) return false;
        if (filter?.readingStatus && b.readingStatus !== filter.readingStatus) return false;
        if (filter?.tag && !b.tags.includes(filter.tag)) return false;
        if (filter?.genre && !b.genre.toLowerCase().includes(filter.genre.toLowerCase())) {
          return false;
        }
        if (filter?.author && !b.author.toLowerCase().includes(filter.author.toLowerCase())) {
          return false;
        }
        if (filter?.series && !b.series.toLowerCase().includes(filter.series.toLowerCase())) {
          return false;
        }
        if (filter?.search) {
          const q = filter.search.toLowerCase();
          const hit =
            b.title.toLowerCase().includes(q) ||
            b.author.toLowerCase().includes(q) ||
            b.series.toLowerCase().includes(q) ||
            b.tags.some((t) => t.toLowerCase().includes(q));
          if (!hit) return false;
        }
        return true;
      });
    },
    updateBookMetadata: async (bookId, update) => {
      books = books.map((b) => (b.id === bookId ? { ...b, ...update } : b));
      const found = books.find((b) => b.id === bookId);
      if (!found) throw new Error("Kitap bulunamadı");
      return found;
    },
    updateReadingProgress: async (
      bookId,
      spineIndex,
      scrollOffset,
      progressPercent,
      status,
      lastPageIndex,
      lastCharOffset,
    ) => {
      books = books.map((b) =>
        b.id === bookId
          ? {
              ...b,
              lastSpineIndex: spineIndex,
              lastScrollOffset: scrollOffset,
              lastPageIndex: lastPageIndex ?? b.lastPageIndex,
              lastCharOffset: lastCharOffset ?? b.lastCharOffset,
              progressPercent,
              readingStatus: (status as BookDto["readingStatus"]) ?? b.readingStatus,
            }
          : b,
      );
    },
    updateTtsProgress: async (bookId, ttsSpineIndex, ttsCharOffset, ttsPageNumber, ttsSnippet) => {
      books = books.map((b) =>
        b.id === bookId
          ? {
              ...b,
              ttsSpineIndex,
              ttsCharOffset,
              ttsPageNumber,
              ttsSnippet,
            }
          : b,
      );
    },
    deleteBooks: async (bookIds) => {
      const prev = books.length;
      books = books.filter((b) => !bookIds.includes(b.id));
      recountShelves();
      return prev - books.length;
    },
    listAllTags: async () => Array.from(new Set(books.flatMap((b) => b.tags))).sort(),
    setBookTags: async (bookId, tags) => {
      books = books.map((b) => (b.id === bookId ? { ...b, tags } : b));
    },
    bulkAddTags: async (bookIds, tags) => {
      books = books.map((b) =>
        bookIds.includes(b.id) ? { ...b, tags: Array.from(new Set([...b.tags, ...tags])) } : b,
      );
    },
    bulkSetReadingStatus: async (bookIds, status) => {
      books = books.map((b) =>
        bookIds.includes(b.id) ? { ...b, readingStatus: status as BookDto["readingStatus"] } : b,
      );
    },
    listShelves: async () => shelves,
    createShelf: async (name) => {
      const created: ShelfDto = {
        id: `shelf-${Date.now()}`,
        name: name.trim(),
        sortOrder: shelves.length + 1,
        bookCount: 0,
        createdAt: new Date().toISOString(),
      };
      shelves = [...shelves, created];
      return created;
    },
    renameShelf: async (shelfId, newName) => {
      shelves = shelves.map((s) => (s.id === shelfId ? { ...s, name: newName.trim() } : s));
    },
    deleteShelf: async (shelfId) => {
      shelves = shelves.filter((s) => s.id !== shelfId);
      books = books.map((b) => ({
        ...b,
        shelfIds: b.shelfIds.filter((id) => id !== shelfId),
      }));
    },
    assignBooksToShelf: async (bookIds, shelfId) => {
      books = books.map((b) =>
        bookIds.includes(b.id) && !b.shelfIds.includes(shelfId)
          ? { ...b, shelfIds: [...b.shelfIds, shelfId] }
          : b,
      );
      recountShelves();
    },
    removeBookFromShelf: async (bookId, shelfId) => {
      books = books.map((b) =>
        b.id === bookId ? { ...b, shelfIds: b.shelfIds.filter((s) => s !== shelfId) } : b,
      );
      recountShelves();
    },
    getBookToc: async () =>
      chapters.map((c, idx) => ({
        id: `toc-${idx}`,
        title: c.title,
        href: `ch${idx}.xhtml`,
        spineIndex: idx,
        depth: 0,
      })),
    loadChapter: async (_bookId, spineIndex, themeCss) => {
      const ch = chapters[spineIndex] ?? chapters[0]!;
      const css = themeCss || buildReaderIframeCss(settings, false);
      const srcDoc = `<!doctype html><html lang="tr"><head><meta charset="utf-8" /><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; script-src 'none'; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none';" /><style id="essvb-theme-style">${css}</style></head><body>${ch.bodyHtml}</body></html>`;
      return {
        spineIndex,
        chapterCount: chapters.length,
        title: ch.title,
        srcDoc,
        bodyHtml: ch.bodyHtml,
        plainText: ch.plainText,
      };
    },
    searchBook: async (_bookId, query) => {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      const hits: BookSearchMatch[] = [];
      chapters.forEach((c, idx) => {
        const pos = c.plainText.toLowerCase().indexOf(q);
        if (pos >= 0) {
          hits.push({
            spineIndex: idx,
            chapterTitle: c.title,
            snippet: c.plainText.slice(Math.max(0, pos - 20), pos + 60),
            matchOffset: pos,
          });
        }
      });
      return hits;
    },
    getBookPageMap: async () => chapters.map((c) => Math.max(1, c.plainText.length)),
    listBookmarks: async (bookId) => bookmarks.filter((bm) => bm.bookId === bookId),
    createBookmark: async (input) => {
      const created: BookmarkDto = {
        id: `bm-${Date.now()}`,
        bookId: input.bookId,
        spineIndex: input.spineIndex,
        pageIndex: input.pageIndex,
        charOffset: input.charOffset,
        pageLabel: input.pageLabel,
        label: input.label,
        createdAt: new Date().toISOString(),
      };
      bookmarks = [created, ...bookmarks];
      return created;
    },
    deleteBookmark: async (bookmarkId) => {
      bookmarks = bookmarks.filter((bm) => bm.id !== bookmarkId);
    },
    listAnnotations: async (bookId, search) =>
      annotations.filter((a) => {
        if (bookId && a.bookId !== bookId) return false;
        if (search) {
          const q = search.toLowerCase();
          return a.quoteText.toLowerCase().includes(q) || a.noteText.toLowerCase().includes(q);
        }
        return true;
      }),
    createAnnotation: async (input) => {
      const book = books.find((b) => b.id === input.bookId);
      const created: AnnotationDto = {
        id: `note-${Date.now()}`,
        bookId: input.bookId,
        bookTitle: book?.title ?? "Kitap",
        spineIndex: input.spineIndex,
        chapterTitle: input.chapterTitle,
        quoteText: input.quoteText,
        noteText: input.noteText,
        color: input.color,
        highlightStyle: input.highlightStyle ?? "solid",
        startOffset: input.startOffset,
        endOffset: input.endOffset,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      annotations = [created, ...annotations];
      return created;
    },
    updateAnnotation: async (id, noteText, color, highlightStyle) => {
      annotations = annotations.map((a) =>
        a.id === id
          ? {
              ...a,
              noteText,
              color: color as AnnotationDto["color"],
              highlightStyle:
                (highlightStyle as AnnotationDto["highlightStyle"] | undefined) ?? a.highlightStyle,
              updatedAt: new Date().toISOString(),
            }
          : a,
      );
    },
    deleteAnnotation: async (id) => {
      annotations = annotations.filter((a) => a.id !== id);
    },
    exportNotesMarkdown: async () => annotations.length,
    exportNotesJson: async () => annotations.length,
    exportLibraryBackup: async () => {},
    importLibraryBackup: async () => ({
      shelvesRestored: 0,
      booksUpdated: 0,
      annotationsRestored: 0,
    }),
    getSettings: async () => settings,
    saveSettings: async (next) => {
      settings = next;
      return settings;
    },
    hasGeminiApiKey: async () => geminiKeySaved,
    setGeminiApiKey: async () => {
      geminiKeySaved = true;
    },
    deleteGeminiApiKey: async () => {
      geminiKeySaved = false;
    },
    getTtsStatuses: async () => [
      {
        providerId: "local",
        available: true,
        voiceName: "Microsoft Tolga (tr-TR)",
        details: "Çevrimdışı hazır",
        setupHintTr: "",
        setupHintEn: "",
      },
      {
        providerId: "ollama",
        available: false,
        voiceName: "",
        details: "Localhost Ollama bekleniyor",
        setupHintTr: "http://127.0.0.1:11434 üzerinde Ollama çalıştırın",
        setupHintEn: "Run Ollama on http://127.0.0.1:11434",
      },
      {
        providerId: "gemini",
        available: settings.geminiTtsEnabled && geminiKeySaved,
        voiceName: "Gemini Kore",
        details: settings.geminiTtsEnabled ? "Etkin" : "Kapalı",
        setupHintTr: "",
        setupHintEn: "",
      },
    ],
    splitTtsChunks: async (text) => {
      const parts = text
        .split(/(?<=[.!?])\s+/)
        .map((p) => p.trim())
        .filter(Boolean);
      let cursor = 0;
      return parts.map((p, i) => {
        const start = text.indexOf(p, cursor);
        const s = start >= 0 ? start : cursor;
        const e = s + p.length;
        cursor = e;
        return { index: i, text: p, startOffset: s, endOffset: e };
      });
    },
    synthesizeTtsChunk: async (text) => {
      if (settings.ttsProvider === "gemini" && !settings.geminiTtsEnabled) {
        throw new Error("Gemini TTS gizlilik politikası gereği kapalı.");
      }
      // Minimal valid silent 44-byte WAV for browser preview test
      const silentWavB64 = "UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAABErAAABAAgAZGF0YQAAAAA=";
      return {
        audioBase64: silentWavB64,
        mimeType: "audio/wav",
        providerId: settings.ttsProvider,
        voiceName: "Microsoft Tolga (Preview)",
        fromCache: false,
        preparedText: text,
      };
    },
    listOllamaModels: async () => [],
    getTtsCacheStats: async () => ({
      fileCount: 0,
      totalBytes: 0,
      maxBytes: settings.ttsCacheMaxMb * 1024 * 1024,
    }),
    clearTtsCache: async () => 0,
    assistSelectedText: async (request) => {
      if (request.mode === "translate") {
        return {
          providerUsed: "preview",
          model: "local-preview",
          result: `[Önizleme Çeviri (${request.targetLang ?? "tr"})] ${request.text}`,
        };
      }
      if (request.mode === "dictionary") {
        return {
          providerUsed: "preview",
          model: "local-preview",
          result: `"${request.text}" ifadesi seçili bağlamda temel kavram veya terimi ifade eder.`,
        };
      }
      return {
        providerUsed: "preview",
        model: "local-preview",
        result: `Seçili pasaj özeti (${request.text.slice(0, 60)}...): Ana fikir metnin merkezindeki konuyu vurgular.`,
      };
    },
    openExternalUrl: async (url) => {
      if (typeof window !== "undefined" && url.startsWith("https://")) {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    },
    pickEpubFiles: async () => null,
    pickFolder: async () => null,
    pickSavePath: async () => null,
    pickOpenJsonPath: async () => null,
  };
}

let activeBridge: ApiBridge | null = null;

export function getApiBridge(): ApiBridge {
  if (!activeBridge) {
    activeBridge = isTauriRuntime() ? tauriApi : createBrowserPreviewBridge();
  }
  return activeBridge;
}

export function setApiBridgeForTests(mock: ApiBridge | null): void {
  activeBridge = mock;
}
