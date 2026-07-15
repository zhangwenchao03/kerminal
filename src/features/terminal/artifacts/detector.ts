// @author kongweiguang

import {
  artifactKindForPath,
  isAllowedTerminalArtifactUrl,
  resolveTerminalArtifactPathStyle,
} from "./policy";
import type { TerminalArtifactCandidate, TerminalArtifactRange } from "./types";

const ANSI_RE =
  // CSI、OSC 及单字符转义统一剥离；检测结果不得包含控制序列。
  new RegExp(
    String.raw`(?:\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b\[[0-?]*[ -/]*[@-~]|\u001b[@-_])`,
    "g",
  );
const WEB_URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const WINDOWS_PATH_RE =
  /\b[a-z]:[\\/](?:[^<>:"|?*\s\\/]+[\\/])*[^<>:"|?*\s\\/]*/gi;
const UNC_PATH_RE = /\\\\[^\\\s]+\\[^<>"|?*\s\r\n]+(?:\\[^<>"|?*\s\r\n]+)*/g;
const POSIX_PATH_RE =
  /(?:^|[\s("'`])((?:~\/|\/)(?:[^\s"'`<>|]+\/)*[^\s"'`<>|,;:]+)/g;
const OSC7_RE = new RegExp(
  String.raw`\u001b\]7;([^\u0007\u001b]+)(?:\u0007|\u001b\\)`,
  "g",
);
const OSC8_RE =
  new RegExp(
    String.raw`\u001b\]8;[^;]*;([^\u0007\u001b]*)(?:\u0007|\u001b\\)([\s\S]*?)\u001b\]8;;(?:\u0007|\u001b\\)`,
    "g",
  );

export function stripTerminalArtifactAnsi(value: string) {
  return value.replace(ANSI_RE, "");
}

/** 协议检测只处理当前事件载荷，不跨事件拼接，也不建立正文缓冲。 */
export function detectTerminalProtocolArtifacts(
  data: string,
): TerminalArtifactCandidate[] {
  const candidates: TerminalArtifactCandidate[] = [];
  for (const match of data.matchAll(OSC7_RE)) {
    const uri = match[1]?.trim();
    if (uri) {
      candidates.push({
        kind: "directory",
        label: decodeFileUriLabel(uri),
        pathStyle: "uri",
        source: "osc7",
        value: uri,
      });
    }
  }
  for (const match of data.matchAll(OSC8_RE)) {
    const uri = match[1]?.trim();
    if (uri) {
      candidates.push({
        kind: "link",
        label: stripTerminalArtifactAnsi(match[2] ?? "").trim() || uri,
        pathStyle: "uri",
        source: "osc8",
        value: uri,
      });
    }
  }
  return candidates;
}

export function detectTerminalTextArtifacts(
  text: string,
  range?: TerminalArtifactRange,
): TerminalArtifactCandidate[] {
  const clean = stripTerminalArtifactAnsi(text);
  const candidates: TerminalArtifactCandidate[] = [];
  const occupied = new Set<string>();

  for (const match of clean.matchAll(WEB_URL_RE)) {
    const value = trimTrailingPunctuation(match[0]);
    if (isAllowedTerminalArtifactUrl(value)) {
      pushUnique(candidates, occupied, {
        kind: "url",
        range,
        source: "heuristic",
        value,
      });
    }
  }
  for (const expression of [UNC_PATH_RE, WINDOWS_PATH_RE]) {
    for (const match of clean.matchAll(expression)) {
      pushPath(candidates, occupied, trimTrailingPunctuation(match[0]), range);
    }
  }
  for (const match of clean.matchAll(POSIX_PATH_RE)) {
    pushPath(candidates, occupied, trimTrailingPunctuation(match[1] ?? ""), range);
  }
  return candidates;
}

function pushPath(
  candidates: TerminalArtifactCandidate[],
  occupied: Set<string>,
  value: string,
  range?: TerminalArtifactRange,
) {
  if (value.length < 2) {
    return;
  }
  pushUnique(candidates, occupied, {
    kind: artifactKindForPath(value),
    pathStyle: resolveTerminalArtifactPathStyle(value),
    range,
    source: "heuristic",
    value,
  });
}

function pushUnique(
  candidates: TerminalArtifactCandidate[],
  occupied: Set<string>,
  candidate: TerminalArtifactCandidate,
) {
  const key = `${candidate.kind}\u0000${candidate.value}`;
  if (!occupied.has(key)) {
    occupied.add(key);
    candidates.push(candidate);
  }
}

function trimTrailingPunctuation(value: string) {
  return value.replace(/[)\]}>.,;:!?]+$/g, "");
}

function decodeFileUriLabel(uri: string) {
  try {
    const parsed = new URL(uri);
    return decodeURIComponent(parsed.pathname) || uri;
  } catch {
    return uri;
  }
}
