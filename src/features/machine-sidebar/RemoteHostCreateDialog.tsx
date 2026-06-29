import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { ModalShell } from "../../components/ui/modal-shell";
import { testRemoteConnection } from "../../lib/connectionApi";
import { detectShells, type ShellCandidate } from "../../lib/profileApi";
import {
  createDefaultSshOptions,
  revealRemoteHostCredential,
} from "../../lib/remoteHostApi";
import type {
  RemoteHostAuthType,
  RemoteHostGroup,
  SshOptions,
} from "../../lib/remoteHostApi";
import { evaluateConnectionCheck } from "./remote-host-dialog/connection-check";
import {
  buildLocalShellPresets,
  buildLocalTerminalOptions,
  formatLocalArgs,
  formatLocalEnv,
} from "./remote-host-dialog/local-form";
import {
  buildGroupOptions,
  CUSTOM_LOCAL_SHELL_PRESET_ID,
  DEFAULT_LOCAL_SHELL_PRESET_ID,
  type ConnectionMode,
  type DialogSection,
  initialTargetGroupId,
  protocolTabs,
  type RemoteHostCreateDialogProps,
  sectionTabsByMode,
} from "./remote-host-dialog/model";
import {
  buildRdpHostRequest,
  buildSerialHostRequest,
  buildSshRequest,
  buildTelnetHostRequest,
  isRdpRemoteHost,
  isSerialRemoteHost,
  isTelnetRemoteHost,
  normalizeSshOptionsForForm,
  readSerialTagValue,
  validateRdpHostRequest,
  validateSerialHostRequest,
  validateSshRequest,
  validateTelnetHostRequest,
} from "./remote-host-dialog/request-builders";
import { RemoteHostDialogSectionContent } from "./remote-host-dialog/section-content";
import {
  protocolButtonClassName,
  sectionButtonClassName,
} from "./remote-host-dialog/shared-ui";
import { RemoteHostGroupCreateDialog } from "./RemoteHostGroupCreateDialog";

export type {
  LocalTerminalCreateOptions,
} from "./remote-host-dialog/model";

type ConnectionTestFeedback = {
  message: string;
  tone: "error" | "info";
};

