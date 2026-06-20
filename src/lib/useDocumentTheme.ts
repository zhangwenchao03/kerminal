import { useEffect } from "react";

type DocumentTheme = "dark" | "light";

interface DocumentThemeAttributes {
  density?: string;
  language?: string;
  lang?: string;
  theme: DocumentTheme;
}

export function useDocumentTheme({
  density,
  language,
  lang,
  theme,
}: DocumentThemeAttributes) {
  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }

    const root = document.documentElement;
    const previousDark = root.classList.contains("dark");
    const previousTheme = root.getAttribute("data-theme");
    const previousDensity = root.getAttribute("data-density");
    const previousLanguage = root.getAttribute("data-language");
    const previousLang = root.getAttribute("lang");

    root.classList.toggle("dark", theme === "dark");
    setOptionalAttribute(root, "data-theme", theme);
    setOptionalAttribute(root, "data-density", density);
    setOptionalAttribute(root, "data-language", language);
    setOptionalAttribute(root, "lang", lang);

    return () => {
      root.classList.toggle("dark", previousDark);
      restoreAttribute(root, "data-theme", previousTheme);
      restoreAttribute(root, "data-density", previousDensity);
      restoreAttribute(root, "data-language", previousLanguage);
      restoreAttribute(root, "lang", previousLang);
    };
  }, [density, language, lang, theme]);
}

function setOptionalAttribute(
  element: HTMLElement,
  name: string,
  value: string | undefined,
) {
  if (value) {
    element.setAttribute(name, value);
    return;
  }
  element.removeAttribute(name);
}

function restoreAttribute(
  element: HTMLElement,
  name: string,
  value: string | null,
) {
  if (value === null) {
    element.removeAttribute(name);
    return;
  }
  element.setAttribute(name, value);
}
