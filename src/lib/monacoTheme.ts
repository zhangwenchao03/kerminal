export function configureKerminalMonaco(
  monaco: typeof import("monaco-editor"),
) {
  monaco.editor.defineTheme("kerminal-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { foreground: "f8fafc", token: "" },
      { foreground: "38bdf8", token: "keyword" },
      { foreground: "f59e0b", token: "string" },
      { foreground: "34d399", token: "number" },
      { foreground: "94a3b8", token: "comment" },
    ],
    colors: {
      "editor.background": "#09090b",
      "editor.findMatchBackground": "#0ea5e966",
      "editor.lineHighlightBackground": "#18181b",
      "editor.selectionBackground": "#2563eb80",
    },
  });
}
