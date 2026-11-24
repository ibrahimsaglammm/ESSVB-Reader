export type ReadingStatus = "to_read" | "reading" | "finished";
export type HighlightColor = "yellow" | "green" | "blue" | "pink" | "purple";
export type HighlightStyle = "solid" | "underline" | "strikethrough" | "wavy";
export type TextAssistMode = "translate" | "dictionary" | "ask";
export type ThemePreset = "light" | "dark" | "sepia" | "high-contrast" | "custom";
export type FontFamily = "serif" | "sans" | "mono";
export type TextAlign = "left" | "justify";
export type TtsProviderId = "local" | "ollama" | "gemini";
export type AppLanguage = "tr" | "en";

export interface AppVersionInfo {
  version: string;
  stageTr: string;
  stageEn: string;
  isPortable: boolean;
  license: string;
}

export interface UpdateAssetInfo {
  name: string;
  downloadUrl: string;
  sizeBytes: number;
  sha256: string | null;
  platformTag: string;
}

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseNotes: string;
  releasePageUrl: string;
  downloadUrl: string;
  recommendedAsset: UpdateAssetInfo | null;
  assets: UpdateAssetInfo[];
  checkedAt: string;
}

export interface UpdateApplyResult {
  filePath: string;
  fileName: string;
  sha256: string;
  launched: boolean;
  actionHintTr: string;
  actionHintEn: string;
}

export interface ShelfDto {
  id: string;
  name: string;
  sortOrder: number;
  bookCount: number;
  createdAt: string;
}

export interface BookDto {
  id: string;
  title: string;
  author: string;
  language: string;
  publisher: string;
  description: string;
  series: string;
  genre: string;
  readingStatus: ReadingStatus;
  progressPercent: number;
  lastSpineIndex: number;
  lastScrollOffset: number;
  spineCount: number;
  epubVersion: string;
  fileHash: string;
  coverDataUrl: string | null;
  shelfIds: string[];
  tags: string[];
  addedAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
}

export interface BookMetadataUpdate {
  title: string;
  author: string;
  language: string;
  publisher: string;
  description: string;
  series: string;
  genre: string;
  readingStatus: ReadingStatus;
}

export interface BookFilterQuery {
  search?: string;
  shelfId?: string;
  tag?: string;
  genre?: string;
  author?: string;
  series?: string;
  readingStatus?: string;
  sortBy?: "addedAt" | "title" | "author" | "series" | "progress" | "lastOpened";
  sortDir?: "asc" | "desc";
}

export interface ImportSummary {
  imported: BookDto[];
  skippedDuplicates: string[];
  failed: string[];
}

export interface TocItem {
  id: string;
  title: string;
  href: string;
  spineIndex: number | null;
  depth: number;
}

export interface ChapterContent {
  spineIndex: number;
  chapterCount: number;
  title: string;
  srcDoc: string;
  bodyHtml: string;
  plainText: string;
}

export interface BookSearchMatch {
  spineIndex: number;
  chapterTitle: string;
  snippet: string;
  matchOffset: number;
}

export interface AnnotationDto {
  id: string;
  bookId: string;
  bookTitle: string;
  spineIndex: number;
  chapterTitle: string;
  quoteText: string;
  noteText: string;
  color: HighlightColor;
  highlightStyle: HighlightStyle;
  startOffset: number;
  endOffset: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAnnotationInput {
  bookId: string;
  spineIndex: number;
  chapterTitle: string;
  quoteText: string;
  noteText: string;
  color: HighlightColor;
  highlightStyle?: HighlightStyle;
  startOffset: number;
  endOffset: number;
}

export interface TextAssistRequest {
  mode: TextAssistMode;
  text: string;
  targetLang?: string;
  userPrompt?: string;
  provider?: "ollama" | "gemini";
  cloudConfirmed: boolean;
}

export interface TextAssistResponse {
  providerUsed: string;
  model: string;
  result: string;
}

export interface RestoreBackupResult {
  shelvesRestored: number;
  booksUpdated: number;
  annotationsRestored: number;
}

export interface CustomThemeColors {
  background: string;
  text: string;
  surface: string;
  accent: string;
}

export interface AppSettings {
  language: AppLanguage;
  themePreset: ThemePreset;
  followSystemTheme: boolean;
  customTheme: CustomThemeColors;
  fontFamily: FontFamily;
  fontSizePx: number;
  lineHeight: number;
  marginPx: number;
  textAlign: TextAlign;
  showCoverThumbnails: boolean;
  ttsProvider: TtsProviderId;
  ttsRate: number;
  ttsCacheMaxMb: number;
  linuxPiperModelPath: string;
  ollamaUrl: string;
  ollamaModel: string;
  geminiTtsEnabled: boolean;
  geminiModel: string;
  geminiVoice: string;
  geminiConfirmBeforeSend: boolean;
  askUpdateOnStartup: boolean;
  autoUpdateEnabled: boolean;
  updateCheckIntervalMinutes: number;
  updateManifestUrl: string;
}

export interface TtsProviderStatus {
  providerId: TtsProviderId;
  available: boolean;
  voiceName: string;
  details: string;
  setupHintTr: string;
  setupHintEn: string;
}

export interface TextChunk {
  index: number;
  text: string;
  startOffset: number;
  endOffset: number;
}

export interface TtsSynthesisResponse {
  audioBase64: string;
  mimeType: string;
  providerId: TtsProviderId;
  voiceName: string;
  fromCache: boolean;
  preparedText: string;
}

export interface TtsCacheStats {
  fileCount: number;
  totalBytes: number;
  maxBytes: number;
}
