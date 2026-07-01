/**
 * @author kongweiguang
 */

import { describe, expect, it } from "vitest";
import {
  SFTP_LOCAL_TO_LOCAL_DROP_UNSUPPORTED_MESSAGE,
  SFTP_LOCAL_TO_NON_SSH_DROP_UNSUPPORTED_MESSAGE,
  sftpCannotDropStatus,
} from "../../../../../src/features/sftp/sftp-tool-content/sftpDropReasonModel";

describe("sftpDropReasonModel", () => {
  it("builds shared cannot-drop statuses", () => {
    expect(sftpCannotDropStatus("localFileToLocalPaneUnsupported")).toEqual({
      kind: "error",
      message: SFTP_LOCAL_TO_LOCAL_DROP_UNSUPPORTED_MESSAGE,
    });
    expect(sftpCannotDropStatus("localFileRequiresSshRemoteTarget")).toEqual({
      kind: "error",
      message: SFTP_LOCAL_TO_NON_SSH_DROP_UNSUPPORTED_MESSAGE,
    });
  });
});
