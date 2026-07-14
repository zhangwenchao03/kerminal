import { useCallback, useEffect, useState } from "react";
import {
  submitSshAuthPromptResponse,
  type SshAuthPromptResponseRequest,
} from "../../lib/sshAuthApi";
import { SshAuthPromptDialog } from "./SshAuthPromptDialog";
import { formatSshAuthPromptError } from "./sshAuthPromptModel";
import {
  cancelSshAuthPrompt,
  completeSshAuthPrompt,
  type SshAuthPromptStore,
  useCurrentSshAuthPrompt,
} from "./sshAuthPromptStore";

export function SshAuthPromptHost({ store }: { store?: SshAuthPromptStore }) {
  const current = useCurrentSshAuthPrompt(store);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
  }, [current?.id]);

  const closePrompt = useCallback(() => {
    if (!current || busy) {
      return;
    }
    setError(null);
    (store?.cancel ?? cancelSshAuthPrompt)(current.id);
  }, [busy, current, store]);

  const submitPrompt = useCallback(
    async (request: SshAuthPromptResponseRequest) => {
      if (!current) {
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const receipt = await submitSshAuthPromptResponse(request);
        (store?.complete ?? completeSshAuthPrompt)(current.id, receipt);
      } catch (nextError) {
        setError(formatSshAuthPromptError(nextError));
      } finally {
        setBusy(false);
      }
    },
    [current, store],
  );

  return (
    <SshAuthPromptDialog
      busy={busy}
      defaultRememberInVault={current?.options.defaultRememberInVault}
      error={error}
      onClose={closePrompt}
      onSubmit={(request) => void submitPrompt(request)}
      open={Boolean(current)}
      persistToHostId={current?.options.persistToHostId}
      prompt={current?.options.prompt ?? null}
    />
  );
}
