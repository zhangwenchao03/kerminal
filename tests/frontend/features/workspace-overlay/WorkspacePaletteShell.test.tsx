import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  WorkspacePaletteShell,
  type WorkspacePaletteItem,
} from "../../../../src/features/workspace-overlay/WorkspacePaletteShell";

const items: WorkspacePaletteItem[] = [
  { id: "alpha", label: "Alpha", description: "第一个结果" },
  { id: "disabled", label: "Disabled", disabled: true },
  { id: "charlie", label: "Charlie" },
];

function renderPalette(
  overrides: Partial<React.ComponentProps<typeof WorkspacePaletteShell>> = {},
) {
  const props: React.ComponentProps<typeof WorkspacePaletteShell> = {
    items,
    onClose: vi.fn(),
    onQueryChange: vi.fn(),
    onSelect: vi.fn(),
    open: true,
    query: "",
    title: "工作区搜索",
    ...overrides,
  };
  return { ...render(<WorkspacePaletteShell {...props} />), props };
}

describe("WorkspacePaletteShell", () => {
  it("renders dialog, combobox and listbox semantics with a stable active descendant", () => {
    renderPalette();

    const dialog = screen.getByRole("dialog", { name: "工作区搜索" });
    const combobox = screen.getByRole("combobox", { name: "工作区搜索" });
    const options = screen.getAllByRole("option");

    expect(dialog).toHaveClass("h-[min(31rem,calc(100vh-5rem))]");
    expect(combobox).toHaveAttribute("aria-controls");
    expect(combobox).toHaveAttribute("aria-activedescendant", options[0].id);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(options[1]).toHaveAttribute("aria-disabled", "true");
    expect(combobox).toHaveFocus();
  });

  it("navigates enabled results and selects the active result", async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    const { props } = renderPalette();
    const combobox = screen.getByRole("combobox");

    await user.keyboard("{ArrowDown}");
    expect(combobox).toHaveAttribute(
      "aria-activedescendant",
      screen.getByRole("option", { name: "Charlie" }).id,
    );
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest" });
    await user.keyboard("{Enter}");

    expect(props.onSelect).toHaveBeenCalledWith(items[2]);
  });

  it("keeps the active item by stable id when results are reordered", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { rerender } = render(
      <WorkspacePaletteShell
        items={items}
        onClose={vi.fn()}
        onQueryChange={vi.fn()}
        onSelect={onSelect}
        open
        query=""
        title="工作区搜索"
      />,
    );

    await user.keyboard("{ArrowDown}");
    const reorderedItems = [items[2], items[0], items[1]];
    rerender(
      <WorkspacePaletteShell
        items={reorderedItems}
        onClose={vi.fn()}
        onQueryChange={vi.fn()}
        onSelect={onSelect}
        open
        query=""
        title="工作区搜索"
      />,
    );

    expect(screen.getByRole("option", { name: "Charlie" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith(items[2]);
  });

  it("falls back to the first enabled item when the active id disappears", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { rerender } = render(
      <WorkspacePaletteShell
        items={items}
        onClose={vi.fn()}
        onQueryChange={vi.fn()}
        onSelect={onSelect}
        open
        query=""
        title="工作区搜索"
      />,
    );

    await user.keyboard("{ArrowDown}");
    const replacementItems = [
      { id: "delta", label: "Delta" },
      { id: "echo", label: "Echo" },
    ];
    rerender(
      <WorkspacePaletteShell
        items={replacementItems}
        onClose={vi.fn()}
        onQueryChange={vi.fn()}
        onSelect={onSelect}
        open
        query=""
        title="工作区搜索"
      />,
    );

    expect(screen.getByRole("option", { name: "Delta" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith(replacementItems[0]);
  });

  it("guards composition, captures Escape, restores focus and removes listeners", () => {
    const origin = document.createElement("button");
    document.body.append(origin);
    origin.focus();
    const { props, unmount } = renderPalette();
    const combobox = screen.getByRole("combobox");

    fireEvent.keyDown(combobox, {
      isComposing: true,
      key: "Escape",
    });
    expect(props.onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(combobox, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);

    unmount();
    expect(origin).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);
    origin.remove();
  });

  it.each([
    ["loading", "正在加载结果"],
    ["partial", "结果仍在加载"],
    ["error", "无法加载结果"],
  ] as const)(
    "renders the %s state without changing panel dimensions",
    (status, text) => {
      renderPalette({
        items: status === "partial" ? items : [],
        status,
      });

      expect(screen.getByRole("dialog")).toHaveClass(
        "h-[min(31rem,calc(100vh-5rem))]",
      );
      expect(screen.getByText(text)).toBeInTheDocument();
    },
  );

  it("keeps Tab focus inside the portal panel", () => {
    renderPalette();
    const combobox = screen.getByRole("combobox");
    const closeButton = screen.getByRole("button", { name: "关闭" });

    closeButton.focus();
    fireEvent.keyDown(closeButton, { key: "Tab" });
    expect(combobox).toHaveFocus();

    fireEvent.keyDown(combobox, { key: "Tab", shiftKey: true });
    expect(closeButton).toHaveFocus();
  });

  it("keeps the original focus target when callback identities change", () => {
    const origin = document.createElement("button");
    document.body.append(origin);
    origin.focus();
    const firstClose = vi.fn();
    const { rerender, unmount } = render(
      <WorkspacePaletteShell
        items={items}
        onClose={firstClose}
        onQueryChange={vi.fn()}
        onSelect={vi.fn()}
        open
        query=""
        title="工作区搜索"
      />,
    );

    const latestClose = vi.fn();
    rerender(
      <WorkspacePaletteShell
        items={items}
        onClose={latestClose}
        onQueryChange={vi.fn()}
        onSelect={vi.fn()}
        open
        query=""
        title="工作区搜索"
      />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(firstClose).not.toHaveBeenCalled();
    expect(latestClose).toHaveBeenCalledTimes(1);

    unmount();
    expect(origin).toHaveFocus();
    origin.remove();
  });
});
