import { isTauri } from "@tauri-apps/api/core";
import type { MenuOptions } from "@tauri-apps/api/menu";

export interface NativePopupMenuItem<Action extends string> {
  action: Action;
  disabled?: boolean;
  label: string;
  shortcut?: string;
}

export interface NativePopupMenuOptions<Action extends string> {
  groups: NativePopupMenuItem<Action>[][];
  onAction: (action: Action) => void;
  x: number;
  y: number;
}

export function canShowNativePopupMenu(): boolean {
  return isTauri();
}

export async function showNativePopupMenu<Action extends string>({
  groups,
  onAction,
  x,
  y,
}: NativePopupMenuOptions<Action>): Promise<boolean> {
  if (!canShowNativePopupMenu()) {
    return false;
  }

  try {
    const [{ LogicalPosition }, { Menu }] = await Promise.all([
      import("@tauri-apps/api/dpi"),
      import("@tauri-apps/api/menu"),
    ]);
    const menu = await Menu.new({
      items: nativePopupMenuItems(groups, onAction),
    });
    await menu.popup(new LogicalPosition(x, y));
    window.setTimeout(() => {
      void menu.close().catch(() => undefined);
    }, 0);
    return true;
  } catch {
    return false;
  }
}

function nativePopupMenuItems<Action extends string>(
  groups: NativePopupMenuItem<Action>[][],
  onAction: (action: Action) => void,
): NonNullable<MenuOptions["items"]> {
  const menuIdPrefix = `kerminal-context-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
  return groups.flatMap((group, groupIndex) => [
    ...(groupIndex > 0 ? [{ item: "Separator" as const }] : []),
    ...group.map((item, itemIndex) => ({
      action: () => onAction(item.action),
      accelerator: item.shortcut,
      enabled: item.disabled !== true,
      id: `${menuIdPrefix}-${groupIndex}-${itemIndex}-${item.action}`,
      text: item.label,
    })),
  ]);
}
