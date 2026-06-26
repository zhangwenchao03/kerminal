import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalDirectoryListing } from "../../lib/fileDialogApi";
import type { Machine } from "../workspace/types";
import { LocalTransferPane } from "./LocalTransferPane";
import { SFTP_LOCAL_FILE_DRAG_PAYLOAD_MIME } from "./sftp-tool-content/sftpLocalUploadDropModel";

const fileDialogApiMock = vi.hoisted(() => ({
  listLocalDirectory: vi.fn(),
  openLocalDirectory: vi.fn(),
  selectLocalDirectory: vi.fn(),
}));

const sftpApiMock = vi.hoisted(() => ({
  enqueueSftpTransfer: vi.fn(),
}));

const localFilesApiMock = vi.hoisted(() => ({
  copyLocalPath: vi.fn(),
  createLocalDirectory: vi.fn(),
  deleteLocalPath: vi.fn(),
  renameLocalPath: vi.fn(),
}));

vi.mock("../../lib/fileDialogApi", () => ({
  listLocalDirectory: fileDialogApiMock.listLocalDirectory,
  openLocalDirectory: fileDialogApiMock.openLocalDirectory,
  selectLocalDirectory: fileDialogApiMock.selectLocalDirectory,
}));

vi.mock("../../lib/sftpApi", () => ({
  enqueueSftpTransfer: sftpApiMock.enqueueSftpTransfer,
}));

vi.mock("../../lib/localFilesApi", () => ({
  copyLocalPath: localFilesApiMock.copyLocalPath,
  createLocalDirectory: localFilesApiMock.createLocalDirectory,
  deleteLocalPath: localFilesApiMock.deleteLocalPath,
  renameLocalPath: localFilesApiMock.renameLocalPath,
}));

const targetMachine: Machine = {
  description: "root@example.internal:22",
  id: "host-right",
  kind: "ssh",
  name: "right",
  status: "offline",
  tags: ["ssh"],
};

describe("LocalTransferPane virtual list", () => {
  beforeEach(() => {
    fileDialogApiMock.listLocalDirectory.mockReset();
    fileDialogApiMock.openLocalDirectory.mockReset();
    fileDialogApiMock.selectLocalDirectory.mockReset();
    sftpApiMock.enqueueSftpTransfer.mockReset();
    localFilesApiMock.copyLocalPath.mockReset();
    localFilesApiMock.createLocalDirectory.mockReset();
    localFilesApiMock.deleteLocalPath.mockReset();
    localFilesApiMock.renameLocalPath.mockReset();
    fileDialogApiMock.openLocalDirectory.mockResolvedValue(undefined);
    fileDialogApiMock.selectLocalDirectory.mockResolvedValue(null);
    sftpApiMock.enqueueSftpTransfer.mockResolvedValue({ id: "transfer-1" });
  });

  it("virtualizes large local directories while preserving scrolled row drag payloads", async () => {
    const listing = buildLocalListing(500);
    fileDialogApiMock.listLocalDirectory.mockResolvedValueOnce(listing);
    const { container } = render(
      <LocalTransferPane
        active
        targetMachine={targetMachine}
        targetPath="/srv/app"
      />,
    );

    expect(await screen.findByRole("button", { name: "文件 local-0000" })).toBeInTheDocument();
    const localList = screen.getByTestId("sftp-local-entry-list");

    expect(localList).toHaveAttribute("data-virtualized", "true");
    expect(localList).toHaveAttribute("data-row-height", "44");
    expect(container.querySelectorAll("[data-local-entry-row]").length).toBeLessThan(80);

    localList.scrollTop = 44 * 250;
    fireEvent.scroll(localList);
    const middleFile = await screen.findByRole("button", { name: "文件 local-0250" });
    const middleRow = middleFile.closest("[data-local-entry-row]");
    if (!middleRow) {
      throw new Error("Expected scrolled local entry row");
    }

    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(middleRow, { dataTransfer });

    expect(dataTransfer.effectAllowed).toBe("copy");
    expect(dataTransfer.getData("text/plain")).toBe(listing.entries[250].path);
    expect(
      JSON.parse(dataTransfer.getData(SFTP_LOCAL_FILE_DRAG_PAYLOAD_MIME)),
    ).toEqual({
      entries: [listing.entries[250]],
      source: "local",
    });
    expect(container.querySelectorAll("[data-local-entry-row]").length).toBeLessThan(80);
  });

  it("uses tighter row rhythm in compact density", async () => {
    fileDialogApiMock.listLocalDirectory.mockResolvedValueOnce(
      buildLocalListing(120),
    );
    render(
      <LocalTransferPane
        active
        interfaceDensity="compact"
        targetMachine={targetMachine}
        targetPath="/srv/app"
      />,
    );

    await screen.findByRole("button", { name: "文件 local-0000" });

    expect(screen.getByTestId("sftp-local-entry-list")).toHaveAttribute(
      "data-row-height",
      "36",
    );
  });
});

function buildLocalListing(count: number): LocalDirectoryListing {
  return {
    entries: Array.from({ length: count }, (_, index) => ({
      kind: "file",
      name: `local-${index.toString().padStart(4, "0")}`,
      path: `C:\\\\Users\\\\24052\\\\local-${index.toString().padStart(4, "0")}`,
      raw: `file C:\\\\Users\\\\24052\\\\local-${index.toString().padStart(4, "0")}`,
      size: 2048 + index,
    })),
    parentPath: "C:\\\\Users",
    path: "C:\\\\Users\\\\24052",
  };
}

function createDataTransfer() {
  const store = new Map<string, string>();
  return {
    dropEffect: "none",
    effectAllowed: "none",
    getData: (type: string) => store.get(type) ?? "",
    setData: (type: string, value: string) => {
      store.set(type, value);
    },
    get types() {
      return Array.from(store.keys());
    },
  } as unknown as DataTransfer;
}
