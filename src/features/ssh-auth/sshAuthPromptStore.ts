import { useEffect, useState } from "react";
import type {
  SshAuthPromptRequest,
  SshSessionSecretReceipt,
} from "../../lib/sshAuthApi";

export interface SshAuthPromptOptions {
  defaultRememberInVault?: boolean;
  persistToHostId?: string;
  prompt: SshAuthPromptRequest;
}

interface SshAuthPromptQueueItem {
  id: string;
  options: SshAuthPromptOptions;
}

interface InternalSshAuthPromptQueueItem extends SshAuthPromptQueueItem {
  reject: (error: Error) => void;
  resolve: (receipt: SshSessionSecretReceipt | null) => void;
}

export interface SshAuthPromptStore {
  cancel(id: string): void;
  complete(id: string, receipt: SshSessionSecretReceipt): void;
  fail(id: string, error: Error): void;
  getCurrent(): { id: string; options: SshAuthPromptOptions } | null;
  request(options: SshAuthPromptOptions): Promise<SshSessionSecretReceipt | null>;
  subscribe(listener: () => void): () => void;
}

/** 创建独立的 SSH 认证提示队列，供独立窗口或测试隔离状态。 */
export function createSshAuthPromptStore(): SshAuthPromptStore {
  const listeners = new Set<() => void>();
  const queue: InternalSshAuthPromptQueueItem[] = [];
  let sequence = 0;

  const emitChange = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  const shift = (id: string) => {
    const index = queue.findIndex((item) => item.id === id);
    if (index < 0) {
      return null;
    }
    const [item] = queue.splice(index, 1);
    emitChange();
    return item;
  };

  return {
    cancel(id) {
      shift(id)?.resolve(null);
    },
    complete(id, receipt) {
      shift(id)?.resolve(receipt);
    },
    fail(id, error) {
      shift(id)?.reject(error);
    },
    getCurrent() {
      const item = queue[0];
      return item ? { id: item.id, options: item.options } : null;
    },
    request(options) {
      const id = `ssh-auth-prompt-${++sequence}`;
      return new Promise((resolve, reject) => {
        queue.push({ id, options, reject, resolve });
        emitChange();
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** 应用运行时共享的 SSH 认证提示队列。 */
const sshAuthPromptStore = createSshAuthPromptStore();

export function requestSshAuthPrompt(options: SshAuthPromptOptions) {
  return sshAuthPromptStore.request(options);
}

export function completeSshAuthPrompt(id: string, receipt: SshSessionSecretReceipt) {
  sshAuthPromptStore.complete(id, receipt);
}

export function cancelSshAuthPrompt(id: string) {
  sshAuthPromptStore.cancel(id);
}

export function useCurrentSshAuthPrompt(store = sshAuthPromptStore) {
  const [current, setCurrent] = useState(store.getCurrent);

  useEffect(() => {
    const listener = () => setCurrent(store.getCurrent());
    return store.subscribe(listener);
  }, [store]);

  return current;
}
