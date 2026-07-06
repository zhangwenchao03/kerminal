// @author kongweiguang

export type RemoteWorkspaceEditorCommandId =
  | "undo"
  | "redo"
  | "cut"
  | "copy"
  | "paste"
  | "selectAll"
  | "find"
  | "replace"
  | "reload"
  | "save";

export type RemoteWorkspaceEditorCommandIcon =
  | "clipboardPaste"
  | "copy"
  | "fileText"
  | "redo"
  | "refresh"
  | "save"
  | "scissors"
  | "search"
  | "undo";

export interface RemoteWorkspaceEditorCommandState {
  dirty: boolean;
  hasConflict: boolean;
  hasEditor: boolean;
  hasSelection?: boolean;
  loading: boolean;
  readOnly: boolean;
  saving: boolean;
}

export interface RemoteWorkspaceEditorCommandItem {
  disabled: boolean;
  icon: RemoteWorkspaceEditorCommandIcon;
  id: RemoteWorkspaceEditorCommandId;
  label: string;
  shortcut: string;
}

export function buildRemoteWorkspaceEditorCommandGroups(
  state: RemoteWorkspaceEditorCommandState,
): RemoteWorkspaceEditorCommandItem[][] {
  return [
    [
      commandItem("undo", "撤销", "Ctrl+Z", "undo", editorCommandDisabled(state)),
      commandItem(
        "redo",
        "重做",
        "Ctrl+Y / Ctrl+Shift+Z",
        "redo",
        editorCommandDisabled(state),
      ),
    ],
    [
      commandItem(
        "cut",
        "剪切",
        "Ctrl+X",
        "scissors",
        writeCommandDisabled(state),
      ),
      commandItem(
        "copy",
        "复制",
        "Ctrl+C",
        "copy",
        editorCommandDisabled(state),
      ),
      commandItem(
        "paste",
        "粘贴",
        "Ctrl+V / Shift+Insert",
        "clipboardPaste",
        writeCommandDisabled(state),
      ),
      commandItem(
        "selectAll",
        "全选",
        "Ctrl+A",
        "fileText",
        editorCommandDisabled(state),
      ),
    ],
    [
      commandItem(
        "find",
        "查找",
        "Ctrl+F",
        "search",
        editorCommandDisabled(state),
      ),
      commandItem(
        "replace",
        "替换",
        "Ctrl+H",
        "search",
        writeCommandDisabled(state),
      ),
    ],
    [
      commandItem(
        "reload",
        "重新加载",
        "",
        "refresh",
        !state.hasEditor || state.loading || state.saving,
      ),
      commandItem(
        "save",
        state.hasConflict ? "覆盖保存" : "保存",
        "Ctrl+S",
        "save",
        saveCommandDisabled(state),
      ),
    ],
  ];
}

export function isRemoteWorkspaceEditorCommandEnabled(
  id: RemoteWorkspaceEditorCommandId,
  state: RemoteWorkspaceEditorCommandState,
) {
  return buildRemoteWorkspaceEditorCommandGroups(state)
    .flat()
    .some((item) => item.id === id && !item.disabled);
}

function editorCommandDisabled(state: RemoteWorkspaceEditorCommandState) {
  return !state.hasEditor || state.loading;
}

function writeCommandDisabled(state: RemoteWorkspaceEditorCommandState) {
  return editorCommandDisabled(state) || state.readOnly || state.saving;
}

function saveCommandDisabled(state: RemoteWorkspaceEditorCommandState) {
  return (
    writeCommandDisabled(state) ||
    (!state.dirty && !state.hasConflict)
  );
}

function commandItem(
  id: RemoteWorkspaceEditorCommandId,
  label: string,
  shortcut: string,
  icon: RemoteWorkspaceEditorCommandIcon,
  disabled: boolean,
): RemoteWorkspaceEditorCommandItem {
  return {
    disabled,
    icon,
    id,
    label,
    shortcut,
  };
}

export function resolveRemoteWorkspaceEditorContextMenuPosition({
  menuHeight = 324,
  menuWidth = 240,
  viewportHeight,
  viewportWidth,
  x,
  y,
}: {
  menuHeight?: number;
  menuWidth?: number;
  viewportHeight: number;
  viewportWidth: number;
  x: number;
  y: number;
}) {
  const margin = 8;
  if (
    menuWidth <= 0 ||
    menuHeight <= 0 ||
    viewportWidth <= 0 ||
    viewportHeight <= 0
  ) {
    return { x, y };
  }

  return {
    x: Math.max(margin, Math.min(x, viewportWidth - menuWidth - margin)),
    y: Math.max(margin, Math.min(y, viewportHeight - menuHeight - margin)),
  };
}
