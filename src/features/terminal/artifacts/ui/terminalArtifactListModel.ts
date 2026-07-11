// @author kongweiguang

export type TerminalArtifactListKeyboardCommand =
  | { type: "none" }
  | { index: number; type: "focus" }
  | { index: number; type: "invoke" };

/** 纯键盘模型支持窄栏中的循环导航和主动作触发。 */
export function resolveTerminalArtifactListKeyboardCommand(input: {
  currentIndex: number;
  itemCount: number;
  key: string;
}): TerminalArtifactListKeyboardCommand {
  if (input.itemCount === 0) {
    return { type: "none" };
  }
  switch (input.key) {
    case "ArrowDown":
      return {
        index: (Math.max(input.currentIndex, -1) + 1) % input.itemCount,
        type: "focus",
      };
    case "ArrowUp":
      return {
        index:
          (input.currentIndex <= 0 ? input.itemCount : input.currentIndex) - 1,
        type: "focus",
      };
    case "Home":
      return { index: 0, type: "focus" };
    case "End":
      return { index: input.itemCount - 1, type: "focus" };
    case "Enter":
    case " ":
      return {
        index: Math.max(0, input.currentIndex),
        type: "invoke",
      };
    default:
      return { type: "none" };
  }
}
