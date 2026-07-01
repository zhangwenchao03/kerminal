import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { sftpApiMocks, sshMachine } from "../../support/sftp/SftpToolContent.testSupport.tsx";
import { SftpToolContent } from "../../../../src/features/sftp/SftpToolContent";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}

type TestListing = {
  entries: Array<Record<string, unknown>>;
  hostId: string;
  parentPath: string;
  path: string;
};

describe("SftpToolContent remote browser requests", () => {
  it("keeps the newest remote directory when an older request resolves last", async () => {
    render(<SftpToolContent selectedMachine={sshMachine} />);

    expect(await screen.findByText("var")).toBeInTheDocument();
    sftpApiMocks.listSftpDirectory.mockClear();

    const slowLogRequest = deferred<TestListing>();
    const fastAppRequest = deferred<TestListing>();
    sftpApiMocks.listSftpDirectory.mockImplementation(
      async ({ path }: { path: string }) => {
        if (path === "/var/log") {
          return slowLogRequest.promise;
        }
        if (path === "/srv/app") {
          return fastAppRequest.promise;
        }
        throw new Error(`Unexpected test path: ${path}`);
      },
    );

    const pathInput = screen.getByLabelText("当前远程路径");
    submitRemotePath(pathInput, "/var/log");
    await waitFor(() => {
      expect(hasSftpListCall("/var/log")).toBe(true);
    });

    submitRemotePath(pathInput, "/srv/app");
    await waitFor(() => {
      expect(hasSftpListCall("/srv/app")).toBe(true);
    });

    await act(async () => {
      fastAppRequest.resolve({
        entries: [
          {
            kind: "file",
            modified: "Jun 18 16:20",
            name: "release.sh",
            path: "/srv/app/release.sh",
            permissions: "-rwxr-xr-x",
            raw: "-rwxr-xr-x release.sh",
            size: 2048,
          },
        ],
        hostId: "prod-api",
        parentPath: "/srv",
        path: "/srv/app",
      });
      await fastAppRequest.promise;
    });
    expect(await screen.findByText("release.sh")).toBeInTheDocument();
    expect(pathInput).toHaveValue("/srv/app");

    await act(async () => {
      slowLogRequest.resolve({
        entries: [
          {
            kind: "file",
            modified: "Jun 18 16:00",
            name: "app.log",
            path: "/var/log/app.log",
            permissions: "-rw-r--r--",
            raw: "-rw-r--r-- app.log",
            size: 2048,
          },
        ],
        hostId: "prod-api",
        parentPath: "/var",
        path: "/var/log",
      });
      await slowLogRequest.promise;
    });

    await waitFor(() => {
      expect(screen.getByText("release.sh")).toBeInTheDocument();
      expect(screen.queryByText("app.log")).not.toBeInTheDocument();
      expect(pathInput).toHaveValue("/srv/app");
    });
  });
});

function submitRemotePath(pathInput: HTMLElement, path: string) {
  fireEvent.change(pathInput, { target: { value: path } });
  const pathForm = pathInput.closest("form");
  if (!pathForm) {
    throw new Error("Missing SFTP path form");
  }
  fireEvent.submit(pathForm);
}

function hasSftpListCall(path: string) {
  return sftpApiMocks.listSftpDirectory.mock.calls.some(([request]) => {
    if (!request || typeof request !== "object" || !("path" in request)) {
      return false;
    }
    return request.path === path;
  });
}
