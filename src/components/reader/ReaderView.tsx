import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  BookMarked,
  BookOpen,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Headphones,
  List,
  Navigation,
  Pause,
  Play,
  ScrollText,
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
import type {
  AnnotationDto,
  FontFamily,
  HighlightColor,
  HighlightStyle,
  ReaderLayoutMode,
  TextAlign,
} from "../../types/models";
import {
  applyHighlightStyleToMark,
  getHighlightToken,
  getNoteQuoteStyle,
} from "../../utils/highlights";
import { computeGlobalPageStats } from "../../utils/pagination";
import { SelectionPopupMenu, type SelectionPopupRect } from "./SelectionPopupMenu";

interface SelectionInfo {
  spineIndex: number;
  text: string;
  startOffset: number;
  endOffset: number;
  rect: SelectionPopupRect;
}

type SidePanel = "none" | "toc" | "search" | "notes" | "bookmarks" | "typography";

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

function measureChapterPagination(
  doc: Document,
  iframe: HTMLIFrameElement,
  isPaginated: boolean,
): { pageIndex: number; totalPages: number; ratio: number; charOffset: number } {
  const textLen = (doc.body?.textContent ?? "").length;
  if (isPaginated) {
    const stride = Math.max(1, iframe.clientWidth);
    const scrollW = Math.max(stride, doc.documentElement.scrollWidth);
    const totalPages = Math.max(1, Math.ceil((scrollW - 6) / stride));
    const scrollX = doc.defaultView?.scrollX ?? doc.documentElement.scrollLeft ?? 0;
    const pageIndex = Math.max(0, Math.min(totalPages - 1, Math.round(scrollX / stride)));
    const ratio = totalPages > 1 ? pageIndex / (totalPages - 1) : 0;
    const charOffset = totalPages > 1 ? Math.round((pageIndex / totalPages) * textLen) : 0;
    return { pageIndex, totalPages, ratio, charOffset };
  }

  const viewH = Math.max(1, iframe.clientHeight);
  const scrollH = Math.max(viewH, doc.documentElement.scrollHeight);
  const totalPages = Math.max(1, Math.ceil((scrollH - 6) / viewH));
  const scrollY = doc.defaultView?.scrollY ?? doc.documentElement.scrollTop ?? 0;
  const maxScroll = Math.max(1, scrollH - viewH);
  const ratio = Math.min(1, Math.max(0, scrollY / maxScroll));
  const pageIndex = Math.max(0, Math.min(totalPages - 1, Math.floor(scrollY / viewH)));
  const charOffset = Math.round(ratio * textLen);
  return { pageIndex, totalPages, ratio, charOffset };
}

function findPageForCharOffset(
  doc: Document,
  iframe: HTMLIFrameElement,
  charOffset: number,
  isPaginated: boolean,
  totalPages: number,
): number {
  if (!doc.body || charOffset <= 0 || totalPages <= 1) return 0;
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let pos = 0;
  let current = walker.nextNode();
  while (current) {
    const tn = current as Text;
    const len = tn.data.length;
    if (pos + len >= charOffset) {
      const localOffset = Math.max(0, Math.min(len, charOffset - pos));
      try {
        const range = doc.createRange();
        range.setStart(tn, localOffset);
        range.collapse(true);
        const rect = range.getBoundingClientRect();
        if (isPaginated) {
          const stride = Math.max(1, iframe.clientWidth);
          const scrollX = doc.defaultView?.scrollX ?? doc.documentElement.scrollLeft ?? 0;
          const docX = Math.max(0, rect.left + scrollX);
          return Math.max(0, Math.min(totalPages - 1, Math.floor(docX / stride)));
        }
        const scrollY = doc.defaultView?.scrollY ?? doc.documentElement.scrollTop ?? 0;
        const docY = Math.max(0, rect.top + scrollY);
        const viewH = Math.max(1, iframe.clientHeight);
        return Math.max(0, Math.min(totalPages - 1, Math.floor(docY / viewH)));
      } catch {
        break;
      }
    }
    pos += len;
    current = walker.nextNode();
  }
  const textLen = Math.max(1, (doc.body.textContent ?? "").length);
  return Math.max(0, Math.min(totalPages - 1, Math.floor((charOffset / textLen) * totalPages)));
}

