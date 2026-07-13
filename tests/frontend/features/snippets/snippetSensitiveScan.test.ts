import { describe, expect, it } from "vitest";
import { scanSnippetSensitiveLiterals } from "../../../../src/features/snippets/snippetSensitiveScan";

describe("scanSnippetSensitiveLiterals", () => {
  it("blocks common literal credential shapes without returning their values", () => {
    const findings = scanSnippetSensitiveLiterals(
      "curl -H 'Authorization: Bearer abcdefghijklmnop' https://example.com && password=super-secret",
    );

    expect(findings).toEqual(["bearerToken", "credentialAssignment"]);
    expect(JSON.stringify(findings)).not.toContain("super-secret");
  });

  it("allows typed placeholders instead of treating their names as secrets", () => {
    expect(
      scanSnippetSensitiveLiterals(
        "curl -H 'Authorization: Bearer {{ token }}' --data password={{ password }} https://example.com",
      ),
    ).toEqual([]);
  });

  it("detects private key and provider token literals", () => {
    expect(
      scanSnippetSensitiveLiterals(
        "-----BEGIN PRIVATE KEY-----\nbody\n-----END PRIVATE KEY-----\nkey=sk-abcdefghijklmnop",
      ),
    ).toEqual(["privateKey", "providerToken"]);
  });
});
