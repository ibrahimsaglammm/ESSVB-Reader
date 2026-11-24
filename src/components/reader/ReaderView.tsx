import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  BookMarked,
  ChevronLeft,
  ChevronRight,
  List,
  Pause,
  Play,
  Search,
  Square,
  Type,
  Volume2,
  SkipBack,
  SkipForward,
  Trash2,
} from "lucide-react";
import { translate } from "../../i18n";
import { useAppStore } from "../../store/useAppStore";
import type { AnnotationDto, FontFamily, HighlightColor, TextAlign } from "../../types/models";

const HIGHLIGHT_CSS_MAP: Record<HighlightColor, string> = {
  yellow: "rgba(253, 224, 71, 0.55)",
  green: "rgba(134, 239, 172, 0.55)",
  blue: "rgba(147, 197, 253, 0.55)",
  pink: "rgba(249, 168, 212, 0.55)",
  purple: "rgba(216, 180, 254, 0.55)",
};

interface SelectionInfo {
  text: string;
  startOffset: number;
  endOffset: number;
}

type SidePanel = "none" | "toc" | "search" | "notes" | "typography";

function computeDomTextOffsets(doc: Document, range: Range): { start: number; end: number } {
  const pre = doc.createRange();
  pre.selectNodeContents(doc.body);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  const end = start + range.toString().length;
  return { start, end };
}

function wrapTextRangeInDoc(
  doc: Document,
  startOffset: number,
  endOffset: number,
  className: string,
  backgroundColor?: string,
  annId?: string,
): HTMLElement | null {
  if (!doc.body || endOffset <= startOffset) return null;
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let pos = 0;
  let startNode: Text | null = null;
  let startLocal = 0;
  let endNode: Text | null = null;
  let endLocal = 0;

  let current = walker.nextNode();
  while (current) {
    const textNode = current as Text;
    const len = textNode.data.length;
    if (!startNode && pos + len > startOffset) {
      startNode = textNode;
      startLocal = Math.max(0, startOffset - pos);
    }
    if (startNode && pos + len >= endOffset) {
      endNode = textNode;
      endLocal = Math.max(0, endOffset - pos);
      break;
    }
    pos += len;
    current = walker.nextNode();
  }

  if (!startNode || !endNode) return null;
  try {
    const range = doc.createRange();
    range.setStart(startNode, startLocal);
    range.setEnd(endNode, endLocal);
    const mark = doc.createElement("mark");
    mark.className = className;
    if (backgroundColor) {
      mark.style.backgroundColor = backgroundColor;
    }
    if (annId) {
      mark.dataset.annId = annId;
    }
    const extracted = range.extractContents();
    mark.appendChild(extracted);
    range.insertNode(mark);
    return mark;
  } catch {
    return null;
  }
}

