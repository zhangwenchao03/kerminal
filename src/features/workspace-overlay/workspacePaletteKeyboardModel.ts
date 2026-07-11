/** Palette 键盘模型可返回的稳定命令，由视图层负责执行副作用。 */
export type WorkspacePaletteKeyboardCommand =
  | { type: "activate"; index: number }
  | { type: "close" }
  | { type: "none" }
  | { type: "select"; index: number };

export interface WorkspacePaletteKeyboardInput {
  activeIndex: number;
  itemCount: number;
  key: string;
}

/**
 * 将按键解析为纯命令，确保列表导航、选择和关闭规则可以脱离 DOM 测试。
 * IME composition 在事件边界被拦截，不会进入该模型。
 */
export function resolveWorkspacePaletteKeyboardCommand({
  activeIndex,
  itemCount,
  key,
}: WorkspacePaletteKeyboardInput): WorkspacePaletteKeyboardCommand {
  if (key === "Escape") {
    return { type: "close" };
  }
  if (itemCount <= 0) {
    return { type: "none" };
  }

  switch (key) {
    case "ArrowDown":
      return {
        type: "activate",
        index: activeIndex < 0 ? 0 : (activeIndex + 1) % itemCount,
      };
    case "ArrowUp":
      return {
        type: "activate",
        index:
          activeIndex < 0
            ? itemCount - 1
            : (activeIndex - 1 + itemCount) % itemCount,
      };
    case "Home":
      return { type: "activate", index: 0 };
    case "End":
      return { type: "activate", index: itemCount - 1 };
    case "Enter":
      return activeIndex >= 0 && activeIndex < itemCount
        ? { type: "select", index: activeIndex }
        : { type: "none" };
    default:
      return { type: "none" };
  }
}
