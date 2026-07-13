export type SnippetSensitiveFinding =
  | "privateKey"
  | "bearerToken"
  | "credentialAssignment"
  | "providerToken";

/**
 * 保存前只返回敏感类别，不返回命中的原文，避免错误态和诊断再次泄露凭据。
 */
export function scanSnippetSensitiveLiterals(
  command: string,
): readonly SnippetSensitiveFinding[] {
  const value = command.replace(/\{\{\s*[A-Za-z][A-Za-z0-9_]*\s*\}\}/g, "[variable]");
  const findings = new Set<SnippetSensitiveFinding>();
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(value)) {
    findings.add("privateKey");
  }
  if (/\bBearer\s+(?!\[variable\])[^\s'";]{8,}/i.test(value)) {
    findings.add("bearerToken");
  }
  if (
    /\b(password|passwd|token|api[_-]?key|secret|key[_-]?passphrase)\s*[:=]\s*(?!\[variable\])[^\s'";,]{4,}/i.test(
      value,
    )
  ) {
    findings.add("credentialAssignment");
  }
  if (/\b(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{12,}\b/.test(value)) {
    findings.add("providerToken");
  }
  return [...findings];
}