export function ReaderView() {
  const settings = useAppStore((s) => s.settings);
  const activeBook = useAppStore((s) => s.activeBook);
  const toc = useAppStore((s) => s.toc);
  const currentChapter = useAppStore((s) => s.currentChapter);
  const bookSearchResults = useAppStore((s) => s.bookSearchResults);
  const bookAnnotations = useAppStore((s) => s.bookAnnotations);
  const bookPageMap = useAppStore((s) => s.bookPageMap);
  const bookBookmarks = useAppStore((s) => s.bookBookmarks);
  const pendingChapterLanding = useAppStore((s) => s.pendingChapterLanding);
  const pendingJumpAnnotation = useAppStore((s) => s.pendingJumpAnnotation);
  const ttsState = useAppStore((s) => s.ttsState);
  const ttsChunks = useAppStore((s) => s.ttsChunks);
  const ttsChunkIndex = useAppStore((s) => s.ttsChunkIndex);
  const ttsActiveChunk = useAppStore((s) => s.ttsActiveChunk);
  const ttsActiveVoice = useAppStore((s) => s.ttsActiveVoice);
  const ttsError = useAppStore((s) => s.ttsError);
  const ttsPendingConsentText = useAppStore((s) => s.ttsPendingConsentText);

  const setActiveView = useAppStore((s) => s.setActiveView);
  const openSettings = useAppStore((s) => s.openSettings);
  const showToast = useAppStore((s) => s.showToast);
  const loadChapterIndex = useAppStore((s) => s.loadChapterIndex);
  const clearPendingChapterLanding = useAppStore((s) => s.clearPendingChapterLanding);
  const saveReaderProgress = useAppStore((s) => s.saveReaderProgress);
  const jumpToGlobalPage = useAppStore((s) => s.jumpToGlobalPage);
  const toggleBookmarkAtCurrentPage = useAppStore((s) => s.toggleBookmarkAtCurrentPage);
  const deleteBookmark = useAppStore((s) => s.deleteBookmark);
  const jumpToBookmark = useAppStore((s) => s.jumpToBookmark);
  const searchInBook = useAppStore((s) => s.searchInBook);
  const createAnnotation = useAppStore((s) => s.createAnnotation);
  const deleteAnnotation = useAppStore((s) => s.deleteAnnotation);
  const jumpToAnnotation = useAppStore((s) => s.jumpToAnnotation);
  const clearPendingJumpAnnotation = useAppStore((s) => s.clearPendingJumpAnnotation);
  const assistSelectedText = useAppStore((s) => s.assistSelectedText);
  const openExternalUrl = useAppStore((s) => s.openExternalUrl);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const speakText = useAppStore((s) => s.speakText);
  const startTtsFromPosition = useAppStore((s) => s.startTtsFromPosition);
  const resumeOrStartTtsFromSaved = useAppStore((s) => s.resumeOrStartTtsFromSaved);
  const jumpVisualToTtsLocation = useAppStore((s) => s.jumpVisualToTtsLocation);
  const confirmGeminiSpeak = useAppStore((s) => s.confirmGeminiSpeak);
  const cancelGeminiSpeak = useAppStore((s) => s.cancelGeminiSpeak);
  const pauseTts = useAppStore((s) => s.pauseTts);
  const resumeTts = useAppStore((s) => s.resumeTts);
  const stopTts = useAppStore((s) => s.stopTts);
  const prevTtsChunk = useAppStore((s) => s.prevTtsChunk);
  const nextTtsChunk = useAppStore((s) => s.nextTtsChunk);

  const lang = settings.language;
  const isPaginated = settings.readerLayoutMode !== "scroll";
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const frameWrapRef = useRef<HTMLDivElement | null>(null);
  const scrollTimerRef = useRef<number | null>(null);
  const restoredForBookRef = useRef<string | null>(null);
  const lastMeasuredRef = useRef<{
    spineIndex: number;
    ratio: number;
    pageIndex: number;
    charOffset: number;
  } | null>(null);

  const [panel, setPanel] = useState<SidePanel>("none");
  const [searchQuery, setSearchQuery] = useState("");
  const [pageJumpOpen, setPageJumpOpen] = useState(false);
  const [pageJumpInput, setPageJumpInput] = useState("");
  const [pageState, setPageState] = useState({ pageIndex: 0, totalPages: 1, charOffset: 0 });
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [selectedColor, setSelectedColor] = useState<HighlightColor>("yellow");
  const [selectedStyle, setSelectedStyle] = useState<HighlightStyle>("solid");

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
          undefined,
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
              undefined,
              ann.id,
            );
          }
        }
        if (marked) {
          applyHighlightStyleToMark(marked, ann.color, ann.highlightStyle);
        }
      }
    },
    [],
  );

  const scrollAndPulseAnnotation = useCallback(
    (
      doc: Document,
      target: { id: string; spineIndex: number; startOffset: number; quoteText: string },
    ) => {
      let mark = doc.querySelector<HTMLElement>(`mark.essvb-highlight[data-ann-id="${target.id}"]`);
      if (!mark && doc.body?.textContent) {
        const idx = doc.body.textContent.indexOf(target.quoteText);
        const start = idx >= 0 ? idx : target.startOffset;
        mark = wrapTextRangeInDoc(
          doc,
          start,
          start + Math.max(1, target.quoteText.length),
          "essvb-highlight",
          undefined,
          target.id,
        );
      }
      if (mark) {
        mark.scrollIntoView({
          block: isPaginated ? "nearest" : "center",
          inline: isPaginated ? "start" : "nearest",
          behavior: "smooth",
        });
        mark.classList.add("essvb-highlight-pulse");
        window.setTimeout(() => {
          mark?.classList.remove("essvb-highlight-pulse");
        }, 1800);
      }
      clearPendingJumpAnnotation();
    },
    [clearPendingJumpAnnotation, isPaginated],
  );

  const syncMetricsAndPersist = useCallback(
    (persistNow: boolean) => {
      const iframe = iframeRef.current;
      const doc = iframe?.contentDocument;
      if (!iframe || !doc || !currentChapter || !activeBook) return;
      const metrics = measureChapterPagination(doc, iframe, isPaginated);
      setPageState({
        pageIndex: metrics.pageIndex,
        totalPages: metrics.totalPages,
        charOffset: metrics.charOffset,
      });
      lastMeasuredRef.current = {
        spineIndex: currentChapter.spineIndex,
        ratio: metrics.ratio,
        pageIndex: metrics.pageIndex,
        charOffset: metrics.charOffset,
      };
      if (persistNow) {
        void saveReaderProgress(
          currentChapter.spineIndex,
          metrics.ratio,
          metrics.pageIndex,
          metrics.charOffset,
        );
      }
    },
    [activeBook, currentChapter, isPaginated, saveReaderProgress],
  );

  const goToPageInChapter = useCallback(
    (targetPage: number) => {
      const iframe = iframeRef.current;
      const doc = iframe?.contentDocument;
      if (!iframe || !doc || !currentChapter) return;
      const metrics = measureChapterPagination(doc, iframe, isPaginated);
      const clamped = Math.max(0, Math.min(metrics.totalPages - 1, targetPage));
      if (isPaginated) {
        const stride = Math.max(1, iframe.clientWidth);
        doc.defaultView?.scrollTo(clamped * stride, 0);
      } else {
        const maxScroll = Math.max(0, doc.documentElement.scrollHeight - iframe.clientHeight);
        const ratio = metrics.totalPages > 1 ? clamped / (metrics.totalPages - 1) : 0;
        doc.defaultView?.scrollTo(0, maxScroll * ratio);
      }
      setSelection(null);
      window.requestAnimationFrame(() => syncMetricsAndPersist(true));
    },
    [currentChapter, isPaginated, syncMetricsAndPersist],
  );

  const goNextPage = useCallback(() => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!iframe || !doc || !currentChapter) return;
    const metrics = measureChapterPagination(doc, iframe, isPaginated);
    if (isPaginated) {
      if (metrics.pageIndex + 1 < metrics.totalPages) {
        goToPageInChapter(metrics.pageIndex + 1);
      } else if (currentChapter.spineIndex + 1 < currentChapter.chapterCount) {
        void loadChapterIndex(currentChapter.spineIndex + 1, "start");
      }
      return;
    }
    const viewH = Math.max(1, iframe.clientHeight);
    const scrollY = doc.defaultView?.scrollY ?? doc.documentElement.scrollTop ?? 0;
    const scrollH = doc.documentElement.scrollHeight;
    if (scrollY + viewH < scrollH - 12) {
      doc.defaultView?.scrollTo(0, scrollY + Math.round(viewH * 0.88));
      window.requestAnimationFrame(() => syncMetricsAndPersist(true));
    } else if (currentChapter.spineIndex + 1 < currentChapter.chapterCount) {
      void loadChapterIndex(currentChapter.spineIndex + 1, "start");
    }
  }, [currentChapter, goToPageInChapter, isPaginated, loadChapterIndex, syncMetricsAndPersist]);

  const goPrevPage = useCallback(() => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!iframe || !doc || !currentChapter) return;
    const metrics = measureChapterPagination(doc, iframe, isPaginated);
    if (isPaginated) {
      if (metrics.pageIndex > 0) {
        goToPageInChapter(metrics.pageIndex - 1);
      } else if (currentChapter.spineIndex > 0) {
        void loadChapterIndex(currentChapter.spineIndex - 1, "end");
      }
      return;
    }
    const viewH = Math.max(1, iframe.clientHeight);
    const scrollY = doc.defaultView?.scrollY ?? doc.documentElement.scrollTop ?? 0;
    if (scrollY > 12) {
      doc.defaultView?.scrollTo(0, Math.max(0, scrollY - Math.round(viewH * 0.88)));
      window.requestAnimationFrame(() => syncMetricsAndPersist(true));
    } else if (currentChapter.spineIndex > 0) {
      void loadChapterIndex(currentChapter.spineIndex - 1, "end");
    }
  }, [currentChapter, goToPageInChapter, isPaginated, loadChapterIndex, syncMetricsAndPersist]);

  // Sync active TTS sentence highlight inside the sandboxed chapter iframe
  useEffect(() => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!iframe || !doc || !doc.body) return;

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
        if (mark && settings.ttsFollowPage) {
          if (isPaginated) {
            const metrics = measureChapterPagination(doc, iframe, true);
            const targetPage = findPageForCharOffset(
              doc,
              iframe,
              foundIdx,
              true,
              metrics.totalPages,
            );
            if (targetPage !== metrics.pageIndex) {
              const stride = Math.max(1, iframe.clientWidth);
              doc.defaultView?.scrollTo(targetPage * stride, 0);
            }
          } else {
            mark.scrollIntoView({ block: "center", behavior: "smooth" });
          }
        }
      }
    }
  }, [isPaginated, settings.ttsFollowPage, ttsActiveChunk]);

  const applyLandingHintToDoc = useCallback(
    (doc: Document, iframe: HTMLIFrameElement) => {
      if (!currentChapter || !activeBook) return;
      const metrics = measureChapterPagination(doc, iframe, isPaginated);
      const hint = pendingChapterLanding;

      if (hint === "start") {
        doc.defaultView?.scrollTo(0, 0);
        clearPendingChapterLanding();
      } else if (hint === "end") {
        if (isPaginated) {
          const stride = Math.max(1, iframe.clientWidth);
          doc.defaultView?.scrollTo(Math.max(0, metrics.totalPages - 1) * stride, 0);
        } else {
          const maxScroll = Math.max(0, doc.documentElement.scrollHeight - iframe.clientHeight);
          doc.defaultView?.scrollTo(0, maxScroll);
        }
        clearPendingChapterLanding();
      } else if (hint && typeof hint === "object") {
        if (isPaginated) {
          const stride = Math.max(1, iframe.clientWidth);
          let targetPage = 0;
          if (typeof hint.pageIndex === "number" && hint.pageIndex > 0) {
            targetPage = Math.max(0, Math.min(metrics.totalPages - 1, hint.pageIndex));
          } else if (typeof hint.charOffset === "number" && hint.charOffset > 0) {
            targetPage = findPageForCharOffset(
              doc,
              iframe,
              hint.charOffset,
              true,
              metrics.totalPages,
            );
          }
          doc.defaultView?.scrollTo(targetPage * stride, 0);
        } else if (typeof hint.charOffset === "number" && hint.charOffset > 0) {
          const targetPage = findPageForCharOffset(
            doc,
            iframe,
            hint.charOffset,
            false,
            metrics.totalPages,
          );
          const maxScroll = Math.max(0, doc.documentElement.scrollHeight - iframe.clientHeight);
          const ratio = metrics.totalPages > 1 ? targetPage / (metrics.totalPages - 1) : 0;
          doc.defaultView?.scrollTo(0, maxScroll * ratio);
        } else if (
          activeBook.lastSpineIndex === currentChapter.spineIndex &&
          activeBook.lastScrollOffset > 0
        ) {
          const maxScroll = Math.max(0, doc.documentElement.scrollHeight - iframe.clientHeight);
          doc.defaultView?.scrollTo(0, maxScroll * activeBook.lastScrollOffset);
        }
        clearPendingChapterLanding();
      } else {
        const restoreKey = `${activeBook.id}:${currentChapter.spineIndex}:${settings.readerLayoutMode}`;
        if (
          restoredForBookRef.current !== restoreKey &&
          activeBook.lastSpineIndex === currentChapter.spineIndex
        ) {
          restoredForBookRef.current = restoreKey;
          if (isPaginated) {
            const stride = Math.max(1, iframe.clientWidth);
            const targetPage =
              activeBook.lastPageIndex > 0
                ? Math.min(metrics.totalPages - 1, activeBook.lastPageIndex)
                : activeBook.lastCharOffset > 0
                  ? findPageForCharOffset(
                      doc,
                      iframe,
                      activeBook.lastCharOffset,
                      true,
                      metrics.totalPages,
                    )
                  : 0;
            doc.defaultView?.scrollTo(targetPage * stride, 0);
          } else if (activeBook.lastScrollOffset > 0) {
            const maxScroll = Math.max(0, doc.documentElement.scrollHeight - iframe.clientHeight);
            doc.defaultView?.scrollTo(0, maxScroll * activeBook.lastScrollOffset);
          }
        }
      }

      window.requestAnimationFrame(() => syncMetricsAndPersist(false));
    },
    [
      activeBook,
      clearPendingChapterLanding,
      currentChapter,
      isPaginated,
      pendingChapterLanding,
      settings.readerLayoutMode,
      syncMetricsAndPersist,
    ],
  );

  // Flush exact reading progress immediately on hide/unload/unmount
  useEffect(() => {
    const flushNow = () => {
      const m = lastMeasuredRef.current;
      if (m) {
        void saveReaderProgress(m.spineIndex, m.ratio, m.pageIndex, m.charOffset);
      }
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") flushNow();
    };
    window.addEventListener("pagehide", flushNow);
    window.addEventListener("beforeunload", flushNow);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pagehide", flushNow);
      window.removeEventListener("beforeunload", flushNow);
      document.removeEventListener("visibilitychange", onVis);
      flushNow();
    };
  }, [saveReaderProgress]);

  // Apply in-chapter landing hints (page jump, bookmark, jump-to-TTS) when chapter doesn't reload
  useEffect(() => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (iframe && doc?.body && pendingChapterLanding) {
      applyLandingHintToDoc(doc, iframe);
    }
  }, [pendingChapterLanding, applyLandingHintToDoc]);

  const handleIframeLoad = useCallback(() => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!iframe || !doc || !doc.body || !currentChapter || !activeBook) return;

    applyAnnotationsToIframe(doc, bookAnnotations, currentChapter.spineIndex);

    window.requestAnimationFrame(() => {
      if (pendingJumpAnnotation && pendingJumpAnnotation.spineIndex === currentChapter.spineIndex) {
        scrollAndPulseAnnotation(doc, pendingJumpAnnotation);
        syncMetricsAndPersist(true);
      } else {
        applyLandingHintToDoc(doc, iframe);
      }
    });

    const updateSelectionFromDoc = () => {
      const sel = doc.getSelection();
      if (!sel || sel.isCollapsed) {
        setSelection(null);
        return;
      }
      const txt = sel.toString().trim();
      if (!txt) {
        setSelection(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const { start, end } = computeDomTextOffsets(doc, range);
      const rangeRect = range.getBoundingClientRect();
      const iframeRect = iframe.getBoundingClientRect();
      const wrapRect = frameWrapRef.current?.getBoundingClientRect() ?? iframeRect;
      const offsetLeft = iframeRect.left - wrapRect.left;
      const offsetTop = iframeRect.top - wrapRect.top;
      setSelection({
        spineIndex: currentChapter.spineIndex,
        text: txt,
        startOffset: start,
        endOffset: end,
        rect: {
          left: offsetLeft + rangeRect.left + rangeRect.width / 2,
          top: offsetTop + rangeRect.top,
          bottom: offsetTop + rangeRect.bottom,
          containerWidth: wrapRect.width || iframe.clientWidth || 720,
          containerHeight: wrapRect.height || iframe.clientHeight || 540,
        },
      });
    };

    const handleScroll = () => {
      if (scrollTimerRef.current) {
        window.clearTimeout(scrollTimerRef.current);
      }
      scrollTimerRef.current = window.setTimeout(() => {
        syncMetricsAndPersist(true);
      }, 350);
    };

    // Left 25% / Right 25% tap/click inside page turns pages unless selecting text or clicking links/notes
    const handleIframeClick = (ev: MouseEvent) => {
      const sel = doc.getSelection();
      if (sel && !sel.isCollapsed) return;
      const target = ev.target as HTMLElement | null;
      if (target?.closest("a, button, input, select, textarea, mark")) return;
      const w = Math.max(1, iframe.clientWidth);
      const ratio = ev.clientX / w;
      if (ratio <= 0.25) {
        ev.preventDefault();
        goPrevPage();
      } else if (ratio >= 0.75) {
        ev.preventDefault();
        goNextPage();
      }
    };

    let touchStartX = 0;
    let touchStartY = 0;
    const handleTouchStart = (ev: TouchEvent) => {
      const first = ev.touches.item(0);
      if (ev.touches.length === 1 && first) {
        touchStartX = first.clientX;
        touchStartY = first.clientY;
      }
    };
    const handleTouchEnd = (ev: TouchEvent) => {
      const changed = ev.changedTouches.item(0);
      if (ev.changedTouches.length !== 1 || !changed) return;
      const sel = doc.getSelection();
      if (sel && !sel.isCollapsed) return;
      const dx = changed.clientX - touchStartX;
      const dy = changed.clientY - touchStartY;
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.3) {
        if (dx < 0) {
          goNextPage();
        } else {
          goPrevPage();
        }
      }
    };

    doc.addEventListener("mouseup", updateSelectionFromDoc);
    doc.addEventListener("keyup", updateSelectionFromDoc);
    doc.addEventListener("click", handleIframeClick);
    doc.addEventListener("touchstart", handleTouchStart, { passive: true });
    doc.addEventListener("touchend", handleTouchEnd, { passive: true });
    doc.defaultView?.addEventListener("scroll", handleScroll, { passive: true });
  }, [
    activeBook,
    applyAnnotationsToIframe,
    applyLandingHintToDoc,
    bookAnnotations,
    currentChapter,
    goNextPage,
    goPrevPage,
    pendingJumpAnnotation,
    scrollAndPulseAnnotation,
    syncMetricsAndPersist,
  ]);

  useEffect(() => {
    const doc = iframeRef.current?.contentDocument;
    if (doc && currentChapter) {
      applyAnnotationsToIframe(doc, bookAnnotations, currentChapter.spineIndex);
      if (pendingJumpAnnotation && pendingJumpAnnotation.spineIndex === currentChapter.spineIndex) {
        scrollAndPulseAnnotation(doc, pendingJumpAnnotation);
      }
    }
  }, [
    bookAnnotations,
    currentChapter,
    pendingJumpAnnotation,
    applyAnnotationsToIframe,
    scrollAndPulseAnnotation,
  ]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
        if (e.key === "Escape") setPageJumpOpen(false);
        return;
      }
      if (e.key === "Escape") {
        setSelection(null);
        setPageJumpOpen(false);
        iframeRef.current?.contentDocument?.getSelection()?.removeAllRanges();
      } else if (e.key === "ArrowRight" || e.key === "PageDown") {
        e.preventDefault();
        goNextPage();
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        goPrevPage();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goNextPage, goPrevPage]);

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

  const activeSelection =
    selection && selection.spineIndex === currentChapter.spineIndex ? selection : null;

  const handleCreateAnnotation = async (
    color: HighlightColor,
    style: HighlightStyle,
    noteText = "",
  ) => {
    if (!activeSelection) return;
    await createAnnotation({
      bookId: activeBook.id,
      spineIndex: currentChapter.spineIndex,
      chapterTitle: currentChapter.title,
      quoteText: activeSelection.text,
      noteText: noteText.trim(),
      color,
      highlightStyle: style,
      startOffset: activeSelection.startOffset,
      endOffset: activeSelection.endOffset,
    });
    setSelection(null);
    iframeRef.current?.contentDocument?.getSelection()?.removeAllRanges();
  };

  const handleCopySelection = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast("success", translate(lang, "copiedToClipboard"));
    } catch {
      showToast("error", "Pano erişimi başarısız.");
    }
  };

  const handleSearchInBookSelection = async (text: string) => {
    const query = text.trim().slice(0, 120);
    setSearchQuery(query);
    setPanel("search");
    await searchInBook(query);
  };

  const handleSearchWebSelection = async (text: string) => {
    const q = encodeURIComponent(text.trim().slice(0, 200));
    await openExternalUrl(`https://duckduckgo.com/?q=${q}`);
  };

  const handleReadFromHere = async () => {
    if (!activeSelection) return;
    const bodyText = iframeRef.current?.contentDocument?.body?.textContent ?? "";
    let slice = "";
    let offset = activeSelection.startOffset;
    if (bodyText && activeSelection.startOffset < bodyText.length) {
      slice = bodyText.slice(activeSelection.startOffset).trim();
    }
    if (!slice) {
      const idx = currentChapter.plainText.indexOf(activeSelection.text);
      offset = idx >= 0 ? idx : 0;
      slice = idx >= 0 ? currentChapter.plainText.slice(idx) : activeSelection.text;
    }
    await startTtsFromPosition(activeBook.id, currentChapter.spineIndex, offset, slice, true);
  };

  const globalPageStats = computeGlobalPageStats(
    bookPageMap,
    currentChapter.spineIndex,
    pageState.pageIndex,
    pageState.totalPages,
    currentChapter.chapterCount,
  );

  const isCurrentPageBookmarked = bookBookmarks.some(
    (bm) => bm.spineIndex === currentChapter.spineIndex && bm.pageIndex === pageState.pageIndex,
  );

  const cycleLayoutMode = () => {
    const order: ReaderLayoutMode[] = ["paginated-1", "paginated-2", "scroll"];
    const nextIdx = (order.indexOf(settings.readerLayoutMode) + 1) % order.length;
    void updateSettings({ readerLayoutMode: order[nextIdx] });
  };

  const layoutLabel =
    settings.readerLayoutMode === "paginated-2"
      ? translate(lang, "layoutPaginated2")
      : settings.readerLayoutMode === "scroll"
        ? translate(lang, "layoutScroll")
        : translate(lang, "layoutPaginated1");

  const handleBookmarkCurrent = () => {
    const label = `${currentChapter.title} — S. ${globalPageStats.currentGlobalPage}`;
    void toggleBookmarkAtCurrentPage(
      currentChapter.spineIndex,
      pageState.pageIndex,
      pageState.charOffset,
      label,
    );
  };

  const handleMoveTtsHere = () => {
    const slice = currentChapter.plainText.slice(
      Math.min(pageState.charOffset, Math.max(0, currentChapter.plainText.length - 1)),
    );
    void startTtsFromPosition(
      activeBook.id,
      currentChapter.spineIndex,
      pageState.charOffset,
      slice || currentChapter.plainText,
      true,
    );
  };

  return (
    <div className="reader-shell" data-testid="reader-view">
      {/* Top Reader Controls */}
      <div className="reader-topbar">
        <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
          <button
            type="button"
            onClick={() => {
              const m = lastMeasuredRef.current;
              if (m) {
                void saveReaderProgress(m.spineIndex, m.ratio, m.pageIndex, m.charOffset);
              }
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
            className={panel === "bookmarks" ? "primary" : ""}
            onClick={() => setPanel(panel === "bookmarks" ? "none" : "bookmarks")}
            data-testid="bookmarks-tab-btn"
          >
            <Bookmark size={15} />
            {translate(lang, "bookmarksTitle")} ({bookBookmarks.length})
          </button>
          <button
            type="button"
            className={isCurrentPageBookmarked ? "primary" : ""}
            onClick={handleBookmarkCurrent}
            title={translate(lang, "bookmarkAdd")}
            aria-label={translate(lang, "bookmarkAdd")}
            data-testid="bookmark-toggle-btn"
          >
            <Bookmark size={15} />
          </button>
          <button
            type="button"
            onClick={cycleLayoutMode}
            title={translate(lang, "layoutToggleTooltip")}
            data-testid="layout-mode-btn"
          >
            {settings.readerLayoutMode === "paginated-2" ? (
              <Columns2 size={15} />
            ) : settings.readerLayoutMode === "scroll" ? (
              <ScrollText size={15} />
            ) : (
              <BookOpen size={15} />
            )}
            {layoutLabel}
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
            disabled={currentChapter.spineIndex <= 0 && (!isPaginated || pageState.pageIndex <= 0)}
            onClick={goPrevPage}
            aria-label={translate(lang, "prevPageBtn")}
          >
            <ChevronLeft size={15} />
          </button>
          <button
            type="button"
            className="page-status-pill"
            onClick={() => {
              setPageJumpInput(String(globalPageStats.currentGlobalPage));
              setPageJumpOpen((prev) => !prev);
            }}
            data-testid="reading-page-badge"
            title={translate(lang, "pageJumpPrompt", {
              total: globalPageStats.totalGlobalPages,
            })}
          >
            <BookOpen size={13} style={{ marginRight: "4px", verticalAlign: "-2px" }} />
            {translate(lang, "readingPageBadge", {
              current: globalPageStats.currentGlobalPage,
              total: globalPageStats.totalGlobalPages,
            })}
          </button>
          {pageJumpOpen && (
            <form
              style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
              onSubmit={(e) => {
                e.preventDefault();
                const parsed = Number.parseInt(pageJumpInput, 10);
                if (!Number.isNaN(parsed)) {
                  void jumpToGlobalPage(parsed);
                }
                setPageJumpOpen(false);
              }}
            >
              <input
                type="number"
                min={1}
                max={globalPageStats.totalGlobalPages}
                value={pageJumpInput}
                onChange={(e) => setPageJumpInput(e.target.value)}
                style={{ width: "68px" }}
                data-testid="page-jump-input"
              />
              <button type="submit" className="primary">
                OK
              </button>
            </form>
          )}
          <button
            type="button"
            disabled={
              currentChapter.spineIndex + 1 >= currentChapter.chapterCount &&
              (!isPaginated || pageState.pageIndex + 1 >= pageState.totalPages)
            }
            onClick={goNextPage}
            aria-label={translate(lang, "nextPageBtn")}
          >
            <ChevronRight size={15} />
          </button>
        </div>
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
                    <div
                      key={ann.id}
                      className="alert-box note-card-clickable"
                      role="button"
                      tabIndex={0}
                      title={translate(lang, "notesJumpHint")}
                      onClick={() => void jumpToAnnotation(ann)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          void jumpToAnnotation(ann);
                        }
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: "6px",
                          alignItems: "center",
                        }}
                      >
                        <div
                          style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}
                        >
                          <span
                            className="swatch-dot"
                            style={{
                              width: "12px",
                              height: "12px",
                              backgroundColor: getHighlightToken(ann.color).swatchHex,
                              flexShrink: 0,
                            }}
                          />
                          <strong
                            style={{
                              fontSize: "12px",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {ann.chapterTitle || `Bölüm ${ann.spineIndex + 1}`}
                          </strong>
                        </div>
                        <button
                          type="button"
                          className="icon-btn danger"
                          aria-label={translate(lang, "deleteShelf")}
                          onClick={(e) => {
                            e.stopPropagation();
                            void deleteAnnotation(ann.id);
                          }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                      <blockquote
                        style={{
                          ...getNoteQuoteStyle(ann.color, ann.highlightStyle),
                          fontSize: "12px",
                        }}
                      >
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

            {panel === "bookmarks" && (
              <>
                <div
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
                >
                  <h3 style={{ margin: 0 }}>{translate(lang, "bookmarksTitle")}</h3>
                  <button type="button" className="primary" onClick={handleBookmarkCurrent}>
                    <Bookmark size={14} />
                    {translate(lang, "bookmarkAdd")}
                  </button>
                </div>
                <div className="sidebar-list">
                  {bookBookmarks.length === 0 ? (
                    <span style={{ color: "var(--muted)", fontSize: "12px" }}>
                      {translate(lang, "bookmarkEmpty")}
                    </span>
                  ) : (
                    bookBookmarks.map((bm) => (
                      <div
                        key={bm.id}
                        className="alert-box note-card-clickable"
                        role="button"
                        tabIndex={0}
                        onClick={() => void jumpToBookmark(bm)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            void jumpToBookmark(bm);
                          }
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: "6px",
                          }}
                        >
                          <span style={{ fontSize: "13px", fontWeight: 600 }}>{bm.label}</span>
                          <button
                            type="button"
                            className="icon-btn danger"
                            aria-label={translate(lang, "deleteShelf")}
                            onClick={(e) => {
                              e.stopPropagation();
                              void deleteBookmark(bm.id);
                            }}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
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
        <div className="reader-frame-wrap" ref={frameWrapRef}>
          {settings.readerLayoutMode === "paginated-2" && (
            <div className="book-spread-spine" aria-hidden="true" />
          )}

          <button
            type="button"
            className="page-turn-edge-btn left"
            onClick={goPrevPage}
            aria-label={translate(lang, "prevPageBtn")}
            data-testid="page-prev-btn"
          >
            <ChevronLeft size={18} />
          </button>

          <iframe
            ref={iframeRef}
            className="reader-iframe"
            title={currentChapter.title}
            sandbox="allow-same-origin"
            srcDoc={currentChapter.srcDoc}
            onLoad={handleIframeLoad}
            data-testid="reader-sandbox-iframe"
          />

          <button
            type="button"
            className="page-turn-edge-btn right"
            onClick={goNextPage}
            aria-label={translate(lang, "nextPageBtn")}
            data-testid="page-next-btn"
          >
            <ChevronRight size={18} />
          </button>

          {activeSelection && (
            <SelectionPopupMenu
              lang={lang}
              settings={settings}
              selectedText={activeSelection.text}
              rect={activeSelection.rect}
              selectedColor={selectedColor}
              selectedStyle={selectedStyle}
              onSelectColor={setSelectedColor}
              onSelectStyle={setSelectedStyle}
              onHighlight={(color, style) => handleCreateAnnotation(color, style, "")}
              onSaveNote={(noteText, color, style) =>
                handleCreateAnnotation(color, style, noteText)
              }
              onCopy={handleCopySelection}
              onSearchInBook={handleSearchInBookSelection}
              onSearchWeb={handleSearchWebSelection}
              onOpenExternalUrl={openExternalUrl}
              onSpeakSelected={(text) => speakText(text)}
              onReadFromHere={handleReadFromHere}
              onAssistText={assistSelectedText}
              onOpenSettings={() => openSettings("general")}
              onClose={() => {
                setSelection(null);
                iframeRef.current?.contentDocument?.getSelection()?.removeAllRanges();
              }}
            />
          )}
        </div>
      </div>

      {/* TTS Control Dock */}
      <div className="tts-bar" role="region" aria-label={translate(lang, "ttsTitle")}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <Volume2 size={16} aria-hidden="true" />
          <strong>{translate(lang, "ttsTitle")}</strong>
          <button
            type="button"
            className="tts-status-pill"
            onClick={() => void jumpVisualToTtsLocation()}
            title={translate(lang, "ttsJumpToVoice", {
              page: activeBook.ttsPageNumber || 1,
            })}
            data-testid="tts-page-badge"
          >
            <Headphones size={12} style={{ marginRight: "4px", verticalAlign: "-1px" }} />
            {translate(lang, "ttsPageBadge", {
              page: activeBook.ttsPageNumber || 1,
            })}
          </button>
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
              onClick={() => void resumeOrStartTtsFromSaved()}
              data-testid="tts-play-chapter-btn"
              title={translate(lang, "ttsResumeSaved")}
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
            onClick={handleMoveTtsHere}
            data-testid="tts-move-here-btn"
            title={translate(lang, "ttsMoveHere")}
          >
            <Navigation size={14} />
            {translate(lang, "ttsMoveHere")}
          </button>

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
