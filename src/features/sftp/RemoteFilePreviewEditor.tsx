import Editor from "@monaco-editor/react";
import "../../lib/monacoSetup";
import { configureKerminalMonaco } from "../../lib/monacoTheme";
import { languageForPath } from "./remoteWorkspaceEditorModel";

export function RemoteFilePreviewEditor({
  content,
  path,
}: {
  content: string;
  path: string;
}) {
  return (
    <Editor
      beforeMount={configureKerminalMonaco}
      height="100%"
      language={languageForPath(path)}
      options={{
        automaticLayout: true,
        domReadOnly: true,
        fontFamily: "JetBrains Mono, SFMono-Regular, Consolas, monospace",
        fontSize: 12,
        lineNumbers: "on",
        minimap: { enabled: false },
        padding: { bottom: 10, top: 10 },
        readOnly: true,
        renderLineHighlight: "none",
        scrollBeyondLastLine: false,
        tabSize: 2,
        wordWrap: "on",
      }}
      path={`preview:${path}`}
      theme="kerminal-dark"
      value={content}
    />
  );
}
