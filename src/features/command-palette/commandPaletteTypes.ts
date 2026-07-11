import type { ReactNode } from "react";
import type {
  WorkspaceActionCatalog,
  WorkspaceActionConfirmation,
  WorkspaceActionContext,
  WorkspaceActionDescriptor,
  WorkspaceActionExecutor,
  WorkspaceActionRegistry,
} from "../workspace-actions";

/** Command Palette 对动作描述补充的纯展示元数据，不拥有动作定义。 */
export interface CommandPaletteActionPresentation {
  category?: string;
  scope?: string;
  keybinding?: string;
  keywords?: readonly string[];
  leading?: ReactNode;
}

/** Palette 查询后交给 overlay shell 的动作视图模型。 */
export interface CommandPaletteActionItem<TId extends string = string> {
  category?: string;
  disabled: boolean;
  disabledReason?: string;
  effect: WorkspaceActionDescriptor["effect"];
  id: TId;
  keybinding?: string;
  leading?: ReactNode;
  score: number;
  scope?: string;
  title: string;
}

/** 动作执行期间向用户公开的稳定反馈。 */
export type CommandPaletteExecutionFeedback =
  | { kind: "idle" }
  | { kind: "running"; actionId: string }
  | { kind: "success"; actionId: string; message: string }
  | { kind: "info"; actionId: string; message: string }
  | { kind: "error"; actionId: string; message: string };

/** Command Palette 的依赖全部由应用组合层注入。 */
export interface CommandPaletteProps<
  TCatalog extends WorkspaceActionCatalog = WorkspaceActionCatalog,
> {
  context: WorkspaceActionContext;
  executor: WorkspaceActionExecutor;
  getPayload: <TId extends keyof TCatalog & string>(
    descriptor: WorkspaceActionDescriptor<TId, TCatalog[TId]>,
  ) => TCatalog[TId];
  getPresentation?: <TId extends keyof TCatalog & string>(
    descriptor: WorkspaceActionDescriptor<TId, TCatalog[TId]>,
  ) => CommandPaletteActionPresentation | undefined;
  onClose: () => void;
  onConfirmationRequired: (confirmation: WorkspaceActionConfirmation) => void;
  onOpenTool: (toolId: string, payload?: unknown) => void;
  open: boolean;
  registry: WorkspaceActionRegistry<TCatalog>;
  title?: string;
}
