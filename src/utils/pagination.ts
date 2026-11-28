export const CHARS_PER_STANDARD_PAGE = 1500;

export interface GlobalPageStats {
  currentGlobalPage: number;
  totalGlobalPages: number;
  chapterStartGlobalPage: number;
}

export function estimateChapterPagesFromChars(charCount: number): number {
  return Math.max(1, Math.ceil(Math.max(1, charCount) / CHARS_PER_STANDARD_PAGE));
}

export function computeGlobalPageStats(
  pageMap: number[],
  spineIndex: number,
  pageInChapter: number,
  totalPagesInChapter: number,
  fallbackChapterCount = 1,
): GlobalPageStats {
  const safeChapterPages = Math.max(1, totalPagesInChapter);
  const clampedPageInChapter = Math.max(0, Math.min(safeChapterPages - 1, pageInChapter));

  if (pageMap.length === 0) {
    return {
      chapterStartGlobalPage: spineIndex + 1,
      currentGlobalPage: spineIndex + clampedPageInChapter + 1,
      totalGlobalPages: Math.max(fallbackChapterCount, spineIndex + safeChapterPages),
    };
  }

  let beforePages = 0;
  let totalPages = 0;
  pageMap.forEach((chars, idx) => {
    const pages = idx === spineIndex ? safeChapterPages : estimateChapterPagesFromChars(chars);
    if (idx < spineIndex) {
      beforePages += pages;
    }
    totalPages += pages;
  });

  if (spineIndex >= pageMap.length) {
    beforePages = totalPages;
    totalPages += safeChapterPages;
  }

  return {
    chapterStartGlobalPage: beforePages + 1,
    currentGlobalPage: beforePages + clampedPageInChapter + 1,
    totalGlobalPages: Math.max(1, totalPages),
  };
}

export function resolveGlobalPageTarget(
  pageMap: number[],
  targetGlobalPage: number,
): { spineIndex: number; fractionInChapter: number; pageIndexInChapter: number } {
  if (pageMap.length === 0) {
    const idx = Math.max(0, Math.floor(targetGlobalPage) - 1);
    return { spineIndex: idx, fractionInChapter: 0, pageIndexInChapter: 0 };
  }

  const totalPages = pageMap.reduce((sum, c) => sum + estimateChapterPagesFromChars(c), 0);
  const target = Math.max(1, Math.min(Math.max(1, totalPages), Math.floor(targetGlobalPage)));

  let cursor = 0;
  for (let i = 0; i < pageMap.length; i += 1) {
    const chPages = estimateChapterPagesFromChars(pageMap[i] ?? 1);
    if (target <= cursor + chPages || i === pageMap.length - 1) {
      const localIdx = Math.max(0, Math.min(chPages - 1, target - cursor - 1));
      return {
        spineIndex: i,
        fractionInChapter: chPages > 1 ? localIdx / chPages : 0,
        pageIndexInChapter: localIdx,
      };
    }
    cursor += chPages;
  }

  return { spineIndex: 0, fractionInChapter: 0, pageIndexInChapter: 0 };
}

export function computeTtsGlobalPage(
  pageMap: number[],
  ttsSpineIndex: number,
  ttsCharOffset: number,
): number {
  let before = 0;
  for (let i = 0; i < Math.min(ttsSpineIndex, pageMap.length); i += 1) {
    before += estimateChapterPagesFromChars(pageMap[i] ?? 1);
  }
  const within = Math.floor(Math.max(0, ttsCharOffset) / CHARS_PER_STANDARD_PAGE);
  return before + within + 1;
}
