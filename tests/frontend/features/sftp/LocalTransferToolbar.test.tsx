/**
 * @author kongweiguang
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { LocalDirectoryListing } from "../../../../src/lib/fileDialogApi";
import { LocalTransferToolbar } from "../../../../src/features/sftp/LocalTransferToolbar";

const listing: LocalDirectoryListing = {
  entries: [],
  parentPath: "C:\\Users",
  path: "C:\\Users\\24052",
};

const summary = {
  directoryCount: 1,
  fileCount: 2,
  label: "3 项 / 1 目录 / 2 文件",
  otherCount: 0,
  symlinkCount: 0,
  totalCount: 3,
};

describe("LocalTransferToolbar", () => {
  it("exposes the hidden-entry eye toggle for the local pane", async () => {
    const user = userEvent.setup();
    const onToggleHiddenEntries = vi.fn();

    render(
      <LocalTransferToolbar
        directorySummary={summary}
        entryFilter="all"
        listing={listing}
        loading={false}
        onCreateDirectory={vi.fn()}
        onEntryFilterChange={vi.fn()}
        onLoadDirectory={vi.fn()}
        onOpenCurrentDirectory={vi.fn()}
        onToggleHiddenEntries={onToggleHiddenEntries}
        showHiddenEntries
      />,
    );

    const toggle = screen.getByRole("button", { name: "隐藏隐藏项目" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    await user.click(toggle);

    expect(onToggleHiddenEntries).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("group", { name: "本地列表筛选" })).toBeInTheDocument();
  });
});
