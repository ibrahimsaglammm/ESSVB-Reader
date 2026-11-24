import { en } from "./en";
import { tr, type TranslationKey } from "./tr";
import type { AppLanguage } from "../types/models";

const DICTIONARIES: Record<AppLanguage, Record<TranslationKey, string>> = { tr, en };

export function translate(
  lang: AppLanguage,
  key: TranslationKey,
  vars?: Record<string, string | number>,
): string {
  const dict = DICTIONARIES[lang] ?? DICTIONARIES.tr;
  let text = dict[key] ?? DICTIONARIES.tr[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replaceAll(`{{${k}}}`, String(v));
    }
  }
  return text;
}
