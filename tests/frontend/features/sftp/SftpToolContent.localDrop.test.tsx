/**
 * @author kongweiguang
 */

import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  sftpApiMocks,
  sshMachine,
  webviewMocks,
} from "../../support/sftp/SftpToolContent.testSupport.tsx";
import { SftpToolContent } from "../../../../src/features/sftp/SftpToolContent";

describe("SftpToolContent local upload drop observer", () => {
  it("ignores local file drops outside the SFTP drop zone", async () => {
    const dragDropHandlers: Array<(event: { payload: unknown }) => void> = [];
    mockTauriDropObserver(dragDropHandlers);

    render(<SftpToolContent selectedMachine={sshMachine} />);

    await screen.findByText("var");
    await waitFor(() =>
      expect(webviewMocks.onDragDropEvent).toHaveBeenCalled(),
    );
    const dropZone = screen.getByTestId("sftp-drop-zone");
    setDropZoneRect(dropZone);

    dragDropHandlers[0]({
      payload: {
        paths: ["C:/tmp/release.tgz"],
        position: { x: 500, y: 500 },
        type: "drop",
      },
    });

    expect(sftpApiMocks.classifySftpLocalPaths).not.toHaveBeenCalled();
    expect(sftpApiMocks.enqueueSftpTransfer).not.toHaveBeenCalled();
    expect(screen.queryByText(/释放以上传到/)).not.toBeInTheDocument();
  });

  it("shows a clear error when local drop listener registration fails", async () => {
    mockTauriEnvironment();
    webviewMocks.onDragDropEvent.mockRejectedValue(new Error("blocked"));

    render(<SftpToolContent selectedMachine={sshMachine} />);

    await screen.findByText("var");
    expect(
      await screen.findByText("拖拽上传监听失败：blocked"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/释放以上传到/)).not.toBeInTheDocument();
  });
});

function mockTauriDropObserver(
  dragDropHandlers: Array<(event: { payload: unknown }) => void>,
) {
  mockTauriEnvironment();
  webviewMocks.onDragDropEvent.mockImplementation(
    async (handler: (event: { payload: unknown }) => void) => {
      dragDropHandlers.push(handler);
      return () => undefined;
    },
  );
}

function mockTauriEnvironment() {
  (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ =
    {};
}

function setDropZoneRect(dropZone: HTMLElement) {
  dropZone.getBoundingClientRect = () =>
    ({
      bottom: 240,
      height: 220,
      left: 10,
      right: 430,
      top: 20,
      width: 420,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    }) as DOMRect;
}
