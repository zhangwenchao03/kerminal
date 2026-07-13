import { useCallback, useEffect, useRef, useState } from "react";
import {
  tmuxListSessions,
  tmuxProbe,
  type TmuxCapabilityStatus,
  type TmuxSessionSummary,
} from "../../../lib/tmuxApi";
import type { UserFacingMessage } from "../../../lib/userFacingMessage";
import type { resolveTmuxTarget } from "./tmuxToolModel";
import { formatTmuxLoadFailure, tmuxFailure } from "./tmuxUserMessage";

/** 绑定到当前 tmux 目标的对话框草稿；目标变化时必须整体丢弃。 */
export type TmuxDialogState =
  | { kind: "create"; name: string }
  | { kind: "rename"; name: string; session: TmuxSessionSummary }
  | { kind: "kill"; session: TmuxSessionSummary }
  | null;

interface UseTmuxToolLifecycleOptions {
  active: boolean;
  targetKey: string;
  targetResolution: ReturnType<typeof resolveTmuxTarget>;
}

/** 远端动作启动时冻结的目标与生命周期代次，防止 A-B-A 切换后旧结果复活。 */
export interface TmuxBindingSnapshot {
  bindingKey: string;
  generation: number;
}

/**
 * 管理 tmux 目标态与远端读取代次；隐藏或换目标后，旧请求不得回写任何界面状态。
 */
export function useTmuxToolLifecycle({
  active,
  targetKey,
  targetResolution,
}: UseTmuxToolLifecycleOptions) {
  const [capability, setCapability] = useState<TmuxCapabilityStatus | null>(
    null,
  );
  const [sessions, setSessions] = useState<TmuxSessionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [dialog, setDialog] = useState<TmuxDialogState>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<UserFacingMessage | null>(null);
  const bindingGenerationRef = useRef(0);
  const requestGenerationRef = useRef(0);
  const targetBindingKey = `${active ? "active" : "inactive"}:${targetKey}`;
  const [stateBindingKey, setStateBindingKey] = useState(targetBindingKey);
  const currentContextRef = useRef({
    active,
    bindingKey: targetBindingKey,
    targetResolution,
  });
  currentContextRef.current = {
    active,
    bindingKey: targetBindingKey,
    targetResolution,
  };

  const captureBinding = useCallback(
    (): TmuxBindingSnapshot => ({
      bindingKey: currentContextRef.current.bindingKey,
      generation: bindingGenerationRef.current,
    }),
    [],
  );
  const isCurrentBinding = useCallback(
    (binding: TmuxBindingSnapshot) =>
      currentContextRef.current.bindingKey === binding.bindingKey &&
      bindingGenerationRef.current === binding.generation,
    [],
  );

  const loadSessions = useCallback(async () => {
    const requestContext = currentContextRef.current;
    const requestTarget = requestContext.targetResolution;
    if (!requestContext.active || requestTarget.status !== "ready") {
      return;
    }

    const requestGeneration = requestGenerationRef.current + 1;
    requestGenerationRef.current = requestGeneration;
    const requestBindingKey = requestContext.bindingKey;
    // 目标或面板生命周期变化会推进代次；旧成功、失败和 finally 都不能污染新目标。
    const requestIsCurrent = () =>
      requestGenerationRef.current === requestGeneration &&
      currentContextRef.current.active &&
      currentContextRef.current.bindingKey === requestBindingKey;

    setLoading(true);
    setError(null);
    let nextCapability: TmuxCapabilityStatus;
    try {
      nextCapability = await tmuxProbe({ target: requestTarget.target });
    } catch (loadError: unknown) {
      if (requestIsCurrent()) {
        setCapability(null);
        setSessions([]);
        setError(
          tmuxFailure(
            loadError,
            formatTmuxLoadFailure(loadError),
            "请检查连接后重试。",
          ),
        );
        setLoading(false);
      }
      return;
    }

    if (!requestIsCurrent()) {
      return;
    }
    setCapability(nextCapability);
    if (!nextCapability.available) {
      setSessions([]);
      setLoading(false);
      return;
    }

    try {
      const nextSessions = await tmuxListSessions({
        target: requestTarget.target,
      });
      if (requestIsCurrent()) {
        setSessions(nextSessions);
      }
    } catch (loadError: unknown) {
      if (requestIsCurrent()) {
        setSessions([]);
        setError(
          tmuxFailure(
            loadError,
            formatTmuxLoadFailure(loadError),
            "请检查连接后重试。",
          ),
        );
      }
    } finally {
      if (requestIsCurrent()) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    bindingGenerationRef.current += 1;
    requestGenerationRef.current += 1;
    setStateBindingKey(targetBindingKey);
    setCapability(null);
    setSessions([]);
    setLoading(false);
    setDialog(null);
    setBusyAction(null);
    setError(null);
    void loadSessions();
    return () => {
      bindingGenerationRef.current += 1;
      requestGenerationRef.current += 1;
    };
  }, [loadSessions, targetBindingKey]);

  // props 已切换而 effect 尚未清理旧 state 时，同步隐藏旧目标的数据和动作。
  // 这不仅避免闪现，也阻止旧会话行在新目标上触发 attach/kill 等操作。
  const stateMatchesBinding = stateBindingKey === targetBindingKey;

  return {
    busyAction: stateMatchesBinding ? busyAction : null,
    capability: stateMatchesBinding ? capability : null,
    captureBinding,
    dialog: stateMatchesBinding ? dialog : null,
    error: stateMatchesBinding ? error : null,
    isCurrentBinding,
    loading:
      stateMatchesBinding
        ? loading
        : active && targetResolution.status === "ready",
    loadSessions,
    sessions: stateMatchesBinding ? sessions : [],
    setBusyAction,
    setDialog,
    setError,
    setSessions,
  };
}