export function ReaderView() {
  const settings = useAppStore((s) => s.settings);
  const activeBook = useAppStore((s) => s.activeBook);
  const toc = useAppStore((s) => s.toc);
  const currentChapter = useAppStore((s) => s.currentChapter);
  const bookSearchResults = useAppStore((s) => s.bookSearchResults);
  const bookAnnotations = useAppStore((s) => s.bookAnnotations);
  const ttsState = useAppStore((s) => s.ttsState);
  const ttsChunks = useAppStore((s) => s.ttsChunks);
  const ttsChunkIndex = useAppStore((s) => s.ttsChunkIndex);
  const ttsActiveChunk = useAppStore((s) => s.ttsActiveChunk);
  const ttsActiveVoice = useAppStore((s) => s.ttsActiveVoice);
  const ttsError = useAppStore((s) => s.ttsError);
  const ttsPendingConsentText = useAppStore((s) => s.ttsPendingConsentText);

  const setActiveView = useAppStore((s) => s.setActiveView);
  const loadChapterIndex = useAppStore((s) => s.loadChapterIndex);
  const saveReaderProgress = useAppStore((s) => s.saveReaderProgress);
  const searchInBook = useAppStore((s) => s.searchInBook);
  const createAnnotation = useAppStore((s) => s.createAnnotation);
  const deleteAnnotation = useAppStore((s) => s.deleteAnnotation);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const speakText = useAppStore((s) => s.speakText);
  const confirmGeminiSpeak = useAppStore((s) => s.confirmGeminiSpeak);
  const cancelGeminiSpeak = useAppStore((s) => s.cancelGeminiSpeak);
  const pauseTts = useAppStore((s) => s.pauseTts);
  const resumeTts = useAppStore((s) => s.resumeTts);
  const stopTts = useAppStore((s) => s.stopTts);
  const prevTtsChunk = useAppStore((s) => s.prevTtsChunk);
  const nextTtsChunk = useAppStore((s) => s.nextTtsChunk);

  const lang = settings.language;
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const scrollTimerRef = useRef<number | null>(null);
  const restoredForBookRef = useRef<string | null>(null);

  const [panel, setPanel] = useState<SidePanel>("none");
  const [searchQuery, setSearchQuery] = useState("");
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [noteMode, setNoteMode] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [selectedColor, setSelectedColor] = useState<HighlightColor>("yellow");

  const applyAnnotationsToIframe = useCallback(
    (doc: Document, annotations: AnnotationDto[], spineIdx: number) => {
      doc.querySelectorAll("mark.essvb-highlight").forEach((el) => {
        const parent = el.parentNode;
        if (!parent) return;
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        parent.removeChild(el);
        parent.normalize();
      });

      const chapterNotes = annotations.filter((a) => a.spineIndex === spineIdx);
      for (const ann of chapterNotes) {
        let marked = wrapTextRangeInDoc(
          doc,
          ann.startOffset,
          ann.endOffset,
          "essvb-highlight",
          HIGHLIGHT_CSS_MAP[ann.color] ?? HIGHLIGHT_CSS_MAP.yellow,
          ann.id,
        );
        if (!marked && doc.body?.textContent) {
          const idx = doc.body.textContent.indexOf(ann.quoteText);
          if (idx >= 0) {
            marked = wrapTextRangeInDoc(
              doc,
              idx,
              idx + ann.quoteText.length,
              "essvb-highlight",
              HIGHLIGHT_CSS_MAP[ann.color] ?? HIGHLIGHT_CSS_MAP.yellow,
              ann.id,
            );
          }
        }
        void marked;
      }
    },
    [],
  );

  // Sync active TTS sentence highlight inside the sandboxed chapter iframe
  useEffect(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc || !doc.body) return;

    doc.querySelectorAll("mark.essvb-tts-active").forEach((el) => {
      const parent = el.parentNode;
      if (!parent) return;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
      parent.normalize();
    });

    if (ttsActiveChunk && ttsActiveChunk.text.trim().length > 0) {
      const bodyTxt = doc.body.textContent ?? "";
      const foundIdx = bodyTxt.indexOf(ttsActiveChunk.text);
      if (foundIdx >= 0) {
        const mark = wrapTextRangeInDoc(
          doc,
          foundIdx,
          foundIdx + ttsActiveChunk.text.length,
          "essvb-tts-active",
        );
        mark?.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }
  }, [ttsActiveChunk]);

  const handleIframeLoad = useCallback(() => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!iframe || !doc || !doc.body || !currentChapter || !activeBook) return;

    applyAnnotationsToIframe(doc, bookAnnotations, currentChapter.spineIndex);

    // Restore scroll offset once when opening the book
    const restoreKey = `${activeBook.id}:${currentChapter.spineIndex}`;
    if (
      restoredForBookRef.current !== restoreKey &&
      activeBook.lastSpineIndex === currentChapter.spineIndex &&
      activeBook.lastScrollOffset > 0
    ) {
      restoredForBookRef.current = restoreKey;
      const maxScroll = Math.max(0, doc.documentElement.scrollHeight - iframe.clientHeight);
      doc.defaultView?.scrollTo(0, maxScroll * activeBook.lastScrollOffset);
    }

    const updateSelectionFromDoc = () => {
      const sel = doc.getSelection();
      if (!sel || sel.isCollapsed) {
        setSelection(null);
        setNoteMode(false);
        return;
      }
      const txt = sel.toString().trim();
      if (!txt) {
        setSelection(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const { start, end } = computeDomTextOffsets(doc, range);
      setSelection({ text: txt, startOffset: start, endOffset: end });
    };

    const handleScroll = () => {
      if (scrollTimerRef.current) {
        window.clearTimeout(scrollTimerRef.current);
      }
      scrollTimerRef.current = window.setTimeout(() => {
        const maxScroll = Math.max(1, doc.documentElement.scrollHeight - iframe.clientHeight);
        const ratio = Math.min(1, Math.max(0, (doc.defaultView?.scrollY ?? 0) / maxScroll));
        void saveReaderProgress(currentChapter.spineIndex, ratio);
      }, 600);
    };

    doc.addEventListener("mouseup", updateSelectionFromDoc);
    doc.addEventListener("keyup", updateSelectionFromDoc);
    doc.defaultView?.addEventListener("scroll", handleScroll, { passive: true });
  }, [activeBook, applyAnnotationsToIframe, bookAnnotations, currentChapter, saveReaderProgress]);

  useEffect(() => {
    const doc = iframeRef.current?.contentDocument;
    if (doc && currentChapter) {
      applyAnnotationsToIframe(doc, bookAnnotations, currentChapter.spineIndex);
    }
  }, [bookAnnotations, currentChapter, applyAnnotationsToIframe]);

  if (!activeBook || !currentChapter) {
    return (
      <div className="main-body" style={{ padding: "32px" }}>
        <button type="button" onClick={() => setActiveView("library")}>
          <ArrowLeft size={16} />
          {translate(lang, "readerBackToLibrary")}
        </button>
      </div>
    );
  }

  const handleCreateHighlight = async (color: HighlightColor, withNote: boolean) => {
    if (!selection) return;
    await createAnnotation({
      bookId: activeBook.id,
      spineIndex: currentChapter.spineIndex,
      chapterTitle: currentChapter.title,
      quoteText: selection.text,
      noteText: withNote ? noteDraft.trim() : "",
      color,
      startOffset: selection.startOffset,
      endOffset: selection.endOffset,
    });
    setSelection(null);
    setNoteMode(false);
    setNoteDraft("");
    iframeRef.current?.contentDocument?.getSelection()?.removeAllRanges();
  };

  return (
    <div className="reader-shell" data-testid="reader-view">
      {/* Top Reader Controls */}
      <div className="reader-topbar">
        <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
          <button
            type="button"
            onClick={() => {
              stopTts();
              setActiveView("library");
            }}
            data-testid="back-to-library-btn"
          >
            <ArrowLeft size={15} />
            {translate(lang, "readerBackToLibrary")}
          </button>
          <span
            style={{
              fontWeight: 600,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {activeBook.title} — {currentChapter.title}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
          <button
            type="button"
            className={panel === "toc" ? "primary" : ""}
            onClick={() => setPanel(panel === "toc" ? "none" : "toc")}
          >
            <List size={15} />
            {translate(lang, "readerToc")}
          </button>
          <button
            type="button"
            className={panel === "search" ? "primary" : ""}
            onClick={() => setPanel(panel === "search" ? "none" : "search")}
          >
            <Search size={15} />
            {translate(lang, "readerSearch")}
          </button>
          <button
            type="button"
            className={panel === "notes" ? "primary" : ""}
            onClick={() => setPanel(panel === "notes" ? "none" : "notes")}
          >
            <BookMarked size={15} />
            {translate(lang, "readerNotes")} ({bookAnnotations.length})
          </button>
          <button
            type="button"
            className={panel === "typography" ? "primary" : ""}
            onClick={() => setPanel(panel === "typography" ? "none" : "typography")}
          >
            <Type size={15} />
            {translate(lang, "readerTypography")}
          </button>
          <button
            type="button"
            disabled={currentChapter.spineIndex <= 0}
            onClick={() => void loadChapterIndex(currentChapter.spineIndex - 1)}
            aria-label={translate(lang, "readerPrevChapter")}
          >
            <ChevronLeft size={15} />
          </button>
          <span style={{ fontSize: "12px", color: "var(--muted)" }}>
            {translate(lang, "readerChapterOf", {
              current: currentChapter.spineIndex + 1,
              total: currentChapter.chapterCount,
            })}
          </span>
          <button
            type="button"
            disabled={currentChapter.spineIndex + 1 >= currentChapter.chapterCount}
            onClick={() => void loadChapterIndex(currentChapter.spineIndex + 1)}
            aria-label={translate(lang, "readerNextChapter")}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>

      {/* Text Selection Action Toolbar */}
      <div
        className="selection-toolbar"
        role="toolbar"
        aria-label={translate(lang, "selectionHighlight")}
      >
        {selection ? (
          <>
            <span style={{ fontSize: "12px", color: "var(--muted)" }}>
              &ldquo;{selection.text.slice(0, 48)}
              {selection.text.length > 48 ? "..." : ""}&rdquo;
            </span>
            {(Object.keys(HIGHLIGHT_CSS_MAP) as HighlightColor[]).map((color) => (
              <button
                key={color}
                type="button"
                className="color-dot"
                style={{ backgroundColor: HIGHLIGHT_CSS_MAP[color] }}
                title={`${translate(lang, "selectionHighlight")} (${color})`}
                aria-label={`${translate(lang, "selectionHighlight")}: ${color}`}
                onClick={() => {
                  setSelectedColor(color);
                  void handleCreateHighlight(color, false);
                }}
              />
            ))}
            <button
              type="button"
              onClick={() => setNoteMode((v) => !v)}
              data-testid="selection-add-note-btn"
            >
              {translate(lang, "selectionAddNote")}
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => void speakText(selection.text)}
              data-testid="selection-speak-btn"
            >
              <Volume2 size={14} />
              {translate(lang, "selectionSpeak")}
            </button>
            {noteMode && (
              <div style={{ display: "flex", gap: "6px", width: "100%", marginTop: "4px" }}>
                <input
                  type="text"
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder={translate(lang, "notePlaceholder")}
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="primary"
                  onClick={() => void handleCreateHighlight(selectedColor, true)}
                >
                  {translate(lang, "saveNote")}
                </button>
              </div>
            )}
          </>
        ) : (
          <span style={{ fontSize: "12px", color: "var(--muted)" }}>
            {translate(lang, "readerSelectTextHint")}
          </span>
        )}
      </div>

      {/* Main Reader Workspace */}
      <div className="reader-workspace">
        {panel !== "none" && (
          <aside className="reader-sidepanel" aria-label={panel}>
            {panel === "toc" && (
              <>
                <h3 style={{ margin: 0 }}>{translate(lang, "readerToc")}</h3>
                <div className="sidebar-list">
                  {toc.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`sidebar-item ${
                        item.spineIndex === currentChapter.spineIndex ? "active" : ""
                      }`}
                      style={{ paddingLeft: `${8 + item.depth * 14}px` }}
                      onClick={() => {
                        if (item.spineIndex !== null) {
                          void loadChapterIndex(item.spineIndex);
                        }
                      }}
                    >
                      {item.title}
                    </button>
                  ))}
                </div>
              </>
            )}

            {panel === "search" && (
              <>
                <h3 style={{ margin: 0 }}>{translate(lang, "readerSearch")}</h3>
                <form
                  style={{ display: "flex", gap: "6px" }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void searchInBook(searchQuery);
                  }}
                >
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={translate(lang, "readerSearchPlaceholder")}
                    style={{ flex: 1, minWidth: 0 }}
                  />
                  <button type="submit" className="primary">
                    <Search size={14} />
                  </button>
                </form>
                <div className="sidebar-list">
                  {bookSearchResults.length === 0 ? (
                    <span style={{ color: "var(--muted)", fontSize: "12px" }}>
                      {translate(lang, "readerNoMatches")}
                    </span>
                  ) : (
                    bookSearchResults.map((hit, idx) => (
                      <button
                        key={`${hit.spineIndex}-${hit.matchOffset}-${idx}`}
                        type="button"
                        className="sidebar-item"
                        style={{ flexDirection: "column", alignItems: "flex-start", gap: "3px" }}
                        onClick={() => void loadChapterIndex(hit.spineIndex)}
                      >
                        <strong style={{ fontSize: "12px" }}>{hit.chapterTitle}</strong>
                        <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                          {hit.snippet}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </>
            )}

            {panel === "notes" && (
              <>
                <h3 style={{ margin: 0 }}>{translate(lang, "readerNotes")}</h3>
                <div className="sidebar-list">
                  {bookAnnotations.map((ann) => (
                    <div key={ann.id} className="alert-box">
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "6px" }}>
                        <strong style={{ fontSize: "12px" }}>{ann.chapterTitle}</strong>
                        <button
                          type="button"
                          className="icon-btn danger"
                          aria-label={translate(lang, "deleteShelf")}
                          onClick={() => void deleteAnnotation(ann.id)}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                      <blockquote style={{ margin: "6px 0", fontSize: "12px" }}>
                        {ann.quoteText}
                      </blockquote>
                      {ann.noteText && (
                        <p style={{ margin: "4px 0 0", fontSize: "13px" }}>{ann.noteText}</p>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}

            {panel === "typography" && (
              <>
                <h3 style={{ margin: 0 }}>{translate(lang, "readerTypography")}</h3>
                <div className="field-group">
                  <label htmlFor="typo-font">{translate(lang, "fontLabel")}</label>
                  <select
                    id="typo-font"
                    value={settings.fontFamily}
                    onChange={(e) =>
                      void updateSettings({ fontFamily: e.target.value as FontFamily })
                    }
                  >
                    <option value="serif">{translate(lang, "fontSerif")}</option>
                    <option value="sans">{translate(lang, "fontSans")}</option>
                    <option value="mono">{translate(lang, "fontMono")}</option>
                  </select>
                </div>
                <div className="field-group">
                  <label htmlFor="typo-size">
                    {translate(lang, "fontSizeLabel")}: {settings.fontSizePx}px
                  </label>
                  <input
                    id="typo-size"
                    type="range"
                    min={12}
                    max={36}
                    value={settings.fontSizePx}
                    onChange={(e) => void updateSettings({ fontSizePx: Number(e.target.value) })}
                  />
                </div>
                <div className="field-group">
                  <label htmlFor="typo-lh">
                    {translate(lang, "lineHeightLabel")}: {settings.lineHeight.toFixed(1)}
                  </label>
                  <input
                    id="typo-lh"
                    type="range"
                    min={1.2}
                    max={2.4}
                    step={0.1}
                    value={settings.lineHeight}
                    onChange={(e) => void updateSettings({ lineHeight: Number(e.target.value) })}
                  />
                </div>
                <div className="field-group">
                  <label htmlFor="typo-margin">
                    {translate(lang, "marginLabel")}: {settings.marginPx}px
                  </label>
                  <input
                    id="typo-margin"
                    type="range"
                    min={12}
                    max={120}
                    step={4}
                    value={settings.marginPx}
                    onChange={(e) => void updateSettings({ marginPx: Number(e.target.value) })}
                  />
                </div>
                <div className="field-group">
                  <label htmlFor="typo-align">{translate(lang, "alignLabel")}</label>
                  <select
                    id="typo-align"
                    value={settings.textAlign}
                    onChange={(e) =>
                      void updateSettings({ textAlign: e.target.value as TextAlign })
                    }
                  >
                    <option value="left">{translate(lang, "alignLeft")}</option>
                    <option value="justify">{translate(lang, "alignJustify")}</option>
                  </select>
                </div>
              </>
            )}
          </aside>
        )}

        {/* Strict Sandboxed Chapter Frame (NO allow-scripts!) */}
        <div className="reader-frame-wrap">
          <iframe
            ref={iframeRef}
            className="reader-iframe"
            title={currentChapter.title}
            sandbox="allow-same-origin"
            srcDoc={currentChapter.srcDoc}
            onLoad={handleIframeLoad}
            data-testid="reader-sandbox-iframe"
          />
        </div>
      </div>

      {/* TTS Control Dock */}
      <div className="tts-bar" role="region" aria-label={translate(lang, "ttsTitle")}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <Volume2 size={16} aria-hidden="true" />
          <strong>{translate(lang, "ttsTitle")}</strong>
          <span className="chip">
            {translate(lang, "ttsProviderActive")}: {ttsActiveVoice || settings.ttsProvider}
          </span>
          {ttsChunks.length > 0 && (
            <span className="chip">
              {translate(lang, "ttsChunkStatus", {
                current: ttsChunkIndex + 1,
                total: ttsChunks.length,
              })}
            </span>
          )}
          {ttsError && <span style={{ color: "var(--danger)", fontSize: "12px" }}>{ttsError}</span>}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
          {ttsState === "idle" || ttsState === "error" ? (
            <button
              type="button"
              className="primary"
              onClick={() => void speakText(currentChapter.plainText.slice(0, 3000))}
              data-testid="tts-play-chapter-btn"
            >
              <Play size={14} />
              {translate(lang, "ttsPlay")}
            </button>
          ) : ttsState === "paused" ? (
            <button type="button" className="primary" onClick={() => void resumeTts()}>
              <Play size={14} />
              {translate(lang, "ttsResume")}
            </button>
          ) : (
            <button type="button" onClick={pauseTts}>
              <Pause size={14} />
              {translate(lang, "ttsPause")}
            </button>
          )}

          <button
            type="button"
            disabled={ttsState === "idle" || ttsChunkIndex <= 0}
            onClick={() => void prevTtsChunk()}
            aria-label={translate(lang, "ttsPrev")}
          >
            <SkipBack size={14} />
          </button>
          <button
            type="button"
            disabled={ttsState === "idle" || ttsChunkIndex + 1 >= ttsChunks.length}
            onClick={() => void nextTtsChunk()}
            aria-label={translate(lang, "ttsNext")}
          >
            <SkipForward size={14} />
          </button>
          <button
            type="button"
            disabled={ttsState === "idle"}
            onClick={stopTts}
            aria-label={translate(lang, "ttsStop")}
          >
            <Square size={14} />
            {translate(lang, "ttsStop")}
          </button>

          <label
            style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "12px" }}
          >
            {translate(lang, "ttsSpeed")}: {settings.ttsRate.toFixed(1)}x
            <input
              type="range"
              min={0.5}
              max={2.0}
              step={0.1}
              value={settings.ttsRate}
              onChange={(e) => void updateSettings({ ttsRate: Number(e.target.value) })}
              aria-label={translate(lang, "ttsSpeed")}
            />
          </label>
        </div>
      </div>

      {/* Explicit Pre-Send Gemini Cloud TTS Confirmation Dialog */}
      {ttsPendingConsentText && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="gemini-consent-title"
        >
          <div className="modal-card" style={{ maxWidth: "480px" }}>
            <div className="modal-header">
              <h3 id="gemini-consent-title" style={{ margin: 0 }}>
                {translate(lang, "ttsGeminiConsentTitle")}
              </h3>
            </div>
            <div className="modal-body">
              <p>
                {translate(lang, "ttsGeminiConsentBody", {
                  chars: ttsPendingConsentText.length,
                })}
              </p>
              <div
                className="alert-box"
                style={{ maxHeight: "120px", overflowY: "auto", fontSize: "12px" }}
              >
                {ttsPendingConsentText.slice(0, 300)}
                {ttsPendingConsentText.length > 300 ? "..." : ""}
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" onClick={cancelGeminiSpeak}>
                {translate(lang, "cancel")}
              </button>
              <button type="button" className="primary" onClick={() => void confirmGeminiSpeak()}>
                {translate(lang, "ttsGeminiConsentConfirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
