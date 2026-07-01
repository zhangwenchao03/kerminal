/**
 * SFTP transfer view scope helper tests.
 *
 * @author kongweiguang
 */

import { describe, expect, it } from "vitest";
import {
  sftpSidebarTransferViewScope,
  sftpWorkbenchTransferViewScope,
  withSftpTransferViewScope,
} from "../../../../../src/features/sftp/sftp-tool-content/sftpTransferScopeModel";

describe("sftpTransferScopeModel", () => {
  it("keeps right-sidebar transfer history isolated by terminal tab and host", () => {
    expect(
      sftpSidebarTransferViewScope({
        hostId: "host-prod",
        tabId: "terminal-1",
      }),
    ).toBe("sftp-sidebar:terminal-1:host-prod");
    expect(
      sftpSidebarTransferViewScope({
        hostId: "host-prod",
        tabId: "terminal-2",
      }),
    ).toBe("sftp-sidebar:terminal-2:host-prod");
  });

  it("keeps each transfer workbench tab on its own queue view", () => {
    expect(
      sftpWorkbenchTransferViewScope({
        fallbackId: "fallback",
        workspaceTabId: "workbench-a",
      }),
    ).toBe("sftp-workbench:workbench-a");
    expect(
      sftpWorkbenchTransferViewScope({
        fallbackId: "fallback",
        workspaceTabId: " ",
      }),
    ).toBe("sftp-workbench:fallback");
  });

  it("only injects a view scope when the caller owns one", () => {
    const request: {
      hostId: string;
      remotePath: string;
      viewScope?: string | null;
    } = { hostId: "host-prod", remotePath: "/srv/app.log" };

    expect(withSftpTransferViewScope(request, undefined)).toBe(request);
    expect(withSftpTransferViewScope(request, null)).toEqual({
      hostId: "host-prod",
      remotePath: "/srv/app.log",
      viewScope: null,
    });
    expect(withSftpTransferViewScope(request, "sftp-workbench:tab-a")).toEqual({
      hostId: "host-prod",
      remotePath: "/srv/app.log",
      viewScope: "sftp-workbench:tab-a",
    });
  });
});
