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

export interface SshAuthPromptQueueItem {
  id: string;
  options: SshAuthPromptOptions;
}

interface InternalSshAuthPromptQueueItem extends SshAuthPromptQueueItem {
  reject: (error: Error) => void;
  resolve: (receipt: SshSessionSecretReceipt | null) => void;
}

const listeners = new Set<() => void>();
const queue: InternalSshAuthPromptQueueItem[] = [];
let sequence = 0;

export function requestSshAuthPrompt(
  options: SshAuthPromptOptions,
): Promise<SshSessionSecretReceipt | null> {
  const id = `ssh-auth-prompt-${++sequence}`;
  return new Promise((resolve, reject) => {
    queue.push({ id, options, reject, resolve });
    emitSshAuthPromptQueueChange();
  });
}

export function completeSshAuthPrompt(
  id: string,
  receipt: SshSessionSecretReceipt,
) {
  const item = shiftSshAuthPrompt(id);
  item?.resolve(receipt);
}

export function cancelSshAuthPrompt(id: string) {
  const item = shiftSshAuthPrompt(id);
  item?.resolve(null);
}

export function failSshAuthPrompt(id: string, error: Error) {
  const item = shiftSshAuthPrompt(id);
  item?.reject(error);
}

export function getCurrentSshAuthPrompt(): SshAuthPromptQueueItem | null {
  const item = queue[0];
  return item ? { id: item.id, options: item.options } : null;
}

export function useCurrentSshAuthPrompt() {
  const [current, setCurrent] = useState(getCurrentSshAuthPrompt);

  useEffect(() => {
    const listener = () => setCurrent(getCurrentSshAuthPrompt());
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return current;
}

export function __resetSshAuthPromptStoreForTests() {
  while (queue.length > 0) {
    queue.shift()?.resolve(null);
  }
  sequence = 0;
  emitSshAuthPromptQueueChange();
}

function shiftSshAuthPrompt(id: string) {
  const index = queue.findIndex((item) => item.id === id);
  if (index < 0) {
    return null;
  }
  const [item] = queue.splice(index, 1);
  emitSshAuthPromptQueueChange();
  return item;
}

function emitSshAuthPromptQueueChange() {
  for (const listener of listeners) {
    listener();
  }
}
