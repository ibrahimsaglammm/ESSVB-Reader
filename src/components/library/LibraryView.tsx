import { useEffect, useMemo, useState, type DragEvent } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  ArrowUpDown,
  BookOpen,
  Check,
  Edit3,
  FolderPlus,
  GripVertical,
  Plus,
  Search,
  Tag,
  Trash2,
  Upload,
} from "lucide-react";
import { translate } from "../../i18n";
import { isTauriRuntime } from "../../services/tauriBridge";
import { useAppStore } from "../../store/useAppStore";
import type { BookDto, BookFilterQuery, ReadingStatus } from "../../types/models";
import { MetadataModal } from "./MetadataModal";

export function LibraryView() {
  const settings = useAppStore((s) => s.settings);
  const books = useAppStore((s) => s.books);
  const shelves = useAppStore((s) => s.shelves);
  const allTags = useAppStore((s) => s.allTags);
  const filter = useAppStore((s) => s.filter);
  const selectedBookIds = useAppStore((s) => s.selectedBookIds);

  const setFilter = useAppStore((s) => s.setFilter);
  const resetFilters = useAppStore((s) => s.resetFilters);
  const toggleSelectBook = useAppStore((s) => s.toggleSelectBook);
  const toggleSelectAllBooks = useAppStore((s) => s.toggleSelectAllBooks);
  const importFilesPaths = useAppStore((s) => s.importFilesPaths);
  const importWithFileDialog = useAppStore((s) => s.importWithFileDialog);
  const importWithFolderDialog = useAppStore((s) => s.importWithFolderDialog);
  const createShelf = useAppStore((s) => s.createShelf);
  const renameShelf = useAppStore((s) => s.renameShelf);
  const deleteShelf = useAppStore((s) => s.deleteShelf);
  const assignBooksToShelf = useAppStore((s) => s.assignBooksToShelf);
  const removeBookFromShelf = useAppStore((s) => s.removeBookFromShelf);
  const bulkAddTags = useAppStore((s) => s.bulkAddTags);
  const bulkSetStatus = useAppStore((s) => s.bulkSetStatus);
  const deleteBooks = useAppStore((s) => s.deleteBooks);
  const openBook = useAppStore((s) => s.openBook);
  const updateSettings = useAppStore((s) => s.updateSettings);

  const lang = settings.language;

  const [newShelfName, setNewShelfName] = useState("");
  const [renamingShelfId, setRenamingShelfId] = useState<string | null>(null);
  const [renameShelfText, setRenameShelfText] = useState("");
  const [editingBook, setEditingBook] = useState<BookDto | null>(null);
  const [bulkShelfId, setBulkShelfId] = useState("");
  const [bulkTagsInput, setBulkTagsInput] = useState("");
  const [dragHoverShelfId, setDragHoverShelfId] = useState<string | null>(null);
  const [pointerDraggingBookIds, setPointerDraggingBookIds] = useState<string[] | null>(null);
  const [nativeFileDragOver, setNativeFileDragOver] = useState(false);

  // Subscribe to Tauri native file drag-and-drop when running inside Tauri desktop shell
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "over" || event.payload.type === "enter") {
          setNativeFileDragOver(true);
        } else if (event.payload.type === "leave") {
          setNativeFileDragOver(false);
        } else if (event.payload.type === "drop") {
          setNativeFileDragOver(false);
          const epubs = event.payload.paths.filter((p) => p.toLowerCase().endsWith(".epub"));
          if (epubs.length > 0) {
            void importFilesPaths(epubs);
          }
        }
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => {
      if (unlisten) unlisten();
    };
  }, [importFilesPaths]);

  // Pointer-based fallback drag-and-drop onto shelves (works reliably even when native drop target is active)
  useEffect(() => {
    if (!pointerDraggingBookIds) return;
    const handleMove = (e: PointerEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const dropTarget = el?.closest("[data-shelf-drop-id]") as HTMLElement | null;
      setDragHoverShelfId(dropTarget?.dataset.shelfDropId ?? null);
    };
    const handleUp = (e: PointerEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const dropTarget = el?.closest("[data-shelf-drop-id]") as HTMLElement | null;
      const targetShelfId = dropTarget?.dataset.shelfDropId;
      if (targetShelfId) {
        void assignBooksToShelf(pointerDraggingBookIds, targetShelfId);
      }
      setPointerDraggingBookIds(null);
      setDragHoverShelfId(null);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [pointerDraggingBookIds, assignBooksToShelf]);

  const distinctGenres = useMemo(
    () =>
      Array.from(
        new Set(
          books
            .map((b) => b.genre)
            .flatMap((g) => g.split(","))
            .map((s) => s.trim())
            .filter(Boolean),
        ),
      ).sort(),
    [books],
  );
  const distinctAuthors = useMemo(
    () => Array.from(new Set(books.map((b) => b.author).filter(Boolean))).sort(),
    [books],
  );
  const distinctSeries = useMemo(
    () => Array.from(new Set(books.map((b) => b.series).filter(Boolean))).sort(),
    [books],
  );

  const shelfNameMap = useMemo(() => {
    const map = new Map<string, string>();
    shelves.forEach((s) => map.set(s.id, s.name));
    return map;
  }, [shelves]);

  const statusLabel = (st: ReadingStatus) => {
    switch (st) {
      case "reading":
        return translate(lang, "statusReading");
      case "finished":
        return translate(lang, "statusFinished");
      default:
        return translate(lang, "statusToRead");
    }
  };

  const handleBookDragStart = (e: DragEvent, bookId: string) => {
    const ids = selectedBookIds.includes(bookId) ? selectedBookIds : [bookId];
    e.dataTransfer.setData("application/x-essvb-book-ids", JSON.stringify(ids));
    e.dataTransfer.effectAllowed = "copy";
  };

  const handleShelfDrop = (e: DragEvent, shelfId: string) => {
    e.preventDefault();
    setDragHoverShelfId(null);
    const raw = e.dataTransfer.getData("application/x-essvb-book-ids");
    if (!raw) return;
    try {
      const ids = JSON.parse(raw) as string[];
      if (Array.isArray(ids) && ids.length > 0) {
        void assignBooksToShelf(ids, shelfId);
      }
    } catch {
      // ignore invalid drag payload
    }
  };

  return (
    <div className="main-body" data-testid="library-view">
      {/* Left Navigation Sidebar */}
      <aside className="library-sidebar" aria-label={translate(lang, "shelvesTitle")}>
        <div className="sidebar-section">
          <h3>{translate(lang, "allBooks")}</h3>
          <div className="sidebar-list">
            <button
              type="button"
              className={`sidebar-item ${!filter.shelfId && !filter.readingStatus && !filter.tag ? "active" : ""}`}
              onClick={() => void resetFilters()}
            >
              <span>{translate(lang, "allBooks")}</span>
              <span className="chip">{books.length}</span>
            </button>
          </div>
        </div>

        <div className="sidebar-section">
          <h3>{translate(lang, "statusFilters")}</h3>
          <div className="sidebar-list">
            {(["to_read", "reading", "finished"] as ReadingStatus[]).map((st) => (
              <button
                key={st}
                type="button"
                className={`sidebar-item ${filter.readingStatus === st ? "active" : ""}`}
                onClick={() =>
                  void setFilter({
                    readingStatus: filter.readingStatus === st ? undefined : st,
                  })
                }
              >
                <span>{statusLabel(st)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="sidebar-section">
          <h3>{translate(lang, "shelvesTitle")}</h3>
          <form
            style={{ display: "flex", gap: "4px", marginBottom: "8px" }}
            onSubmit={(e) => {
              e.preventDefault();
              if (newShelfName.trim()) {
                void createShelf(newShelfName);
                setNewShelfName("");
              }
            }}
          >
            <input
              type="text"
              value={newShelfName}
              onChange={(e) => setNewShelfName(e.target.value)}
              placeholder={translate(lang, "createShelfPlaceholder")}
              aria-label={translate(lang, "createShelfPlaceholder")}
              style={{ flex: 1, minWidth: 0 }}
              data-testid="new-shelf-input"
            />
            <button
              type="submit"
              className="icon-btn"
              title={translate(lang, "createShelfBtn")}
              aria-label={translate(lang, "createShelfBtn")}
              data-testid="create-shelf-btn"
            >
              <Plus size={15} />
            </button>
          </form>

          <div style={{ fontSize: "11px", color: "var(--muted)", marginBottom: "6px" }}>
            {translate(lang, "shelfDropHint")}
          </div>

          <div className="sidebar-list">
            {shelves.map((shelf) => (
              <div
                key={shelf.id}
                className="shelf-row"
                data-shelf-drop-id={shelf.id}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragHoverShelfId(shelf.id);
                }}
                onDragLeave={() => setDragHoverShelfId(null)}
                onDrop={(e) => handleShelfDrop(e, shelf.id)}
              >
                {renamingShelfId === shelf.id ? (
                  <form
                    style={{ display: "flex", gap: "4px", flex: 1 }}
                    onSubmit={(e) => {
                      e.preventDefault();
                      void renameShelf(shelf.id, renameShelfText);
                      setRenamingShelfId(null);
                    }}
                  >
                    <input
                      type="text"
                      value={renameShelfText}
                      onChange={(e) => setRenameShelfText(e.target.value)}
                      autoFocus
                      style={{ flex: 1, minWidth: 0 }}
                    />
                    <button type="submit" className="icon-btn" aria-label={translate(lang, "save")}>
                      <Check size={13} />
                    </button>
                  </form>
                ) : (
                  <>
                    <button
                      type="button"
                      className={`sidebar-item ${filter.shelfId === shelf.id ? "active" : ""} ${
                        dragHoverShelfId === shelf.id ? "drop-hover" : ""
                      }`}
                      style={{ flex: 1 }}
                      onClick={() =>
                        void setFilter({
                          shelfId: filter.shelfId === shelf.id ? undefined : shelf.id,
                        })
                      }
                    >
                      <span>{shelf.name}</span>
                      <span className="chip">{shelf.bookCount}</span>
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      title={translate(lang, "renameShelf")}
                      aria-label={translate(lang, "renameShelf")}
                      onClick={() => {
                        setRenamingShelfId(shelf.id);
                        setRenameShelfText(shelf.name);
                      }}
                    >
                      <Edit3 size={13} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      title={translate(lang, "deleteShelf")}
                      aria-label={translate(lang, "deleteShelf")}
                      onClick={() => void deleteShelf(shelf.id)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="sidebar-section">
          <h3>{translate(lang, "tagsTitle")}</h3>
          <div className="chip-list">
            {allTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className={`chip ${filter.tag === tag ? "active" : ""}`}
                style={
                  filter.tag === tag
                    ? { background: "var(--accent)", color: "var(--accent-text)" }
                    : undefined
                }
                onClick={() => void setFilter({ tag: filter.tag === tag ? undefined : tag })}
              >
                #{tag}
              </button>
            ))}
          </div>
        </div>

        <div className="sidebar-section">
          <h3>{translate(lang, "filtersTitle")}</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div className="field-group">
              <label htmlFor="filter-genre">{translate(lang, "filterGenre")}</label>
              <select
                id="filter-genre"
                value={filter.genre ?? ""}
                onChange={(e) => void setFilter({ genre: e.target.value || undefined })}
              >
                <option value="">{translate(lang, "allOption")}</option>
                {distinctGenres.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>
            <div className="field-group">
              <label htmlFor="filter-author">{translate(lang, "filterAuthor")}</label>
              <select
                id="filter-author"
                value={filter.author ?? ""}
                onChange={(e) => void setFilter({ author: e.target.value || undefined })}
              >
                <option value="">{translate(lang, "allOption")}</option>
                {distinctAuthors.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
            <div className="field-group">
              <label htmlFor="filter-series">{translate(lang, "filterSeries")}</label>
              <select
                id="filter-series"
                value={filter.series ?? ""}
                onChange={(e) => void setFilter({ series: e.target.value || undefined })}
              >
                <option value="">{translate(lang, "allOption")}</option>
                {distinctSeries.map((sr) => (
                  <option key={sr} value={sr}>
                    {sr}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </aside>

      {/* Main List/Table Area */}
      <section className="library-main">
        <div className="library-toolbar">
          <div style={{ display: "flex", alignItems: "center", gap: "6px", flex: "1 1 240px" }}>
            <Search size={16} aria-hidden="true" />
            <input
              type="text"
              value={filter.search ?? ""}
              onChange={(e) => void setFilter({ search: e.target.value })}
              placeholder={translate(lang, "searchBooksPlaceholder")}
              aria-label={translate(lang, "searchBooksPlaceholder")}
              style={{ flex: 1 }}
              data-testid="library-search-input"
            />
          </div>

          <label style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
            <span>{translate(lang, "sortBy")}:</span>
            <select
              value={filter.sortBy ?? "addedAt"}
              onChange={(e) =>
                void setFilter({
                  sortBy: e.target.value as BookFilterQuery["sortBy"],
                })
              }
            >
              <option value="addedAt">{translate(lang, "sortAdded")}</option>
              <option value="title">{translate(lang, "sortTitle")}</option>
              <option value="author">{translate(lang, "sortAuthor")}</option>
              <option value="series">{translate(lang, "sortSeries")}</option>
              <option value="progress">{translate(lang, "sortProgress")}</option>
              <option value="lastOpened">{translate(lang, "sortLastOpened")}</option>
            </select>
          </label>

          <button
            type="button"
            className="icon-btn"
            onClick={() => void setFilter({ sortDir: filter.sortDir === "asc" ? "desc" : "asc" })}
            aria-label={translate(lang, "sortBy")}
          >
            <ArrowUpDown size={15} />
            {filter.sortDir === "asc" ? "A-Z" : "Z-A"}
          </button>

          <label style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
            <input
              type="checkbox"
              checked={settings.showCoverThumbnails}
              onChange={(e) => void updateSettings({ showCoverThumbnails: e.target.checked })}
            />
            {translate(lang, "showThumbnails")}
          </label>

          <button
            type="button"
            className="primary"
            onClick={() => void importWithFileDialog()}
            data-testid="add-books-btn"
          >
            <Upload size={15} aria-hidden="true" />
            {translate(lang, "openBookFiles")}
          </button>

          <button type="button" onClick={() => void importWithFolderDialog()}>
            <FolderPlus size={15} aria-hidden="true" />
            {translate(lang, "openBookFolder")}
          </button>
        </div>

        {nativeFileDragOver && (
          <div className="alert-box" style={{ margin: "8px 16px" }}>
            {translate(lang, "dropHint")}
          </div>
        )}

        {selectedBookIds.length > 0 && (
          <div className="bulk-bar" role="region" aria-label="Toplu İşlemler">
            <strong>{translate(lang, "bulkSelected", { count: selectedBookIds.length })}</strong>

            <select
              value={bulkShelfId}
              onChange={(e) => setBulkShelfId(e.target.value)}
              aria-label={translate(lang, "bulkAssignShelf")}
            >
              <option value="">{translate(lang, "bulkAssignShelf")}...</option>
              {shelves.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!bulkShelfId}
              onClick={() => {
                if (bulkShelfId) void assignBooksToShelf(selectedBookIds, bulkShelfId);
              }}
            >
              {translate(lang, "bulkAssignShelf")}
            </button>

            <input
              type="text"
              value={bulkTagsInput}
              onChange={(e) => setBulkTagsInput(e.target.value)}
              placeholder={translate(lang, "bulkAddTags")}
              aria-label={translate(lang, "bulkAddTags")}
            />
            <button
              type="button"
              disabled={!bulkTagsInput.trim()}
              onClick={() => {
                const parsed = bulkTagsInput
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean);
                void bulkAddTags(parsed);
                setBulkTagsInput("");
              }}
            >
              <Tag size={14} />
              {translate(lang, "bulkApplyTags")}
            </button>

            <select
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) {
                  void bulkSetStatus(e.target.value as ReadingStatus);
                  e.target.value = "";
                }
              }}
              aria-label={translate(lang, "bulkSetStatus")}
            >
              <option value="">{translate(lang, "bulkSetStatus")}...</option>
              <option value="to_read">{translate(lang, "statusToRead")}</option>
              <option value="reading">{translate(lang, "statusReading")}</option>
              <option value="finished">{translate(lang, "statusFinished")}</option>
            </select>

            <button
              type="button"
              className="danger"
              onClick={() => void deleteBooks(selectedBookIds)}
            >
              <Trash2 size={14} />
              {translate(lang, "bulkDelete")}
            </button>
          </div>
        )}

        <div className="table-scroll">
          {books.length === 0 ? (
            <div
              className="alert-box"
              style={{ marginTop: "24px", textAlign: "center", padding: "32px" }}
            >
              <h3 style={{ marginTop: 0 }}>{translate(lang, "emptyLibraryTitle")}</h3>
              <p style={{ color: "var(--muted)" }}>{translate(lang, "emptyLibraryDesc")}</p>
              <p style={{ fontSize: "12px", color: "var(--muted)" }}>
                {translate(lang, "dropHint")}
              </p>
            </div>
          ) : (
            <table className="book-table">
              <thead>
                <tr>
                  <th style={{ width: "36px" }}>
                    <input
                      type="checkbox"
                      aria-label="Tümünü Seç"
                      checked={books.length > 0 && selectedBookIds.length === books.length}
                      onChange={toggleSelectAllBooks}
                    />
                  </th>
                  <th style={{ width: "28px" }} aria-label="Sürükle" />
                  {settings.showCoverThumbnails && <th style={{ width: "44px" }} />}
                  <th>{translate(lang, "colTitle")}</th>
                  <th>{translate(lang, "colAuthor")}</th>
                  <th>{translate(lang, "colSeries")}</th>
                  <th>{translate(lang, "colGenre")}</th>
                  <th>{translate(lang, "colTags")}</th>
                  <th>{translate(lang, "colShelves")}</th>
                  <th>{translate(lang, "colStatus")}</th>
                  <th>{translate(lang, "colProgress")}</th>
                  <th>{translate(lang, "colActions")}</th>
                </tr>
              </thead>
              <tbody>
                {books.map((book) => (
                  <tr
                    key={book.id}
                    draggable
                    onDragStart={(e) => handleBookDragStart(e, book.id)}
                    data-testid={`book-row-${book.id}`}
                  >
                    <td>
                      <input
                        type="checkbox"
                        aria-label={book.title}
                        checked={selectedBookIds.includes(book.id)}
                        onChange={() => toggleSelectBook(book.id)}
                      />
                    </td>
                    <td>
                      <span
                        title={translate(lang, "shelfDropHint")}
                        style={{ cursor: "grab", display: "inline-flex" }}
                        onPointerDown={() => {
                          const ids = selectedBookIds.includes(book.id)
                            ? selectedBookIds
                            : [book.id];
                          setPointerDraggingBookIds(ids);
                        }}
                      >
                        <GripVertical size={14} />
                      </span>
                    </td>
                    {settings.showCoverThumbnails && (
                      <td>
                        {book.coverDataUrl ? (
                          <img className="thumb-mini" src={book.coverDataUrl} alt="" />
                        ) : (
                          <span className="chip">EPUB</span>
                        )}
                      </td>
                    )}
                    <td>
                      <button
                        type="button"
                        style={{
                          background: "transparent",
                          border: "none",
                          padding: 0,
                          fontWeight: 600,
                          textAlign: "left",
                        }}
                        onClick={() => void openBook(book)}
                        data-testid={`open-book-${book.id}`}
                      >
                        {book.title}
                      </button>
                    </td>
                    <td>{book.author}</td>
                    <td>{book.series || "—"}</td>
                    <td>{book.genre || "—"}</td>
                    <td>
                      <div className="chip-list">
                        {book.tags.map((t) => (
                          <span key={t} className="chip">
                            #{t}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <div className="chip-list">
                        {book.shelfIds.map((sid) => (
                          <span key={sid} className="chip">
                            {shelfNameMap.get(sid) ?? sid}
                            {filter.shelfId === sid && (
                              <button
                                type="button"
                                style={{
                                  border: "none",
                                  background: "transparent",
                                  padding: "0 0 0 4px",
                                  fontSize: "11px",
                                }}
                                title="Raftan çıkar"
                                onClick={() => void removeBookFromShelf(book.id, sid)}
                              >
                                ×
                              </button>
                            )}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <span className="status-badge">{statusLabel(book.readingStatus)}</span>
                    </td>
                    <td>{Math.round(book.progressPercent)}%</td>
                    <td>
                      <div style={{ display: "flex", gap: "4px" }}>
                        <button
                          type="button"
                          className="primary icon-btn"
                          title={translate(lang, "actionRead")}
                          aria-label={`${translate(lang, "actionRead")}: ${book.title}`}
                          onClick={() => void openBook(book)}
                        >
                          <BookOpen size={14} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          title={translate(lang, "actionEdit")}
                          aria-label={`${translate(lang, "actionEdit")}: ${book.title}`}
                          onClick={() => setEditingBook(book)}
                        >
                          <Edit3 size={14} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn danger"
                          title={translate(lang, "actionDelete")}
                          aria-label={`${translate(lang, "actionDelete")}: ${book.title}`}
                          onClick={() => void deleteBooks([book.id])}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {editingBook && <MetadataModal book={editingBook} onClose={() => setEditingBook(null)} />}
    </div>
  );
}
