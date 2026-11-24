import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { translate } from "../../i18n";
import { useAppStore } from "../../store/useAppStore";
import type { BookDto, ReadingStatus } from "../../types/models";

interface MetadataModalProps {
  book: BookDto;
  onClose: () => void;
}

export function MetadataModal({ book, onClose }: MetadataModalProps) {
  const lang = useAppStore((s) => s.settings.language);
  const shelves = useAppStore((s) => s.shelves);
  const updateMetadataAndTags = useAppStore((s) => s.updateMetadataAndTags);

  const [title, setTitle] = useState(book.title);
  const [author, setAuthor] = useState(book.author);
  const [language, setLanguage] = useState(book.language);
  const [publisher, setPublisher] = useState(book.publisher);
  const [series, setSeries] = useState(book.series);
  const [genre, setGenre] = useState(book.genre);
  const [description, setDescription] = useState(book.description);
  const [readingStatus, setReadingStatus] = useState<ReadingStatus>(book.readingStatus);
  const [tagsText, setTagsText] = useState(book.tags.join(", "));
  const [selectedShelves, setSelectedShelves] = useState<string[]>(book.shelfIds);
  const [saving, setSaving] = useState(false);

  const toggleShelf = (shelfId: string) => {
    setSelectedShelves((prev) =>
      prev.includes(shelfId) ? prev.filter((id) => id !== shelfId) : [...prev, shelfId],
    );
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const tags = tagsText
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      await updateMetadataAndTags(
        book.id,
        {
          title,
          author,
          language,
          publisher,
          description,
          series,
          genre,
          readingStatus,
        },
        tags,
        selectedShelves,
      );
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="meta-modal-title"
    >
      <form className="modal-card" onSubmit={(e) => void handleSubmit(e)}>
        <div className="modal-header">
          <h2 id="meta-modal-title" style={{ margin: 0, fontSize: "16px" }}>
            {translate(lang, "metadataModalTitle")}
          </h2>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label={translate(lang, "close")}
          >
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <div className="form-grid">
            <div className="field-group">
              <label htmlFor="meta-title">{translate(lang, "fieldTitle")}</label>
              <input
                id="meta-title"
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="field-group">
              <label htmlFor="meta-author">{translate(lang, "fieldAuthor")}</label>
              <input
                id="meta-author"
                type="text"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
              />
            </div>
            <div className="field-group">
              <label htmlFor="meta-series">{translate(lang, "fieldSeries")}</label>
              <input
                id="meta-series"
                type="text"
                value={series}
                onChange={(e) => setSeries(e.target.value)}
              />
            </div>
            <div className="field-group">
              <label htmlFor="meta-genre">{translate(lang, "fieldGenre")}</label>
              <input
                id="meta-genre"
                type="text"
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
              />
            </div>
            <div className="field-group">
              <label htmlFor="meta-publisher">{translate(lang, "fieldPublisher")}</label>
              <input
                id="meta-publisher"
                type="text"
                value={publisher}
                onChange={(e) => setPublisher(e.target.value)}
              />
            </div>
            <div className="field-group">
              <label htmlFor="meta-lang">{translate(lang, "fieldLanguage")}</label>
              <input
                id="meta-lang"
                type="text"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
              />
            </div>
            <div className="field-group">
              <label htmlFor="meta-status">{translate(lang, "colStatus")}</label>
              <select
                id="meta-status"
                value={readingStatus}
                onChange={(e) => setReadingStatus(e.target.value as ReadingStatus)}
              >
                <option value="to_read">{translate(lang, "statusToRead")}</option>
                <option value="reading">{translate(lang, "statusReading")}</option>
                <option value="finished">{translate(lang, "statusFinished")}</option>
              </select>
            </div>
            <div className="field-group">
              <label htmlFor="meta-tags">{translate(lang, "fieldTags")}</label>
              <input
                id="meta-tags"
                type="text"
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
              />
            </div>
          </div>

          <div className="field-group">
            <label htmlFor="meta-desc">{translate(lang, "fieldDescription")}</label>
            <textarea
              id="meta-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="field-group">
            <label>{translate(lang, "fieldShelves")}</label>
            <div className="chip-list">
              {shelves.map((shelf) => (
                <label key={shelf.id} className="chip" style={{ cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={selectedShelves.includes(shelf.id)}
                    onChange={() => toggleShelf(shelf.id)}
                  />{" "}
                  {shelf.name}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" onClick={onClose}>
            {translate(lang, "cancel")}
          </button>
          <button type="submit" className="primary" disabled={saving}>
            {translate(lang, "save")}
          </button>
        </div>
      </form>
    </div>
  );
}
