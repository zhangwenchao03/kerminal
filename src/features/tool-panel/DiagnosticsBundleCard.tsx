import { Archive, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import {
  createDiagnosticsBundle,
  type DiagnosticBundle,
} from "../../lib/diagnosticsApi";

export function DiagnosticsBundleCard() {
  const [bundle, setBundle] = useState<DiagnosticBundle | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createBundle = async () => {
    setCreating(true);
    setError(null);
    try {
      setBundle(await createDiagnosticsBundle());
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setCreating(false);
    }
  };

  return (
    <section className="rounded-2xl border border-black/8 bg-white/80 p-4 shadow-sm shadow-black/5 dark:border-white/8 dark:bg-white/6 dark:shadow-black/20">
      <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950 dark:text-zinc-50">
        <Archive className="h-4 w-4 text-emerald-500 dark:text-emerald-300" />
        诊断包
      </div>
      <p className="mt-2 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
        生成本地脱敏 JSON，用于排查终端会话、数据库版本、设置和运行环境问题。
      </p>

      <Button
        className="mt-4 w-full"
        disabled={creating}
        onClick={() => void createBundle()}
        size="sm"
        variant="secondary"
      >
        <Archive className="h-4 w-4" />
        {creating ? "生成中" : "生成诊断包"}
      </Button>

      {error ? (
        <div
          className="mt-3 rounded-xl border border-rose-300/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-100"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      {bundle ? (
        <div
          className="mt-3 rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-800 dark:text-emerald-100"
          role="status"
        >
          <div className="flex items-center gap-2 font-medium">
            <ShieldCheck className="h-4 w-4" />
            已生成 {bundle.fileName}
          </div>
          <dl className="mt-2 space-y-1 text-xs leading-5">
            <div>
              <dt className="inline text-emerald-700/80 dark:text-emerald-100/75">
                大小：
              </dt>
              <dd className="inline">{formatBytes(bundle.bytesWritten)}</dd>
            </div>
            <div>
              <dt className="inline text-emerald-700/80 dark:text-emerald-100/75">
                分区：
              </dt>
              <dd className="inline">{bundle.sections.length} 个</dd>
            </div>
            <div>
              <dt className="inline text-emerald-700/80 dark:text-emerald-100/75">
                路径：
              </dt>
              <dd className="break-all font-mono">{bundle.path}</dd>
            </div>
          </dl>
        </div>
      ) : null}
    </section>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
