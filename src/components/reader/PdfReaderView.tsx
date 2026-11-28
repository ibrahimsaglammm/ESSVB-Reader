import { useCallback, useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist/types/src/display/api";
import {
  ArrowLeft,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Headphones,
  List,
  Pause,
  Play,
  SlidersHorizontal,
  Square,
  Trash2,
  Volume2,
} from "lucide-react";
import { translate } from "../../i18n";
import { getApiBridge } from "../../services/tauriBridge";
import { useAppStore } from "../../store/useAppStore";
import { FloatingReaderPanel } from "./FloatingReaderPanel";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

function decodeBase64ToUint8Array(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

export function PdfReaderView() {
  const settings = useAppStore((s) => s.settings);
  const activeBook = useAppStore((s) => s.activeBook);
  const toc = useAppStore((s) => s.toc);
  const bookBookmarks = useAppStore((s) => s.bookBookmarks);
  const ttsState = useAppStore((s) => s.ttsState);
  const ttsActiveVoice = useAppStore((s) => s.ttsActiveVoice);

  const setActiveView = useAppStore((s) => s.setActiveView);
  const saveReaderProgress = useAppStore((s) => s.saveReaderProgress);
  const toggleBookmarkAtCurrentPage = useAppStore((s) => s.toggleBookmarkAtCurrentPage);
  const deleteBookmark = useAppStore((s) => s.deleteBookmark);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const startTtsFromPosition = useAppStore((s) => s.startTtsFromPosition);
  const pauseTts = useAppStore((s) => s.pauseTts);
  const resumeTts = useAppStore((s) => s.resumeTts);
  const stopTts = useAppStore((s) => s.stopTts);

  const lang = settings.language;
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const leftCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rightCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const scrollCanvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const activeRenderTasks = useRef<RenderTask[]>([]);
  const latestPageRef = useRef({ page: 1, total: 1 });

  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(1);
  const [currentPage, setCurrentPage] = useState(() =>
    Math.max(1, (activeBook?.lastPageIndex ?? 0) + 1),
  );
  const [zoom, setZoom] = useState(1.0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sidePanel, setSidePanel] = useState<"none" | "toc" | "bookmarks">("none");
  const [floatingOpen, setFloatingOpen] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(() =>
    typeof window === "undefined" ? true : window.innerWidth > 760,
  );
  const [pageJumpOpen, setPageJumpOpen] = useState(false);
  const [pageJumpVal, setPageJumpVal] = useState("1");

  const isScrollMode = settings.readerLayoutMode === "scroll";
  const isTwoPage =
    settings.readerLayoutMode === "paginated-2" &&
    (typeof window === "undefined" || window.innerWidth >= 760);

  // Load raw PDF document bytes cleanly offline via bundled pdfjs-dist worker
  useEffect(() => {
    if (!activeBook) return;
    let cancelled = false;
    let loadedDoc: PDFDocumentProxy | null = null;
    setLoading(true);
    setLoadError(null);

    void getApiBridge()
      .getBookFileBase64(activeBook.id)
      .then(async (b64) => {
        if (cancelled) return;
        const data = decodeBase64ToUint8Array(b64);
        const task = pdfjsLib.getDocument({ data });
        const doc = await task.promise;
        if (cancelled) {
          await task.destroy();
          return;
        }
        loadedDoc = doc;
        const initialPage = Math.max(
          1,
          Math.min(doc.numPages, (activeBook.lastPageIndex ?? 0) + 1),
        );
        setPdfDoc(doc);
        setNumPages(doc.numPages);
        setCurrentPage(initialPage);
        latestPageRef.current = { page: initialPage, total: doc.numPages };
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });

    return () => {
      cancelled = true;
      activeRenderTasks.current.forEach((t) => t.cancel());
      activeRenderTasks.current = [];
      if (loadedDoc) {
        void loadedDoc.loadingTask.destroy();
      }
    };
  }, [activeBook]);

  const persistPageNow = useCallback(
    (page: number, total: number) => {
      if (!activeBook) return;
      const safePage = Math.max(1, Math.min(total, page));
      const idx = safePage - 1;
      const ratio = total > 1 ? idx / (total - 1) : 0;
      void saveReaderProgress(0, ratio, idx, 0);
    },
    [activeBook, saveReaderProgress],
  );

  // Save on hide/unload/unmount
  useEffect(() => {
    const flush = () => {
      persistPageNow(latestPageRef.current.page, latestPageRef.current.total);
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", onVis);
      flush();
    };
  }, [persistPageNow]);

  const goToPage = useCallback(
    (nextPage: number) => {
      const clamped = Math.max(1, Math.min(numPages, nextPage));
      setCurrentPage(clamped);
      latestPageRef.current = { page: clamped, total: numPages };
      persistPageNow(clamped, numPages);
      if (isScrollMode) {
        const slot = wrapRef.current?.querySelector<HTMLElement>(`[data-pdf-page="${clamped}"]`);
        slot?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    },
    [isScrollMode, numPages, persistPageNow],
  );

  const renderSinglePageToCanvas = useCallback(
    async (
      doc: PDFDocumentProxy,
      pageNum: number,
      canvas: HTMLCanvasElement,
      maxW: number,
      maxH: number,
    ) => {
      const page = await doc.getPage(pageNum);
      const baseVp = page.getViewport({ scale: 1 });
      const fitScale = Math.min(
        Math.max(0.2, maxW / Math.max(1, baseVp.width)),
        isScrollMode ? 3 : Math.max(0.2, maxH / Math.max(1, baseVp.height)),
      );
      const cssScale = Math.max(0.35, fitScale * zoom);
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      const viewport = page.getViewport({ scale: cssScale * dpr });

      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
      canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const task = page.render({ canvasContext: ctx, viewport, canvas });
      activeRenderTasks.current.push(task);
      await task.promise;
    },
    [isScrollMode, zoom],
  );

  // Render fixed paginated mode (1-page or 2-page spread)
  useEffect(() => {
    if (!pdfDoc || isScrollMode) return;
    let cancelled = false;
    activeRenderTasks.current.forEach((t) => t.cancel());
    activeRenderTasks.current = [];

    const run = async () => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const availW = Math.max(240, wrap.clientWidth - 24);
      const availH = Math.max(240, wrap.clientHeight - 24);
      const leftTargetW = isTwoPage ? Math.floor((availW - 16) / 2) : availW;

      if (leftCanvasRef.current) {
        await renderSinglePageToCanvas(
          pdfDoc,
          currentPage,
          leftCanvasRef.current,
          leftTargetW,
          availH,
        ).catch(() => undefined);
      }
      if (!cancelled && isTwoPage && rightCanvasRef.current) {
        if (currentPage + 1 <= numPages) {
          await renderSinglePageToCanvas(
            pdfDoc,
            currentPage + 1,
            rightCanvasRef.current,
            leftTargetW,
            availH,
          ).catch(() => undefined);
        } else {
          const ctx = rightCanvasRef.current.getContext("2d");
          rightCanvasRef.current.width = 1;
          rightCanvasRef.current.height = 1;
          ctx?.clearRect(0, 0, 1, 1);
        }
      }
    };

    void run();
    const onResize = () => {
      void run();
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelled = true;
      window.removeEventListener("resize", onResize);
    };
  }, [currentPage, isScrollMode, isTwoPage, numPages, pdfDoc, renderSinglePageToCanvas]);

  // Lazy IntersectionObserver rendering for Vertical Scroll mode
  useEffect(() => {
    if (!pdfDoc || !isScrollMode || !wrapRef.current) return;
    const container = wrapRef.current;
    const slots = Array.from(container.querySelectorAll<HTMLElement>("[data-pdf-page]"));
    if (slots.length === 0) return;

    const initialSlot = container.querySelector<HTMLElement>(`[data-pdf-page="${currentPage}"]`);
    initialSlot?.scrollIntoView({ block: "start" });

    const rendered = new Set<number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          const pNum = Number.parseInt(el.dataset.pdfPage ?? "1", 10);
          setCurrentPage(pNum);
          latestPageRef.current = { page: pNum, total: numPages };

          for (const targetP of [pNum - 1, pNum, pNum + 1]) {
            if (targetP < 1 || targetP > numPages || rendered.has(targetP)) continue;
            const canvas = scrollCanvasRefs.current.get(targetP);
            if (!canvas) continue;
            rendered.add(targetP);
            const availW = Math.max(240, container.clientWidth - 24);
            void renderSinglePageToCanvas(
              pdfDoc,
              targetP,
              canvas,
              availW,
              container.clientHeight,
            ).catch(() => rendered.delete(targetP));
          }
        }
      },
      { root: container, rootMargin: "400px 0px", threshold: 0.15 },
    );

    slots.forEach((s) => observer.observe(s));
    return () => {
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isScrollMode, numPages, pdfDoc, zoom]);

  // Keyboard shortcuts for fixed-page navigation
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.tagName === "INPUT") return;
      if (e.key === "ArrowRight" || e.key === "PageDown") {
        e.preventDefault();
        goToPage(currentPage + (isTwoPage ? 2 : 1));
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        goToPage(currentPage - (isTwoPage ? 2 : 1));
      } else if (e.key === "Escape") {
        setFloatingOpen(false);
        setPageJumpOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [currentPage, goToPage, isTwoPage]);

  if (!activeBook) return null;

  const isCurrentBookmarked = bookBookmarks.some((bm) => bm.pageIndex === currentPage - 1);

  const handleToggleBookmark = () => {
    void toggleBookmarkAtCurrentPage(
      0,
      currentPage - 1,
      0,
      `${activeBook.title} — Sayfa ${currentPage}`,
      `S. ${currentPage}`,
    );
  };

  const handleSpeakPdfPage = async () => {
    if (!pdfDoc) return;
    if (ttsState === "playing") {
      stopTts();
      return;
    }
    const page = await pdfDoc.getPage(currentPage);
    const tc = await page.getTextContent();
    const text = tc.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) return;
    await startTtsFromPosition(activeBook.id, Math.max(0, currentPage - 1), 0, text, false);
  };

  let touchStartX = 0;
  let touchStartY = 0;

  return (
    <div className="reader-shell" data-testid="pdf-reader-view">
      {chromeVisible && (
        <div className="reader-topbar">
          <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
            <button
              type="button"
              onClick={() => {
                persistPageNow(currentPage, numPages);
                setActiveView("library");
              }}
              data-testid="back-to-library-btn"
            >
              <ArrowLeft size={15} />
              <span className="hide-on-phone">{translate(lang, "readerBackToLibrary")}</span>
            </button>
            <span
              style={{
                fontWeight: 600,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {activeBook.title}
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => goToPage(currentPage - (isTwoPage ? 2 : 1))}
              aria-label={translate(lang, "prevPageBtn")}
            >
              <ChevronLeft size={15} />
            </button>
            <button
              type="button"
              className="page-status-pill"
              onClick={() => {
                setPageJumpVal(String(currentPage));
                setPageJumpOpen((p) => !p);
              }}
              data-testid="reading-page-badge"
            >
              S. {currentPage}/{numPages}
            </button>
            {pageJumpOpen && (
              <form
                style={{ display: "inline-flex", gap: "4px" }}
                onSubmit={(e) => {
                  e.preventDefault();
                  const parsed = Number.parseInt(pageJumpVal, 10);
                  if (!Number.isNaN(parsed)) goToPage(parsed);
                  setPageJumpOpen(false);
                }}
              >
                <input
                  type="number"
                  min={1}
                  max={numPages}
                  value={pageJumpVal}
                  onChange={(e) => setPageJumpVal(e.target.value)}
                  style={{ width: "64px" }}
                />
                <button type="submit" className="primary">
                  OK
                </button>
              </form>
            )}
            <button
              type="button"
              disabled={currentPage >= numPages}
              onClick={() => goToPage(currentPage + (isTwoPage ? 2 : 1))}
              aria-label={translate(lang, "nextPageBtn")}
            >
              <ChevronRight size={15} />
            </button>
            <button
              type="button"
              onClick={() => setSidePanel(sidePanel === "toc" ? "none" : "toc")}
              aria-label={translate(lang, "readerToc")}
            >
              <List size={15} />
            </button>
            <button
              type="button"
              className={isCurrentBookmarked ? "primary" : ""}
              onClick={handleToggleBookmark}
              aria-label={translate(lang, "bookmarkAdd")}
            >
              <Bookmark size={15} />
            </button>
            <button type="button" onClick={() => setFloatingOpen((o) => !o)} aria-label="Ayarlar">
              <SlidersHorizontal size={15} />
            </button>
          </div>
        </div>
      )}

      <div className="reader-workspace">
        {sidePanel !== "none" && (
          <aside className="reader-sidepanel" aria-label={sidePanel}>
            {sidePanel === "toc" && (
              <>
                <h3 style={{ margin: 0 }}>{translate(lang, "readerToc")}</h3>
                <div className="sidebar-list">
                  {Array.from({ length: numPages }, (_, i) => i + 1).map((p) => (
                    <button
                      key={p}
                      type="button"
                      className={`sidebar-item ${p === currentPage ? "active" : ""}`}
                      onClick={() => {
                        goToPage(p);
                        if (window.innerWidth <= 760) setSidePanel("none");
                      }}
                    >
                      {toc[p - 1]?.title || `Sayfa ${p}`}
                    </button>
                  ))}
                </div>
              </>
            )}
            {sidePanel === "bookmarks" && (
              <>
                <h3 style={{ margin: 0 }}>{translate(lang, "bookmarksTitle")}</h3>
                <div className="sidebar-list">
                  {bookBookmarks.map((bm) => (
                    <div
                      key={bm.id}
                      className="alert-box note-card-clickable"
                      role="button"
                      tabIndex={0}
                      onClick={() => goToPage(bm.pageIndex + 1)}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "6px" }}>
                        <span>{bm.label}</span>
                        <button
                          type="button"
                          className="icon-btn danger"
                          onClick={(e) => {
                            e.stopPropagation();
                            void deleteBookmark(bm.id);
                          }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </aside>
        )}

        <div
          ref={wrapRef}
          className={`pdf-viewport-wrap ${isScrollMode ? "scroll-mode" : "paged-mode"}`}
          onClick={(e) => {
            if (isScrollMode) {
              setChromeVisible((v) => !v);
              return;
            }
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = (e.clientX - rect.left) / Math.max(1, rect.width);
            if (ratio <= 0.25) {
              goToPage(currentPage - (isTwoPage ? 2 : 1));
            } else if (ratio >= 0.75) {
              goToPage(currentPage + (isTwoPage ? 2 : 1));
            } else {
              setChromeVisible((v) => !v);
            }
          }}
          onTouchStart={(e) => {
            const t = e.touches.item(0);
            if (t) {
              touchStartX = t.clientX;
              touchStartY = t.clientY;
            }
          }}
          onTouchEnd={(e) => {
            if (isScrollMode) return;
            const t = e.changedTouches.item(0);
            if (!t) return;
            const dx = t.clientX - touchStartX;
            const dy = t.clientY - touchStartY;
            if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.25) {
              if (dx < 0) {
                goToPage(currentPage + (isTwoPage ? 2 : 1));
              } else {
                goToPage(currentPage - (isTwoPage ? 2 : 1));
              }
            }
          }}
        >
          {loading && <div className="alert-box">PDF yükleniyor...</div>}
          {loadError && <div className="alert-box alert-warn">{loadError}</div>}

          {!loading && !loadError && !isScrollMode && (
            <div className="pdf-canvas-spread">
              <canvas ref={leftCanvasRef} className="pdf-page-canvas" />
              {isTwoPage && currentPage + 1 <= numPages && (
                <canvas ref={rightCanvasRef} className="pdf-page-canvas" />
              )}
            </div>
          )}

          {!loading && !loadError && isScrollMode && (
            <div className="pdf-scroll-stack">
              {Array.from({ length: numPages }, (_, i) => i + 1).map((pNum) => (
                <div key={pNum} data-pdf-page={pNum} className="pdf-scroll-page-slot">
                  <canvas
                    ref={(el) => {
                      if (el) {
                        scrollCanvasRefs.current.set(pNum, el);
                      } else {
                        scrollCanvasRefs.current.delete(pNum);
                      }
                    }}
                    className="pdf-page-canvas"
                  />
                  <span className="pdf-scroll-page-num">
                    {pNum} / {numPages}
                  </span>
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            className="floating-reader-trigger"
            onClick={(e) => {
              e.stopPropagation();
              setFloatingOpen((o) => !o);
            }}
            data-testid="floating-settings-btn"
            aria-label="Okuma Düzeni ve Ayarlar"
          >
            <SlidersHorizontal size={16} />
            <span>
              S. {currentPage}/{numPages}
            </span>
          </button>

          <FloatingReaderPanel
            open={floatingOpen}
            onClose={() => setFloatingOpen(false)}
            lang={lang}
            settings={settings}
            onUpdateSettings={updateSettings}
            isPdf
            pdfZoom={zoom}
            onChangePdfZoom={setZoom}
            isBookmarked={isCurrentBookmarked}
            onToggleBookmark={handleToggleBookmark}
            onOpenSidePanel={(p) => {
              setSidePanel(p === "notes" ? "bookmarks" : p);
              setFloatingOpen(false);
            }}
            ttsPlaying={ttsState === "playing"}
            onToggleTts={() => void handleSpeakPdfPage()}
          />
        </div>
      </div>

      {chromeVisible && (
        <div className="tts-bar" role="region" aria-label={translate(lang, "ttsTitle")}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <Volume2 size={16} />
            <span className="tts-status-pill">
              <Headphones size={12} style={{ marginRight: "4px", verticalAlign: "-1px" }} />
              {ttsActiveVoice || settings.ttsProvider}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            {ttsState === "idle" || ttsState === "error" ? (
              <button type="button" className="primary" onClick={() => void handleSpeakPdfPage()}>
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
            <button type="button" disabled={ttsState === "idle"} onClick={stopTts}>
              <Square size={14} />
              {translate(lang, "ttsStop")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
