import { describe, expect, it } from "vitest";
import {
  buildUserFacingError,
  redactSensitiveTechnicalDetail,
  technicalDetailFromUnknown,
} from "../../../src/lib/userFacingMessage";

describe("userFacingMessage", () => {
  it("keeps raw failures out of the default user summary", () => {
    const message = buildUserFacingError(
      new Error("managed session failed at C:\\private\\runtime.json"),
      {
        recoveryAction: "请重试连接。",
        title: "连接失败",
      },
    );

    expect(message.title).toBe("连接失败");
    expect(message.recoveryAction).toBe("请重试连接。");
    expect(message.technicalDetail).toContain("managed session failed");
    expect(message.title).not.toContain("managed session");
  });

  it("redacts common credentials and private keys from technical details", () => {
    const detail = redactSensitiveTechnicalDetail(
      [
        "password=letmein token: abc123",
        '{"password": "json-secret", "api_key": "json-key", "access_token": "access-secret", "credential_secret": "credential-value", "inline_private_key": "inline-key"}',
        "Authorization: Bearer secret-token",
        '"proxy-authorization": "Bearer proxy-token"',
        "ssh://deploy:url-password@example.com:22",
        "-----BEGIN PRIVATE KEY-----",
        "private",
        "-----END PRIVATE KEY-----",
      ].join("\n"),
    );

    expect(detail).not.toContain("letmein");
    expect(detail).not.toContain("abc123");
    expect(detail).not.toContain("json-secret");
    expect(detail).not.toContain("json-key");
    expect(detail).not.toContain("access-secret");
    expect(detail).not.toContain("credential-value");
    expect(detail).not.toContain("inline-key");
    expect(detail).not.toContain("secret-token");
    expect(detail).not.toContain("proxy-token");
    expect(detail).not.toContain("url-password");
    expect(detail).not.toContain("\nprivate\n");
    expect(detail).toContain("[已隐藏]");
    expect(detail).toContain("[私钥内容已隐藏]");
  });

  it("does not create technical details for empty errors", () => {
    expect(technicalDetailFromUnknown(null)).toBeUndefined();
    expect(technicalDetailFromUnknown("   ")).toBeUndefined();
  });

  it("serializes structured failures for the details layer", () => {
    expect(technicalDetailFromUnknown({ code: "E_CONN", retryable: true })).toBe(
      '{\n  "code": "E_CONN",\n  "retryable": true\n}',
    );
  });

  it("redacts credentials after structured failures are serialized", () => {
    const detail = technicalDetailFromUnknown({
      nested: {
        password: "structured-secret",
        token: "structured-token",
      },
    });

    expect(detail).not.toContain("structured-secret");
    expect(detail).not.toContain("structured-token");
    expect(detail).toContain("[已隐藏]");
  });

  it("caps unusually long technical details", () => {
    const detail = technicalDetailFromUnknown(new Error("x".repeat(12_000)));

    expect(detail).toBeDefined();
    expect(detail?.length).toBeLessThanOrEqual(8_000);
  });
});
