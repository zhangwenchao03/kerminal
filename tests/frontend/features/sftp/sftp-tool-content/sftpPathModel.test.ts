/**
 * SFTP 路径与错误文本模型测试。
 *
 * @author kongweiguang
 */

import { describe, expect, it } from "vitest";
import { errorMessage } from "../../../../../src/features/sftp/sftp-tool-content/sftpPathModel";

describe("sftpPathModel errorMessage", () => {
  it("keeps diagnostic context while redacting credentials", () => {
    const detail = errorMessage(
      new Error(
        "connection failed password=path-secret sftp://deploy:url-secret@host/private",
      ),
    );

    expect(detail).toContain("connection failed");
    expect(detail).toContain('password="[已隐藏]"');
    expect(detail).toContain("sftp://deploy:[已隐藏]@host/private");
    expect(detail).not.toContain("path-secret");
    expect(detail).not.toContain("url-secret");
  });

  it("serializes structured failures and provides an empty fallback", () => {
    const detail = errorMessage({
      reason: "denied",
      token: "structured-secret",
    });

    expect(detail).toContain('"reason": "denied"');
    expect(detail).toContain('"token": "[已隐藏]"');
    expect(detail).not.toContain("structured-secret");
    expect(errorMessage(null)).toBe("未知错误");
  });
});
