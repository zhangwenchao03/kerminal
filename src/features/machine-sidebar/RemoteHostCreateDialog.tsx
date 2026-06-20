import { useEffect, useMemo, useState } from "react";
import { TestTube2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import { ModalShell } from "../../components/ui/modal-shell";
import type { DockerContainerSummary } from "../../lib/dockerApi";
import { detectShells, type ShellCandidate } from "../../lib/profileApi";
import { createDefaultSshOptions } from "../../lib/remoteHostApi";
import type { RemoteHostAuthType, SshOptions } from "../../lib/remoteHostApi";
import type { ContainerRuntime } from "../../lib/targetModel";
import { buildLocalShellPresets, buildLocalTerminalOptions, formatLocalArgs, formatLocalEnv } from "./remote-host-dialog/local-form";
import {
  buildGroupOptions,
  CUSTOM_LOCAL_SHELL_PRESET_ID,
  DEFAULT_LOCAL_SHELL_PRESET_ID,
  type ConnectionMode,
  type DialogSection,
  initialTargetGroupId,
  protocolTabs,
  readRememberedDockerHostId,
  type RemoteHostCreateDialogProps,
  sectionTabsByMode,
} from "./remote-host-dialog/model";
import {
  buildRdpHostRequest,
  buildRdpRequest,
  buildSerialHostRequest,
  buildSshRequest,
  buildTelnetHostRequest,
  isRdpRemoteHost,
  isSerialRemoteHost,
  isTelnetRemoteHost,
  normalizeSshOptionsForForm,
  readSerialTagValue,
  validateRdpHostRequest,
  validateRdpRequest,
  validateSerialHostRequest,
  validateSshRequest,
  validateTelnetHostRequest,
} from "./remote-host-dialog/request-builders";
import { RemoteHostDialogSectionContent } from "./remote-host-dialog/section-content";
import { protocolButtonClassName, sectionButtonClassName } from "./remote-host-dialog/shared-ui";

export type { DockerContainerCreateRequest, LocalTerminalCreateOptions } from "./remote-host-dialog/model";


export function RemoteHostCreateDialog({
  defaultGroupId,
  defaultMode = "ssh",
  editingHost,
  editingLocalMachine,
  groups,
  onAddDockerContainer,
  onClose,
  onCreateLocal,
  onCreateHost,
  onListDockerContainers,
  onUpdateHost,
  onUpdateLocal,
  onCreated,
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
  const [authType, setAuthType] = useState<RemoteHostAuthType>("agent");
  const [credentialRef, setCredentialRef] = useState("");
  const [credentialSecret, setCredentialSecret] = useState("");
  const [dockerContainerId, setDockerContainerId] = useState("");
  const [dockerContainers, setDockerContainers] = useState<
    DockerContainerSummary[]
  >([]);
  const [dockerHostId, setDockerHostId] = useState("");
  const [dockerIncludeStopped, setDockerIncludeStopped] = useState(true);
  const [dockerLoadError, setDockerLoadError] = useState<string | null>(null);
  const [dockerLoading, setDockerLoading] = useState(false);
  const [dockerRefreshToken, setDockerRefreshToken] = useState(0);
  const [dockerRuntime, setDockerRuntime] =
    useState<ContainerRuntime>("docker");
  const [dockerShell, setDockerShell] = useState("");
  const [dockerUser, setDockerUser] = useState("");
  const [dockerWorkdir, setDockerWorkdir] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [groupId, setGroupId] = useState("");
  const [host, setHost] = useState("");
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
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [tags, setTags] = useState("");
  const [telnetNote, setTelnetNote] = useState("");
  const [username, setUsername] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }

    const initialGroupId =
      editingLocalMachine?.remoteGroupId ??
      editingHost?.groupId ??
      initialTargetGroupId(targetGroups, defaultGroupId);
    const initialMode =
      editingLocalMachine
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
    const initialDockerHostId = readRememberedDockerHostId(sshMachines);
    setActiveSection("properties");
    setAuthType(
      editingHost?.authType ??
        (initialMode === "rdp" ? "password" : "agent"),
    );
    setCredentialRef(editingHost?.credentialRef ?? "");
    setCredentialSecret("");
    setDockerContainerId("");
    setDockerContainers([]);
    setDockerHostId(initialDockerHostId);
    setDockerIncludeStopped(true);
    setDockerLoadError(null);
    setDockerLoading(false);
    setDockerRefreshToken(0);
    setDockerRuntime("docker");
    setDockerShell("");
    setDockerUser("");
    setDockerWorkdir("");
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
    setRdpPassword("");
    setRdpUsername(initialMode === "rdp" ? editingHost?.username ?? "" : "");
    setRdpWidth("1440");
    setSerialBaud(readSerialTagValue(editingHost, "baud") ?? "9600");
    setSerialDataBits(readSerialTagValue(editingHost, "data-bits") ?? "8");
    setSerialFlow(readSerialTagValue(editingHost, "flow") ?? "none");
    setSerialNote("");
    setSerialParity(readSerialTagValue(editingHost, "parity") ?? "none");
    setSerialPort(
      initialMode === "serial"
        ? readSerialTagValue(editingHost, "port") ?? editingHost?.host ?? ""
        : "",
    );
    setSerialStopBits(readSerialTagValue(editingHost, "stop-bits") ?? "1");
    setSavingAction(null);
    setSshOptions(normalizeSshOptionsForForm(editingHost?.sshOptions));
    setStatusMessage(null);
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
    defaultGroupId,
    defaultMode,
    editingHost,
    editingLocalMachine,
    open,
    targetGroups,
    sshMachines,
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

  useEffect(() => {
    if (!open || mode !== "docker") {
      return undefined;
    }
    if (!dockerHostId) {
      setDockerContainers([]);
      setDockerContainerId("");
      setDockerLoadError(null);
      setDockerLoading(false);
      return undefined;
    }
    if (!onListDockerContainers) {
      setDockerContainers([]);
      setDockerContainerId("");
      setDockerLoadError("当前运行环境不支持读取容器列表。");
      setDockerLoading(false);
      return undefined;
    }

    let disposed = false;
    setDockerLoading(true);
    setDockerLoadError(null);
    onListDockerContainers({
      hostId: dockerHostId,
      includeStopped: dockerIncludeStopped,
      runtime: dockerRuntime,
    })
      .then((containers) => {
        if (disposed) {
          return;
        }
        setDockerContainers(containers);
        setDockerContainerId((current) => {
          if (containers.some((container) => container.id === current)) {
            return current;
          }
          return containers.find((container) => container.status === "running")?.id
            ?? containers[0]?.id
            ?? "";
        });
      })
      .catch((caught) => {
        if (disposed) {
          return;
        }
        setDockerContainers([]);
        setDockerContainerId("");
        setDockerLoadError(
          caught instanceof Error ? caught.message : String(caught),
        );
      })
      .finally(() => {
        if (!disposed) {
          setDockerLoading(false);
        }
      });

    return () => {
      disposed = true;
    };
  }, [
    dockerHostId,
    dockerIncludeStopped,
    dockerRefreshToken,
    dockerRuntime,
    mode,
    onListDockerContainers,
    open,
  ]);

  const confirm = async () => {
    setStatusMessage(null);
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
          await onUpdateLocal(editingLocalMachine.id, localOptionsResult.options);
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

    if (mode === "docker") {
      const selectedContainer = dockerContainers.find(
        (container) => container.id === dockerContainerId,
      );
      if (!dockerHostId) {
        setError("请选择一个已有 SSH 主机。");
        return;
      }
      if (!selectedContainer) {
        setError("请选择一个容器。");
        return;
      }
      if (!onAddDockerContainer) {
        setError("当前运行环境不支持添加容器目标。");
        return;
      }

      setSavingAction("confirm");
      setError(null);
      try {
        await onAddDockerContainer({
          container: selectedContainer,
          groupId: groupId || undefined,
          shell: dockerShell.trim() || undefined,
          user: dockerUser.trim() || undefined,
          workdir: dockerWorkdir.trim() || undefined,
        });
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
      setError(`${selectedProtocol.label} 暂未支持创建。`);
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
    setStatusMessage(null);
    if (mode === "local") {
      const localOptionsResult = buildLocalTerminalOptions({
        args: localArgs,
        cwd: localCwd,
        env: localEnv,
        groupId,
        shell: localShell,
        title: localTitle,
      });
      if (localOptionsResult.error) {
        setError(localOptionsResult.error);
        return;
      }

      setError(null);
      setStatusMessage(
        editingLocalMachine
          ? "本地终端配置检查通过，确认后会保存到左侧卡片。"
          : "本地终端无需连接测试，确认后会创建本地会话。",
      );
      return;
    }
    if (mode === "rdp") {
      const request = buildRdpRequest({
        fullscreen: rdpFullscreen,
        height: rdpHeight,
        host,
        name,
        note: rdpNote,
        password: rdpPassword,
        port,
        username: rdpUsername,
        width: rdpWidth,
      });
      const validationError = validateRdpRequest(request);
      if (validationError) {
        setError(validationError);
        return;
      }
      setError(null);
      setStatusMessage("RDP 字段检查通过，确认后会保存到左侧主机栏。");
      return;
    }

    if (mode === "docker") {
      if (!dockerHostId) {
        setError("请选择一个已有 SSH 主机。");
        return;
      }
      if (!dockerContainerId) {
        setError("请选择一个容器。");
        return;
      }
      setError(null);
      setStatusMessage("容器选择已确认，确认后会添加到侧栏并可直接进入。");
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
      setError(null);
      setStatusMessage("Telnet 字段检查通过，确认后会保存到左侧主机栏。");
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
      setError(null);
      setStatusMessage("Serial 字段检查通过，确认后会保存到左侧主机栏。");
      return;
    }

    if (mode !== "ssh") {
      setError(`${selectedProtocol.label} 暂未支持测试。`);
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
    setError(null);
    setStatusMessage("SSH 配置检查通过，确认后会保存到左侧主机栏。");
  };

  const selectedProtocol =
    protocolTabs.find((protocol) => protocol.id === mode) ?? protocolTabs[0];
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
  const showTestButton = mode !== "telnet";
  const sectionContent = (
    <RemoteHostDialogSectionContent
      activeSection={activeSection}
      activeSectionDefinition={activeSectionDefinition}
      authType={authType}
      credentialRef={credentialRef}
      credentialSecret={credentialSecret}
      dockerContainerId={dockerContainerId}
      dockerContainers={dockerContainers}
      dockerHostId={dockerHostId}
      dockerIncludeStopped={dockerIncludeStopped}
      dockerLoadError={dockerLoadError}
      dockerLoading={dockerLoading}
      dockerRuntime={dockerRuntime}
      dockerShell={dockerShell}
      dockerUser={dockerUser}
      dockerWorkdir={dockerWorkdir}
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
      onDockerRefresh={() => setDockerRefreshToken((current) => current + 1)}
      port={port}
      rdpFullscreen={rdpFullscreen}
      rdpHeight={rdpHeight}
      rdpNote={rdpNote}
      rdpPassword={rdpPassword}
      rdpUsername={rdpUsername}
      rdpWidth={rdpWidth}
      selectedProtocolLabel={selectedProtocol.label}
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
      setDockerContainerId={setDockerContainerId}
      setDockerHostId={setDockerHostId}
      setDockerIncludeStopped={setDockerIncludeStopped}
      setDockerRuntime={setDockerRuntime}
      setDockerShell={setDockerShell}
      setDockerUser={setDockerUser}
      setDockerWorkdir={setDockerWorkdir}
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
    <ModalShell
      footer={
        <>
          <Button onClick={onClose} type="button" variant="ghost">
            取消
          </Button>
          {showTestButton ? (
            <Button
              disabled={savingAction !== null}
              onClick={testConnection}
              type="button"
              variant="secondary"
            >
              <TestTube2 className="h-4 w-4" />
              {mode === "ssh" ? "检查配置" : "测试连接"}
            </Button>
          ) : null}
          <Button
            disabled={savingAction !== null}
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
          : "从这里新增本地终端、保存 SSH/RDP 主机，或添加容器目标。"
      }
      maxWidthClassName="max-w-5xl"
      onClose={onClose}
      open={open}
      title={editingHost || editingLocalMachine ? "编辑连接配置" : "新建主机"}
    >
      <div className="space-y-4">
        <div className="scrollbar-none flex gap-2 overflow-x-auto border-b border-black/8 pb-3 dark:border-white/8">
          {protocolTabs.map((protocol) => {
            const Icon = protocol.Icon;
            const selected = protocol.id === mode;
            const disabled =
              Boolean(editingHost || editingLocalMachine) && protocol.id !== mode;
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
                  setStatusMessage(null);
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
                    setPort("22");
                    setTags("");
                  } else if (protocol.id === "docker") {
                    setDockerHostId((current) =>
                      current &&
                      sshMachines.some((machine) => machine.id === current)
                        ? current
                        : readRememberedDockerHostId(sshMachines),
                    );
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

        <div className="grid min-h-[430px] gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
          <nav
            aria-label="连接配置分区"
            className="rounded-2xl border border-black/8 bg-black/[0.03] p-2 dark:border-white/8 dark:bg-white/6"
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
                    setStatusMessage(null);
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
            {statusMessage ? (
              <p className="mt-4 rounded-xl border border-sky-500/20 bg-sky-500/10 px-3 py-2 text-sm text-sky-700 dark:text-sky-200">
                {statusMessage}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </ModalShell>
  );
}









