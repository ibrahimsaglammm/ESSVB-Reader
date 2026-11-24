import { useState } from "react";
import { BookOpen, Download, Edit3, Search, Trash2 } from "lucide-react";
import { translate } from "../../i18n";
import { useAppStore } from "../../store/useAppStore";

export function GlobalNotesView() {
  const lang = useAppStore((s) => s.settings.language);
  const books = useAppStore((s) => s.books);
  const notes = useAppStore((s) => s.globalAnnotations);

  const loadGlobalAnnotations = useAppStore((s) => s.loadGlobalAnnotations);
  const updateAnnotation = useAppStore((s) => s.updateAnnotation);
  const deleteAnnotation = useAppStore((s) => s.deleteAnnotation);
  const exportNotes = useAppStore((s) => s.exportNotes);
  const openBook = useAppStore((s) => s.openBook);

  const [bookFilter, setBookFilter] = useState("");
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const handleFilterChange = (nextBook: string, nextSearch: string) => {
    setBookFilter(nextBook);
    setSearch(nextSearch);
    void loadGlobalAnnotations(nextBook || undefined, nextSearch || undefined);
  };

  return (
    <div className="library-main" style={{ width: "100%" }} data-testid="notes-view">
      <div className="library-toolbar">
        <h2 style={{ margin: 0, fontSize: "16px", marginRight: "8px" }}>
          {translate(lang, "notesGlobalTitle")}
        </h2>

        <div style={{ display: "flex", alignItems: "center", gap: "6px", flex: "1 1 240px" }}>
          <Search size={15} aria-hidden="true" />
          <input
            type="text"
            value={search}
            onChange={(e) => handleFilterChange(bookFilter, e.target.value)}
            placeholder={translate(lang, "notesSearchPlaceholder")}
            aria-label={translate(lang, "notesSearchPlaceholder")}
            style={{ flex: 1 }}
          />
        </div>

        <select
          value={bookFilter}
          onChange={(e) => handleFilterChange(e.target.value, search)}
          aria-label={translate(lang, "notesFilterBook")}
        >
          <option value="">{translate(lang, "allOption")}</option>
          {books.map((b) => (
            <option key={b.id} value={b.id}>
              {b.title}
            </option>
          ))}
        </select>

        <button type="button" onClick={() => void exportNotes("md", bookFilter || null)}>
          <Download size={14} />
          {translate(lang, "notesExportMd")}
        </button>
        <button type="button" onClick={() => void exportNotes("json", bookFilter || null)}>
          <Download size={14} />
          {translate(lang, "notesExportJson")}
        </button>
      </div>

      <div className="table-scroll">
        {notes.length === 0 ? (
          <div className="alert-box">{translate(lang, "notesEmpty")}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {notes.map((ann) => {
              const targetBook = books.find((b) => b.id === ann.bookId);
              return (
                <article key={ann.id} className="alert-box">
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: "8px",
                      flexWrap: "wrap",
                    }}
                  >
                    <div>
                      <strong>{ann.bookTitle}</strong>{" "}
                      <span className="chip">
                        {ann.chapterTitle || `Bölüm ${ann.spineIndex + 1}`}
                      </span>{" "}
                      <span className="chip">{ann.color}</span>
                    </div>
                    <div style={{ display: "flex", gap: "6px" }}>
                      {targetBook && (
                        <button
                          type="button"
                          onClick={() => void openBook(targetBook, ann.spineIndex)}
                        >
                          <BookOpen size={14} />
                          {translate(lang, "notesJumpBook")}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(ann.id);
                          setEditText(ann.noteText);
                        }}
                      >
                        <Edit3 size={14} />
                        {translate(lang, "actionEdit")}
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => void deleteAnnotation(ann.id)}
                      >
                        <Trash2 size={14} />
                        {translate(lang, "deleteShelf")}
                      </button>
                    </div>
                  </div>

                  <blockquote
                    style={{
                      margin: "8px 0",
                      paddingLeft: "10px",
                      borderLeft: "3px solid var(--accent)",
                    }}
                  >
                    {ann.quoteText}
                  </blockquote>

                  {editingId === ann.id ? (
                    <div style={{ display: "flex", gap: "6px", marginTop: "6px" }}>
                      <input
                        type="text"
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        style={{ flex: 1 }}
                      />
                      <button
                        type="button"
                        className="primary"
                        onClick={() => {
                          void updateAnnotation(ann.id, editText, ann.color);
                          setEditingId(null);
                        }}
                      >
                        {translate(lang, "save")}
                      </button>
                      <button type="button" onClick={() => setEditingId(null)}>
                        {translate(lang, "cancel")}
                      </button>
                    </div>
                  ) : (
                    ann.noteText && <p style={{ margin: "4px 0 0" }}>{ann.noteText}</p>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
