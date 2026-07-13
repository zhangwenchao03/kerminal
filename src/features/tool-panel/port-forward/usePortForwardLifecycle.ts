import { useCallback, useEffect, useRef } from "react";
import type { UserFacingMessage } from "../../../lib/userFacingMessage";

/** 冻结一次端口转发动作所属的主机代次。 */
export interface PortForwardBindingToken {
  generation: number;
  hostId: string;
}

interface PortForwardListToken extends PortForwardBindingToken {
  requestId: number;
}

interface PortForwardLifecycleHandlers {
  onError: (message: UserFacingMessage | null) => void;
  onLoadingChange: (loading: boolean) => void;
  onNotice: (notice: string | null) => void;
}

interface UsePortForwardLifecycleOptions extends PortForwardLifecycleHandlers {
  active: boolean;
  hostId?: string;
}

/**
 * 管理端口转发面板的主机绑定代次，并为列表和写动作提供 latest-wins 门禁。
 * API 仍返回全局列表；这里只负责阻止旧主机结果写回当前视图。
 */
export function usePortForwardLifecycle({
  active,
  hostId,
  ...handlers
}: UsePortForwardLifecycleOptions) {
  const bindingKey = active && hostId ? hostId : null;
  const stateRef = useRef({
    bindingKey,
    generation: 0,
    listRequestId: 0,
  });
  const handlersRef = useRef<PortForwardLifecycleHandlers>(handlers);
  handlersRef.current = handlers;

  // render 阶段先推进代次，旧 Promise 即使早于 effect cleanup 完成也不能写入新主机。
  if (stateRef.current.bindingKey !== bindingKey) {
    stateRef.current.bindingKey = bindingKey;
    stateRef.current.generation += 1;
    stateRef.current.listRequestId += 1;
  }

  const captureBinding = useCallback((): PortForwardBindingToken | null => {
    const { bindingKey: currentHostId, generation } = stateRef.current;
    return currentHostId ? { generation, hostId: currentHostId } : null;
  }, []);

  const isCurrentBinding = useCallback((token: PortForwardBindingToken) => {
    const state = stateRef.current;
    return (
      state.bindingKey === token.hostId && state.generation === token.generation
    );
  }, []);

  const beginListRequest = useCallback((): PortForwardListToken | null => {
    const binding = captureBinding();
    if (!binding) {
      return null;
    }
    const requestId = ++stateRef.current.listRequestId;
    return { ...binding, requestId };
  }, [captureBinding]);

  const isCurrentListRequest = useCallback(
    (token: PortForwardListToken) =>
      isCurrentBinding(token) &&
      stateRef.current.listRequestId === token.requestId,
    [isCurrentBinding],
  );

  const invalidateListRequests = useCallback(() => {
    stateRef.current.listRequestId += 1;
  }, []);

  const runAction = useCallback(
    async (
      action: (token: PortForwardBindingToken) => Promise<void>,
      errorMessage: (error: unknown) => UserFacingMessage,
    ) => {
      const token = captureBinding();
      if (!token) {
        return;
      }
      handlersRef.current.onLoadingChange(true);
      handlersRef.current.onError(null);
      handlersRef.current.onNotice(null);
      try {
        await action(token);
      } catch (error) {
        if (isCurrentBinding(token)) {
          handlersRef.current.onError(errorMessage(error));
        }
      } finally {
        if (isCurrentBinding(token)) {
          handlersRef.current.onLoadingChange(false);
        }
      }
    },
    [captureBinding, isCurrentBinding],
  );

  useEffect(
    () => () => {
      stateRef.current.bindingKey = null;
      stateRef.current.generation += 1;
      stateRef.current.listRequestId += 1;
    },
    [],
  );

  return {
    beginListRequest,
    captureBinding,
    invalidateListRequests,
    isCurrentBinding,
    isCurrentListRequest,
    runAction,
  };
}
