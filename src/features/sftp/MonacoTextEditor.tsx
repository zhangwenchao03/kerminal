import type * as Monaco from "monaco-editor";
import * as monaco from "monaco-editor";
import { useEffect, useRef } from "react";
import "../../lib/monacoSetup";
import {
  installMonacoHoverGuard,
  installMonacoHoverPlacementGuard,
} from "./monacoHoverGuard";

export type MonacoTextEditorMountHandler = (
  editor: Monaco.editor.IStandaloneCodeEditor,
  monacoApi: typeof Monaco,
) => void;

export function MonacoTextEditor({
  beforeMount,
  className,
  height = "100%",
  language,
  onChange,
  onMount,
  options,
  path,
  theme,
  value = "",
}: {
  beforeMount?: (monacoApi: typeof Monaco) => void;
  className?: string;
  height?: number | string;
  language?: string;
  onChange?: (value: string) => void;
  onMount?: MonacoTextEditorMountHandler;
  options?: Monaco.editor.IStandaloneEditorConstructionOptions;
  path: string;
  theme?: string;
  value?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelsRef = useRef<Map<string, Monaco.editor.ITextModel>>(new Map());
  const onChangeRef = useRef(onChange);
  const onMountRef = useRef(onMount);
  const suppressChangeRef = useRef(false);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onMountRef.current = onMount;
  }, [onMount]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    beforeMount?.(monaco);
    const hoverPlacementDisposable = installMonacoHoverPlacementGuard(container);
    const model = getOrCreateModel(modelsRef.current, path, language, value);
    let editor: Monaco.editor.IStandaloneCodeEditor;
    try {
      editor = monaco.editor.create(container, {
        ...options,
        model,
        ...(theme ? { theme } : {}),
      });
    } catch (error) {
      hoverPlacementDisposable.dispose();
      throw error;
    }
    editorRef.current = editor;
    const changeDisposable = editor.onDidChangeModelContent(() => {
      if (suppressChangeRef.current) {
        return;
      }
      onChangeRef.current?.(editor.getValue());
    });
    const hoverGuardDisposable = installMonacoHoverGuard({ container, editor });
    onMountRef.current?.(editor, monaco);

    return () => {
      changeDisposable.dispose();
      hoverGuardDisposable.dispose();
      hoverPlacementDisposable.dispose();
      editor.dispose();
      for (const textModel of modelsRef.current.values()) {
        textModel.dispose();
      }
      modelsRef.current.clear();
      editorRef.current = null;
    };
    // The Monaco editor instance is intentionally created once per wrapper mount.
    // Reactive props are synchronized by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    const model = getOrCreateModel(modelsRef.current, path, language, value);
    if (editor.getModel() !== model) {
      editor.setModel(model);
    }
    if (language) {
      monaco.editor.setModelLanguage(model, language);
    }
    if (model.getValue() !== value) {
      suppressChangeRef.current = true;
      model.setValue(value);
      suppressChangeRef.current = false;
    }
  }, [language, path, value]);

  useEffect(() => {
    editorRef.current?.updateOptions(options ?? {});
  }, [options]);

  useEffect(() => {
    if (theme) {
      monaco.editor.setTheme(theme);
    }
  }, [theme]);

  return (
    <div
      className={className}
      ref={containerRef}
      style={{ height, minHeight: 0, width: "100%" }}
    />
  );
}

function getOrCreateModel(
  models: Map<string, Monaco.editor.ITextModel>,
  path: string,
  language: string | undefined,
  value: string,
) {
  const existingModel = models.get(path);
  if (existingModel) {
    return existingModel;
  }
  const model = monaco.editor.createModel(value, language);
  models.set(path, model);
  return model;
}