export function RemoteHostCreateDialog({
  defaultGroupId,
  defaultMode = "ssh",
  editingHost,
  editingLocalMachine,
  externalConfigConflict,
  groups,
  onClose,
  onCreateGroup,
  onCreateLocal,
  onCreateHost,
  onUpdateHost,
  onUpdateLocal,
  onCreated,
  onGroupCreated,
  open,
}: RemoteHostCreateDialogProps) {
  const targetGroups = useMemo(
    () => groups.filter((group) => group.id !== "local"),
    [groups],
  );
  const groupOptions = useMemo(
    () => buildGroupOptions(targetGroups),
    [targetGroups],
  );
  const sshMachines = useMemo(
    () =>
      groups.flatMap((group) =>
        group.machines.filter((machine) => machine.kind === "ssh"),
      ),
    [groups],
  );
  const [activeSection, setActiveSection] =
    useState<DialogSection>("properties");
  const [authType, setAuthType] = useState<RemoteHostAuthType>("password");
  const [credentialRef, setCredentialRef] = useState("");
  const [credentialSecret, setCredentialSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [groupId, setGroupId] = useState("");
  const [host, setHost] = useState("");
  const [inlineGroupDialogOpen, setInlineGroupDialogOpen] = useState(false);
  const [localArgs, setLocalArgs] = useState("");
  const [localCwd, setLocalCwd] = useState("");
  const [localEnv, setLocalEnv] = useState("");
  const [localShell, setLocalShell] = useState("");
  const [localShellCandidates, setLocalShellCandidates] = useState<
    ShellCandidate[]
  >([]);
  const [localShellPresetId, setLocalShellPresetId] = useState(
    DEFAULT_LOCAL_SHELL_PRESET_ID,
  );
  const [localTitle, setLocalTitle] = useState("");
  const [mode, setMode] = useState<ConnectionMode>(defaultMode);
  const [name, setName] = useState("");
  const [port, setPort] = useState("22");
  const [production, setProduction] = useState(false);
  const [rdpFullscreen, setRdpFullscreen] = useState(true);
  const [rdpHeight, setRdpHeight] = useState("900");
  const [rdpNote, setRdpNote] = useState("");
  const [rdpPassword, setRdpPassword] = useState("");
  const [rdpUsername, setRdpUsername] = useState("");
  const [rdpWidth, setRdpWidth] = useState("1440");
  const [serialBaud, setSerialBaud] = useState("9600");
  const [serialDataBits, setSerialDataBits] = useState("8");
  const [serialFlow, setSerialFlow] = useState("none");
  const [serialNote, setSerialNote] = useState("");
  const [serialParity, setSerialParity] = useState("none");
  const [serialPort, setSerialPort] = useState("");
  const [serialStopBits, setSerialStopBits] = useState("1");
  const [savingAction, setSavingAction] = useState<"confirm" | "test" | null>(
    null,
  );
  const [sshOptions, setSshOptions] = useState<SshOptions>(() =>
    createDefaultSshOptions(),
  );
  const [connectionTestFeedback, setConnectionTestFeedback] =
    useState<ConnectionTestFeedback | null>(null);
  const [tags, setTags] = useState("");
  const [telnetNote, setTelnetNote] = useState("");
  const [username, setUsername] = useState("");
  const initializedFormTargetKeyRef = useRef<string | null>(null);
  const credentialRevealRequestRef = useRef(0);
  const formTargetKey = editingLocalMachine
    ? `local:${editingLocalMachine.id}`
    : editingHost
      ? `host:${editingHost.id}`
      : `create:${defaultMode}`;

  useEffect(() => {
    if (!open) {
      initializedFormTargetKeyRef.current = null;
      credentialRevealRequestRef.current += 1;
      return;
    }
    if (initializedFormTargetKeyRef.current === formTargetKey) {
      return;
    }
    initializedFormTargetKeyRef.current = formTargetKey;

    const initialGroupId =
      editingLocalMachine?.remoteGroupId ??
      editingHost?.groupId ??
      initialTargetGroupId(targetGroups, defaultGroupId);
    const initialMode = editingLocalMachine
      ? "local"
      : editingHost && isSerialRemoteHost(editingHost)
        ? "serial"
        : editingHost && isTelnetRemoteHost(editingHost)
          ? "telnet"
          : editingHost && isRdpRemoteHost(editingHost)
            ? "rdp"
            : editingHost
              ? "ssh"
              : defaultMode;
    setActiveSection("properties");
    setAuthType(
      editingHost?.authType ??
        (initialMode === "ssh" || initialMode === "rdp" ? "password" : "agent"),
    );
    setCredentialRef(
      editingHost?.authType === "key" ? (editingHost.credentialRef ?? "") : "",
    );
    setCredentialSecret(
      editingHost?.authType === "password" || editingHost?.authType === "key"
        ? (editingHost.credentialSecret ?? "")
        : "",
    );
    setError(null);
    setGroupId(initialGroupId);
    setHost(editingHost?.host ?? "");
    setLocalArgs(formatLocalArgs(editingLocalMachine?.args ?? []));
    setLocalCwd(editingLocalMachine?.cwd ?? "");
    setLocalEnv(formatLocalEnv(editingLocalMachine?.env));
    setLocalShell(editingLocalMachine?.shell ?? "");
    setLocalShellPresetId(
      editingLocalMachine?.shell
        ? CUSTOM_LOCAL_SHELL_PRESET_ID
        : DEFAULT_LOCAL_SHELL_PRESET_ID,
    );
    setLocalTitle(editingLocalMachine?.name ?? "");
    setMode(initialMode);
    setName(editingHost?.name ?? "");
    setPort(
      String(
        editingHost?.port ??
          (initialMode === "rdp"
            ? 3389
            : initialMode === "telnet"
              ? 23
              : initialMode === "serial"
                ? 1
                : 22),
      ),
    );
    setProduction(editingHost?.production ?? false);
    setRdpFullscreen(true);
    setRdpHeight("900");
    setRdpNote("");
    setRdpPassword(
      initialMode === "rdp" && editingHost?.authType === "password"
        ? (editingHost.credentialSecret ?? "")
        : "",
    );
    setRdpUsername(initialMode === "rdp" ? (editingHost?.username ?? "") : "");
    setRdpWidth("1440");
    setSerialBaud(readSerialTagValue(editingHost, "baud") ?? "9600");
    setSerialDataBits(readSerialTagValue(editingHost, "data-bits") ?? "8");
    setSerialFlow(readSerialTagValue(editingHost, "flow") ?? "none");
    setSerialNote("");
    setSerialParity(readSerialTagValue(editingHost, "parity") ?? "none");
    setSerialPort(
      initialMode === "serial"
        ? (readSerialTagValue(editingHost, "port") ?? editingHost?.host ?? "")
        : "",
    );
    setSerialStopBits(readSerialTagValue(editingHost, "stop-bits") ?? "1");
    setSavingAction(null);
    setSshOptions(normalizeSshOptionsForForm(editingHost?.sshOptions));
    setConnectionTestFeedback(null);
    setTags(
      editingHost
        ? editingHost.tags.join(", ")
        : initialMode === "rdp"
          ? "rdp"
          : initialMode === "telnet"
            ? "telnet"
            : initialMode === "serial"
              ? "serial"
              : "",
    );
    setTelnetNote("");
    setUsername(editingHost?.username ?? "");
  }, [
    defaultMode,
    editingHost,
    editingLocalMachine,
    formTargetKey,
    open,
    targetGroups,
  ]);

  useEffect(() => {
    if (!open || !editingHost) {
      return undefined;
    }
    if (editingHost.credentialSecret?.trim()) {
      return undefined;
    }
    const shouldReveal =
      editingHost.authType === "password" ||
      (editingHost.authType === "key" && !editingHost.credentialRef?.trim());
    if (!shouldReveal) {
      return undefined;
    }

    let disposed = false;
    const requestId = credentialRevealRequestRef.current + 1;
    credentialRevealRequestRef.current = requestId;

    revealRemoteHostCredential(editingHost.id)
      .then((result) => {
        if (disposed || credentialRevealRequestRef.current !== requestId) {
          return;
        }
        if (result.status === "available" && result.credentialSecret) {
          setCredentialSecret(result.credentialSecret);
          if (isRdpRemoteHost(editingHost)) {
            setRdpPassword(result.credentialSecret);
          }
          return;
        }
        if (result.message) {
          setError(result.message);
        }
      })
      .catch((caught) => {
        if (disposed || credentialRevealRequestRef.current !== requestId) {
          return;
        }
        setError(`读取已保存凭据失败：${errorMessage(caught)}`);
      });

    return () => {
      disposed = true;
    };
  }, [
    editingHost?.authType,
    editingHost?.credentialRef,
    editingHost?.credentialSecret,
    editingHost?.id,
    open,
  ]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    let disposed = false;
    detectShells()
      .then((candidates) => {
        if (!disposed) {
          setLocalShellCandidates(
            candidates.filter((candidate) => candidate.isAvailable),
          );
        }
      })
      .catch(() => {
        if (!disposed) {
          setLocalShellCandidates([]);
        }
      });

    return () => {
      disposed = true;
    };
  }, [open]);

  const confirm = async () => {
    setConnectionTestFeedback(null);
    if ((editingHost || editingLocalMachine) && externalConfigConflict) {
      setError(externalConfigConflict);
      return;
    }
    if (mode === "local") {
      const localOptionsResult = buildLocalTerminalOptions(
        {
          args: localArgs,
          cwd: localCwd,
          env: localEnv,
          groupId,
          shell: localShell,
          title: localTitle,
        },
        Boolean(editingLocalMachine),
      );
      if (localOptionsResult.error) {
        setError(localOptionsResult.error);
        return;
      }

      if (editingLocalMachine) {
        if (!onUpdateLocal || !localOptionsResult.options) {
          setError("当前运行环境不支持更新本地会话。");
          return;
        }
        if (
          editingLocalMachine.profileId &&
          !localOptionsResult.options.shell?.trim()
        ) {
          setError("编辑已保存的本地终端需要指定 Shell。");
          return;
        }

        setSavingAction("confirm");
        setError(null);
        try {
          await onUpdateLocal(
            editingLocalMachine.id,
            localOptionsResult.options,
          );
          onClose();
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : String(caught));
        } finally {
          setSavingAction(null);
        }
        return;
      }

      if (!onCreateLocal) {
        setError("当前运行环境不支持创建本地会话。");
        return;
      }

      setSavingAction("confirm");
      setError(null);
      try {
        await onCreateLocal(localOptionsResult.options);
        onClose();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setSavingAction(null);
      }
      return;
    }

    if (mode === "rdp") {
      const request = buildRdpHostRequest({
        existingAuthType:
          editingHost && isRdpRemoteHost(editingHost)
            ? editingHost.authType
            : undefined,
        groupId,
        host,
        name,
        password: rdpPassword,
        port,
        production,
        tags,
        username: rdpUsername,
      });
      const validationError = validateRdpHostRequest(request);
      if (validationError) {
        setError(validationError);
        return;
      }

      setSavingAction("confirm");
      setError(null);
      try {
        const saved =
          editingHost && onUpdateHost
            ? await onUpdateHost({
                ...request,
                id: editingHost.id,
                sortOrder: editingHost.sortOrder,
              })
            : await onCreateHost(request);
        await onCreated?.(saved);
        onClose();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setSavingAction(null);
      }
      return;
    }

    if (mode === "telnet") {
      const request = buildTelnetHostRequest({
        groupId,
        host,
        name,
        port,
        production,
        tags,
      });
      const validationError = validateTelnetHostRequest(request);
      if (validationError) {
        setError(validationError);
        return;
      }

      setSavingAction("confirm");
      setError(null);
      try {
        const saved =
          editingHost && onUpdateHost
            ? await onUpdateHost({
                ...request,
                id: editingHost.id,
                sortOrder: editingHost.sortOrder,
              })
            : await onCreateHost(request);
        await onCreated?.(saved);
        onClose();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setSavingAction(null);
      }
      return;
    }

    if (mode === "serial") {
      const request = buildSerialHostRequest({
        groupId,
        name,
        production,
        serialBaud,
        serialDataBits,
        serialFlow,
        serialParity,
        serialPort,
        serialStopBits,
        tags,
      });
      const validationError = validateSerialHostRequest(request);
      if (validationError) {
        setError(validationError);
        return;
      }

      setSavingAction("confirm");
      setError(null);
      try {
        const saved =
          editingHost && onUpdateHost
            ? await onUpdateHost({
                ...request,
                id: editingHost.id,
                sortOrder: editingHost.sortOrder,
              })
            : await onCreateHost(request);
        await onCreated?.(saved);
        onClose();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setSavingAction(null);
      }
      return;
    }

    if (mode !== "ssh") {
      setError(`${selectedProtocolLabel} 暂未支持创建。`);
      return;
    }

    const request = buildSshRequest({
      authType,
      credentialRef,
      credentialSecret,
      groupId,
      host,
      name,
      port,
      production,
      sshOptions,
      tags,
      username,
    });
    const validationError = validateSshRequest(request);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSavingAction("confirm");
    setError(null);
    try {
      const saved =
        editingHost && onUpdateHost
          ? await onUpdateHost({
              ...request,
              id: editingHost.id,
              sortOrder: editingHost.sortOrder,
            })
          : await onCreateHost(request);
      await onCreated?.(saved);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSavingAction(null);
    }
  };

  const testConnection = async () => {
    setConnectionTestFeedback(null);
    const result = evaluateConnectionCheck({
      authType,
      credentialRef,
      credentialSecret,
      editingLocalMachine: Boolean(editingLocalMachine),
      groupId,
      host,
      localArgs,
      localCwd,
      localEnv,
      localShell,
      localTitle,
      mode,
      name,
      port,
      production,
      rdpFullscreen,
      rdpHeight,
      rdpNote,
      rdpPassword,
      rdpUsername,
      rdpWidth,
      selectedProtocolLabel,
      serialBaud,
      serialDataBits,
      serialFlow,
      serialParity,
      serialPort,
      serialStopBits,
      sshOptions,
      tags,
      username,
    });
    if (!result.ok) {
      setError(null);
      setConnectionTestFeedback({ message: result.error, tone: "error" });
      return;
    }
    if (!result.testRequest) {
      setError(null);
      setConnectionTestFeedback({
        message: result.statusMessage,
        tone: "info",
      });
      return;
    }

    setSavingAction("test");
    setError(null);
    try {
      const testResult = await testRemoteConnection(result.testRequest);
      setConnectionTestFeedback({ message: testResult.message, tone: "info" });
    } catch (caught) {
      setError(null);
      setConnectionTestFeedback({
        message: caught instanceof Error ? caught.message : String(caught),
        tone: "error",
      });
    } finally {
      setSavingAction(null);
    }
  };

  const selectedProtocolLabel = (
    protocolTabs.find((protocol) => protocol.id === mode) ?? protocolTabs[0]
  ).label;
  const activeSections = sectionTabsByMode[mode] ?? sectionTabsByMode.ssh ?? [];
  const activeSectionDefinition =
    activeSections.find((section) => section.id === activeSection) ??
    activeSections[0];
  const updateSshOptions = (
    next: SshOptions | ((current: SshOptions) => SshOptions),
  ) => {
    setSshOptions((current) =>
      typeof next === "function" ? next(current) : next,
    );
  };
  const localShellPresets = useMemo(
    () => buildLocalShellPresets(localShellCandidates),
    [localShellCandidates],
  );
  const handleInlineGroupCreated = async (group: RemoteHostGroup) => {
    setGroupId(group.id);
    await onGroupCreated?.(group);
  };
  const showTestButton = (
    ["ssh", "rdp", "telnet", "serial"] as ConnectionMode[]
  ).includes(mode);
  const sectionContent = (
    <RemoteHostDialogSectionContent
      activeSection={activeSection}
      activeSectionDefinition={activeSectionDefinition}
      authType={authType}
      credentialRef={credentialRef}
      credentialSecret={credentialSecret}
      editingHost={editingHost}
      editingLocalMachine={editingLocalMachine}
      groupId={groupId}
      groupOptions={groupOptions}
      host={host}
      localArgs={localArgs}
      localCwd={localCwd}
      localEnv={localEnv}
      localShell={localShell}
      localShellPresetId={localShellPresetId}
      localShellPresets={localShellPresets}
      localTitle={localTitle}
      mode={mode}
      name={name}
      onCreateGroupClick={
        onCreateGroup ? () => setInlineGroupDialogOpen(true) : undefined
      }
      port={port}
      rdpFullscreen={rdpFullscreen}
      rdpHeight={rdpHeight}
      rdpNote={rdpNote}
      rdpPassword={rdpPassword}
      rdpUsername={rdpUsername}
      rdpWidth={rdpWidth}
      selectedProtocolLabel={selectedProtocolLabel}
      serialBaud={serialBaud}
      serialDataBits={serialDataBits}
      serialFlow={serialFlow}
      serialNote={serialNote}
      serialParity={serialParity}
      serialPort={serialPort}
      serialStopBits={serialStopBits}
      setAuthType={setAuthType}
      setCredentialRef={setCredentialRef}
      setCredentialSecret={setCredentialSecret}
      setError={setError}
      setGroupId={setGroupId}
      setHost={setHost}
      setLocalArgs={setLocalArgs}
      setLocalCwd={setLocalCwd}
      setLocalEnv={setLocalEnv}
      setLocalShell={setLocalShell}
      setLocalShellPresetId={setLocalShellPresetId}
      setLocalTitle={setLocalTitle}
      setName={setName}
      setPort={setPort}
      setRdpFullscreen={setRdpFullscreen}
      setRdpHeight={setRdpHeight}
      setRdpNote={setRdpNote}
      setRdpPassword={setRdpPassword}
      setRdpUsername={setRdpUsername}
      setRdpWidth={setRdpWidth}
      setSerialBaud={setSerialBaud}
      setSerialDataBits={setSerialDataBits}
      setSerialFlow={setSerialFlow}
      setSerialNote={setSerialNote}
      setSerialParity={setSerialParity}
      setSerialPort={setSerialPort}
      setSerialStopBits={setSerialStopBits}
      setTags={setTags}
      setTelnetNote={setTelnetNote}
      setUsername={setUsername}
      sshMachines={sshMachines}
      sshOptions={sshOptions}
      tags={tags}
      telnetNote={telnetNote}
      updateSshOptions={updateSshOptions}
      username={username}
    />
  );

  return (
    <>
      <ModalShell
        footer={
          <>
            {connectionTestFeedback ? (
              <p
                className={[
                  "mr-auto min-w-0 flex-1 rounded-xl border px-3 py-2 text-left text-xs leading-5",
                  connectionTestFeedback.tone === "error"
                    ? "border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-300"
                    : "border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-200",
                ].join(" ")}
                role={
                  connectionTestFeedback.tone === "error" ? "alert" : "status"
                }
              >
                {connectionTestFeedback.message}
              </p>
            ) : null}
            <Button onClick={onClose} type="button" variant="ghost">
              取消
            </Button>
            {showTestButton ? (
              <Button
                disabled={savingAction !== null}
                onClick={() => void testConnection()}
                type="button"
                variant="secondary"
              >
                {savingAction === "test" ? "测试中..." : "测试连接"}
              </Button>
            ) : null}
            <Button
              disabled={savingAction !== null || Boolean(externalConfigConflict)}
              onClick={() => void confirm()}
              type="button"
              variant="primary"
            >
              {savingAction === "confirm" ? "处理中..." : "确认"}
            </Button>
          </>
        }
        description={
          editingHost || editingLocalMachine
            ? "编辑已保存的连接配置。"
            : "新增本地、SSH、RDP、Telnet 或 Serial 连接。"
        }
        onClose={onClose}
        open={open}
        size="large"
        title={editingHost || editingLocalMachine ? "编辑连接配置" : "新建主机"}
      >
        <div className="space-y-4">
          <div className="scrollbar-none flex gap-2 overflow-x-auto border-b border-[var(--border-subtle)] pb-3">
            {protocolTabs.map((protocol) => {
              const Icon = protocol.Icon;
              const selected = protocol.id === mode;
              const disabled =
                Boolean(editingHost || editingLocalMachine) &&
                protocol.id !== mode;
              return (
                <button
                  aria-pressed={selected}
                  className={protocolButtonClassName(selected, disabled)}
                  disabled={disabled}
                  key={protocol.id}
                  onClick={() => {
                    setMode(protocol.id);
                    setActiveSection("properties");
                    setError(null);
                    setConnectionTestFeedback(null);
                    if (protocol.id === "rdp") {
                      setPort("3389");
                      setTags("rdp");
                    } else if (protocol.id === "telnet") {
                      setAuthType("agent");
                      setCredentialRef("");
                      setCredentialSecret("");
                      setPort("23");
                      setRdpUsername("");
                      setTags("telnet");
                      setUsername("");
                    } else if (protocol.id === "serial") {
                      setAuthType("agent");
                      setCredentialRef("");
                      setCredentialSecret("");
                      setHost("");
                      setPort("1");
                      setRdpUsername("");
                      setSerialBaud("9600");
                      setSerialDataBits("8");
                      setSerialFlow("none");
                      setSerialParity("none");
                      setSerialPort("");
                      setSerialStopBits("1");
                      setTags("serial");
                      setUsername("");
                    } else if (protocol.id === "ssh") {
                      setAuthType("password");
                      setPort("22");
                      setTags("");
                    }
                  }}
                  title={protocol.label}
                  type="button"
                >
                  <Icon className="h-5 w-5" />
                  <span>{protocol.label}</span>
                </button>
              );
            })}
          </div>

          {externalConfigConflict ? (
            <div
              className="rounded-xl border border-amber-300/25 bg-amber-400/10 px-3 py-2 font-mono text-xs text-amber-800 dark:border-amber-300/20 dark:bg-amber-400/10 dark:text-amber-100"
              role="alert"
            >
              {externalConfigConflict}
            </div>
          ) : null}

          <div className="grid min-h-[424px] gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
            <nav
              aria-label="连接配置分区"
              className="kerminal-muted-surface rounded-2xl border p-2"
            >
              {activeSections.map((section) => {
                const Icon = section.Icon;
                const selected = section.id === activeSection;
                return (
                  <button
                    aria-pressed={selected}
                    className={sectionButtonClassName(selected)}
                    key={section.id}
                    onClick={() => {
                      setActiveSection(section.id);
                      setConnectionTestFeedback(null);
                    }}
                    type="button"
                  >
                    <Icon className="h-4 w-4" />
                    {section.label}
                  </button>
                );
              })}
            </nav>

            <div className="min-w-0">
              {sectionContent}

              {error ? (
                <p className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">
                  {error}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </ModalShell>
      {inlineGroupDialogOpen && onCreateGroup ? (
        <RemoteHostGroupCreateDialog
          onClose={() => setInlineGroupDialogOpen(false)}
          onCreateGroup={onCreateGroup}
          onCreated={handleInlineGroupCreated}
          open={inlineGroupDialogOpen}
        />
      ) : null}
    </>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
