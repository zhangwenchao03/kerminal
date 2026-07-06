import { describe, expect, it } from "vitest";
import {
  isSftpBrowserMode,
  normalizeSftpBrowserMode,
} from "../../../../../src/features/sftp/sftp-tool-content/sftpBrowserModeModel";

describe("sftpBrowserModeModel", () => {
  it("normalizes browser mode values", () => {
    expect(normalizeSftpBrowserMode("tree")).toBe("tree");
    expect(normalizeSftpBrowserMode("workspace")).toBe("workspace");
    expect(normalizeSftpBrowserMode("unknown")).toBe("list");
    expect(isSftpBrowserMode("list")).toBe(true);
    expect(isSftpBrowserMode("grid")).toBe(false);
  });
});
