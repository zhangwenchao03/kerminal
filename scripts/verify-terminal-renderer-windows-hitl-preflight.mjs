#!/usr/bin/env node
/**
 * Windows renderer HITL 环境预检。
 *
 * 该脚本只读取当前会话协议和 monitor DPI，不移动窗口、不切换会话、
 * 不触发休眠，也不记录显卡 vendor、显示器名称或终端内容。
 *
 * @author kongweiguang
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const args = parseArgs(process.argv.slice(2));
const outputPath = path.resolve(
  repoRoot,
  args.output ??
    ".updeng/docs/verification/terminal-renderer-windows-hitl-preflight.json",
);

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      throw new Error(`Unexpected argument: ${value}`);
    }
    const separator = value.indexOf("=");
    if (separator >= 0) {
      parsed[value.slice(2, separator)] = value.slice(separator + 1);
      continue;
    }
    const key = value.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      parsed[key] = next;
      index += 1;
    } else {
      parsed[key] = "true";
    }
  }
  return parsed;
}

function evaluateCoverage({ monitors, session }) {
  const observedScalePercents = [
    ...new Set(monitors.map((monitor) => monitor.scalePercent)),
  ].sort((left, right) => left - right);
  return {
    hasMixedDpi: observedScalePercents.length > 1,
    hasMultipleMonitors: monitors.length > 1,
    isRdp: session.protocol === "rdp",
    observedScalePercents,
    scaling100To200:
      observedScalePercents.includes(100) &&
      observedScalePercents.includes(125) &&
      observedScalePercents.includes(150) &&
      observedScalePercents.includes(200),
  };
}

function requirementSatisfied(name, coverage) {
  switch (name) {
    case "mixedDpi":
      return coverage.hasMixedDpi;
    case "multipleMonitors":
      return coverage.hasMultipleMonitors;
    case "rdp":
      return coverage.isRdp;
    case "scaling100To200":
      return coverage.scaling100To200;
    default:
      return false;
  }
}

function runWindowsProbe() {
  if (process.platform !== "win32") {
    throw new Error("Windows HITL preflight can only run on Windows.");
  }
  const encodedCommand = Buffer.from(POWERSHELL_PROBE, "utf16le").toString(
    "base64",
  );
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      encodedCommand,
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      windowsHide: true,
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `Windows HITL probe failed: ${result.stderr || result.stdout}`,
    );
  }
  const jsonStart = result.stdout.indexOf("{");
  if (jsonStart < 0) {
    throw new Error(`Windows HITL probe returned no JSON: ${result.stdout}`);
  }
  return JSON.parse(result.stdout.slice(jsonStart));
}

const POWERSHELL_PROBE = String.raw`
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$source = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class KerminalWindowsRendererProbe {
  public delegate bool MonitorEnumProc(
    IntPtr monitor,
    IntPtr hdc,
    ref Rect rect,
    IntPtr data
  );

  [StructLayout(LayoutKind.Sequential)]
  public struct Rect {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct MonitorInfo {
    public int Size;
    public Rect Monitor;
    public Rect Work;
    public uint Flags;
  }

  [DllImport("user32.dll")]
  public static extern bool EnumDisplayMonitors(
    IntPtr hdc,
    IntPtr clip,
    MonitorEnumProc callback,
    IntPtr data
  );

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);

  [DllImport("shcore.dll")]
  public static extern int GetDpiForMonitor(
    IntPtr monitor,
    int dpiType,
    out uint dpiX,
    out uint dpiY
  );

  [DllImport("wtsapi32.dll")]
  public static extern bool WTSQuerySessionInformation(
    IntPtr server,
    int sessionId,
    int infoClass,
    out IntPtr buffer,
    out int bytesReturned
  );

  [DllImport("wtsapi32.dll")]
  public static extern void WTSFreeMemory(IntPtr buffer);

  public static string CurrentProtocol() {
    const int currentSession = -1;
    const int clientProtocolType = 16;
    IntPtr buffer;
    int bytes;
    if (!WTSQuerySessionInformation(
      IntPtr.Zero,
      currentSession,
      clientProtocolType,
      out buffer,
      out bytes
    ) || buffer == IntPtr.Zero || bytes < 2) {
      return "unknown";
    }
    try {
      short protocol = Marshal.ReadInt16(buffer);
      if (protocol == 0) return "console";
      if (protocol == 2) return "rdp";
      return "other";
    } finally {
      WTSFreeMemory(buffer);
    }
  }
}
'@
Add-Type -TypeDefinition $source

$monitors = [System.Collections.Generic.List[object]]::new()
$index = 0
$callback = [KerminalWindowsRendererProbe+MonitorEnumProc]{
  param($monitor, $hdc, [ref]$rect, $data)
  $script:index += 1
  [uint32]$dpiX = 0
  [uint32]$dpiY = 0
  $dpiResult = [KerminalWindowsRendererProbe]::GetDpiForMonitor(
    $monitor,
    0,
    [ref]$dpiX,
    [ref]$dpiY
  )
  $info = [KerminalWindowsRendererProbe+MonitorInfo]::new()
  $info.Size = [Runtime.InteropServices.Marshal]::SizeOf($info)
  $hasInfo = [KerminalWindowsRendererProbe]::GetMonitorInfo($monitor, [ref]$info)
  $bounds = if ($hasInfo) { $info.Monitor } else { $rect.Value }
  $monitors.Add([pscustomobject]@{
    index = $script:index
    width = $bounds.Right - $bounds.Left
    height = $bounds.Bottom - $bounds.Top
    dpiX = $dpiX
    dpiY = $dpiY
    scalePercent = [math]::Round(($dpiX / 96) * 100)
    primary = $hasInfo -and (($info.Flags -band 1) -eq 1)
    dpiProbeHresult = $dpiResult
  })
  return $true
}

[KerminalWindowsRendererProbe]::EnumDisplayMonitors(
  [IntPtr]::Zero,
  [IntPtr]::Zero,
  $callback,
  [IntPtr]::Zero
) | Out-Null

[pscustomobject]@{
  session = [pscustomobject]@{
    id = (Get-Process -Id $PID).SessionId
    protocol = [KerminalWindowsRendererProbe]::CurrentProtocol()
  }
  monitors = $monitors
} | ConvertTo-Json -Depth 5 -Compress
`;

main();

function main() {
  const probe = runWindowsProbe();
  const coverage = evaluateCoverage(probe);
  const requirements = {
    mixedDpi: args["require-mixed-dpi"] === "true",
    multipleMonitors: args["require-multiple-monitors"] === "true",
    rdp: args["require-rdp"] === "true",
    scaling100To200: args["require-scaling-100-200"] === "true",
  };
  const failedRequirements = Object.entries(requirements)
    .filter(([, required]) => required)
    .filter(([name]) => !requirementSatisfied(name, coverage))
    .map(([name]) => name);

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    environment: {
      platform: process.platform,
      release: process.getSystemVersion?.() ?? undefined,
    },
    session: probe.session,
    monitors: probe.monitors,
    coverage,
    requirements,
    failedRequirements,
    passed: failedRequirements.length === 0,
    safety: {
      changedDisplayConfiguration: false,
      movedWindow: false,
      recordedDisplayName: false,
      recordedGpuVendor: false,
      switchedSession: false,
      triggeredSleep: false,
    },
  };

  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(
    `Terminal renderer Windows HITL preflight: ${
      report.passed ? "passed" : "requirements missing"
    }.`,
  );
  console.log(
    `Session ${report.session.protocol}, monitors ${
      report.monitors.length
    }, scales ${coverage.observedScalePercents.join("/") || "none"}.`,
  );
  console.log(`Report: ${path.relative(repoRoot, outputPath)}`);

  if (!report.passed) {
    console.error(`Missing requirements: ${failedRequirements.join(", ")}`);
    process.exitCode = 1;
  }
}
