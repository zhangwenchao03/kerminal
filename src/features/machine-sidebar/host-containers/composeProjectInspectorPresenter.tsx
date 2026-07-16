import { useEffect, useState } from "react";
import { cn } from "../../../lib/cn";
import type { RemoteWorkspaceReadTextFileResponse } from "../../sftp/editor/index";
import type { ComposeProjectView } from "./composeProjectModel";

export function buildYamlMetadataItems(
  metadata: {
    bytesRead?: number;
    encoding?: string;
    lineEnding?: string;
    maxBytes?: number;
    readonly?: boolean;
    revision?: RemoteWorkspaceReadTextFileResponse["revision"];
  },
  truncated: boolean,
) {
  const items: string[] = [];
  const size = metadata.revision?.size ?? metadata.bytesRead;
  if (typeof size === "number") {
    const readPrefix =
      truncated && typeof metadata.bytesRead === "number"
        ? `${formatByteCount(metadata.bytesRead)}/`
        : "";
    items.push(`${readPrefix}${formatByteCount(size)}`);
  }
  if (metadata.revision?.permissions) items.push(metadata.revision.permissions);
  if (metadata.encoding) items.push(metadata.encoding.toUpperCase());
  if (metadata.lineEnding) items.push(formatLineEnding(metadata.lineEnding));
  if (typeof metadata.readonly === "boolean") {
    items.push(metadata.readonly ? "RO" : "RW");
  }
  const modified = formatModifiedTime(metadata.revision?.modified);
  if (modified) items.push(modified);
  return items;
}

export function YamlMetadata({ metadataItems }: { metadataItems: string[] }) {
  if (metadataItems.length === 0) return null;
  return (
    <div
      aria-label="Compose YAML 元数据"
      className="scrollbar-none flex min-w-0 shrink-0 items-center gap-1 overflow-x-auto"
    >
      {metadataItems.map((item) => (
        <span
          className="shrink-0 rounded-md bg-black/5 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500 dark:bg-white/10 dark:text-zinc-400"
          key={item}
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function formatByteCount(value: number) {
  if (!Number.isFinite(value) || value < 0) return "-";
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB"];
  let size = value / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 10 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`;
}

function formatLineEnding(value: string) {
  if (value === "\r\n" || value.toLowerCase() === "crlf") return "CRLF";
  if (value === "\n" || value.toLowerCase() === "lf") return "LF";
  return value.toUpperCase();
}

function formatModifiedTime(value?: string | null) {
  if (!value) return "";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${month}-${day} ${hour}:${minute}`;
}

export function composeYamlRootPath(project: ComposeProjectView, path: string) {
  if (project.workingDir) return project.workingDir;
  const normalizedPath = path.replace(/\\/g, "/");
  const slashIndex = normalizedPath.lastIndexOf("/");
  return slashIndex <= 0 ? "/" : normalizedPath.slice(0, slashIndex);
}

/** 跟随 document 主题更新 Monaco 名称，供 portal/系统主题切换共享。 */
export function useMonacoThemeName() {
  const [theme, setTheme] = useState(() => resolveMonacoThemeName());
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const root = document.documentElement;
    const updateTheme = () => setTheme(resolveMonacoThemeName());
    const observer = new MutationObserver(updateTheme);
    observer.observe(root, {
      attributeFilter: ["class", "data-theme"],
      attributes: true,
    });
    updateTheme();
    return () => observer.disconnect();
  }, []);
  return theme;
}

function resolveMonacoThemeName() {
  if (typeof document === "undefined") return "kerminal-dark";
  const root = document.documentElement;
  return root.dataset.theme === "light" && !root.classList.contains("dark")
    ? "vs"
    : "kerminal-dark";
}

export function Field({
  label,
  mono = false,
  value,
}: {
  label: string;
  mono?: boolean;
  value: string;
}) {
  return (
    <div className="grid gap-0.5">
      <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
        {label}
      </span>
      <span
        className={cn(
          "min-w-0 truncate text-zinc-800 dark:text-zinc-200",
          mono && "font-mono text-[11px]",
        )}
        title={value}
      >
        {value || "-"}
      </span>
    </div>
  );
}

export function PathList({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="grid gap-1.5">
      <div className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
      <div className="grid gap-1">
        {values.length ? (
          values.map((value) => (
            <span
              className="truncate rounded-lg bg-black/5 px-2 py-1 font-mono text-[11px] text-zinc-600 dark:bg-white/10 dark:text-zinc-300"
              key={value}
              title={value}
            >
              {value}
            </span>
          ))
        ) : (
          <span className="text-zinc-400 dark:text-zinc-500">-</span>
        )}
      </div>
    </div>
  );
}

export function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl bg-black/5 px-2.5 py-2 dark:bg-white/10">
      <div className="font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        {value}
      </div>
      <div className="text-[11px] text-zinc-500 dark:text-zinc-400">{label}</div>
    </div>
  );
}

export function StateMessage({
  children,
  tone = "muted",
}: {
  children: string;
  tone?: "danger" | "muted";
}) {
  return (
    <div
      className={cn(
        "flex min-h-32 items-center justify-center rounded-[var(--radius-card)] border px-4 py-8 text-center text-sm",
        tone === "danger"
          ? "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-200"
          : "border-dashed border-[var(--border-subtle)] text-zinc-500 dark:text-zinc-400",
      )}
    >
      {children}
    </div>
  );
}
