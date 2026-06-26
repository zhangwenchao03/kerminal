import type {
  ExternalAgentId,
  ExternalAgentLaunchSpec,
  ExternalAgentStatus,
  ExternalAgentWorkspaceStatus,
} from "../../../lib/agentLauncherApi";
export type { ParsedAgentCommand } from "../../../lib/agentCommandLine";
export { parseAgentCommandLine } from "../../../lib/agentCommandLine";

export const EXTERNAL_AGENT_IDS: ExternalAgentId[] = [
  "codex",
  "claude",
  "custom",
];
export const EXTERNAL_AGENT_WORKSPACE_FILE_AGENT_IDS: ExternalAgentId[] = [
  "codex",
  "claude",
];

export type AgentLauncherTone = "ready" | "warning" | "danger" | "muted";
export type AgentLaunchPermissionMode = "default" | "skipPermissions";

export interface McpStatusViewModel {
  label: string;
  detail: string;
  tone: AgentLauncherTone;
}

export interface AgentActionViewModel {
  agentId: ExternalAgentId;
  title: string;
  cliCommand: string;
  configPath: string;
  statusDetail: string;
  installLabel: string;
  configLabel: string;
  actionLabel: string;
  disabled: boolean;
  disabledReason?: string;
  tone: AgentLauncherTone;
}

interface AgentActionOptions {
  mcpServerRunning: boolean;
  terminalLauncherAvailable: boolean;
}

export function buildAgentLauncherViewModel(
  status: ExternalAgentWorkspaceStatus,
  terminalLauncherAvailable: boolean,
): AgentActionViewModel[] {
  return EXTERNAL_AGENT_IDS.map((agentId) =>
    buildAgentActionViewModel(status.agents[agentId], {
      mcpServerRunning: status.mcpServerRunning,
      terminalLauncherAvailable,
    }),
  );
}

export function buildAgentActionViewModel(
  agent: ExternalAgentStatus,
  options: AgentActionOptions,
): AgentActionViewModel {
  const disabledReason = resolveAgentDisabledReason(agent, options);
  const customAgent = agent.id === "custom";
  const commandConfigured = Boolean(agent.cliCommand.trim());
  const configReady = customAgent ? true : agent.configReady;
  const installed = agent.installed;
  const statusDetail =
    !customAgent && !options.mcpServerRunning
      ? "Kerminal MCP Server will be started before launch."
      : agent.statusDetail.trim() ||
        (customAgent
          ? "Runs your command directly."
          : installed
            ? `${agent.title} is ready.`
            : `${agent.title} CLI not on PATH.`);

  return {
    actionLabel: customAgent
      ? `Open ${agent.title}`
      : !options.mcpServerRunning
        ? `Start & Open ${agent.title}`
        : configReady
          ? `Open ${agent.title}`
          : "Prepare & Open",
    agentId: agent.id,
    cliCommand: agent.cliCommand.trim() || "No command configured",
    configLabel: customAgent
      ? commandConfigured
        ? "Explicit command"
        : "Enter command"
      : configReady
        ? "Config ready"
        : "Config needs update",
    configPath: customAgent
      ? "User supplied CLI"
      : agent.configPath.trim() || "Config path not generated",
    disabled: Boolean(disabledReason),
    disabledReason,
    installLabel: installed ? "Installed" : "Missing CLI",
    statusDetail,
    title: agent.title,
    tone: resolveAgentTone(agent, disabledReason),
  };
}

export function getMcpStatusView(
  status: Pick<
    ExternalAgentWorkspaceStatus,
    "mcpEndpoint" | "mcpServerRunning"
  >,
): McpStatusViewModel {
  if (status.mcpServerRunning) {
    return {
      detail: status.mcpEndpoint || "Endpoint unavailable.",
      label: "Running",
      tone: "ready",
    };
  }

  return {
    detail: "Start MCP Server first.",
    label: "Stopped",
    tone: "danger",
  };
}

export function buildAgentConfigSnippet(
  status: Pick<ExternalAgentWorkspaceStatus, "mcpEndpoint">,
): string {
  const endpoint = status.mcpEndpoint || "http://127.0.0.1:37657/mcp";
  return [
    "# Codex: ~/.kerminal/.codex/config.toml",
    "[mcp_servers.kerminal]",
    `url = "${endpoint}"`,
    'default_tools_approval_mode = "prompt"',
    "tool_timeout_sec = 60",
    "enabled = true",
    "",
    "# Claude: ~/.kerminal/.mcp.json",
    JSON.stringify(
      {
        mcpServers: {
          kerminal: {
            timeout: 60000,
            type: "http",
            url: endpoint,
          },
        },
      },
      null,
      2,
    ),
  ].join("\n");
}

export function formatAgentLauncherPath(path: string): string {
  return path.trim() || "Not generated";
}

export function agentLauncherErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function agentSupportsPermissionSkip(agentId: ExternalAgentId): boolean {
  return agentId === "codex" || agentId === "claude";
}

export function agentPermissionSkipFlag(
  agentId: ExternalAgentId,
): string | undefined {
  if (agentId === "codex") {
    return "--dangerously-bypass-approvals-and-sandbox";
  }
  if (agentId === "claude") {
    return "--dangerously-skip-permissions";
  }
  return undefined;
}

export function applyAgentLaunchPermissionMode(
  spec: ExternalAgentLaunchSpec,
  permissionMode: AgentLaunchPermissionMode,
): ExternalAgentLaunchSpec {
  if (permissionMode !== "skipPermissions") {
    return spec;
  }

  const flag = agentPermissionSkipFlag(spec.agentId);
  if (!flag) {
    return spec;
  }

  const args = spec.args ?? [];
  if (launchSpecContainsArg(spec, flag)) {
    return spec;
  }

  const wrappedCommand = agentLaunchWrappedCommand(spec.shell, args);
  if (wrappedCommand?.command.trim()) {
    const nextArgs = [...args];
    nextArgs[wrappedCommand.argIndex] = insertGlobalCliArg(
      wrappedCommand.command,
      flag,
    );
    return { ...spec, args: nextArgs };
  }

  return { ...spec, args: [flag, ...args] };
}

export function agentLaunchDisplayCommand(spec: ExternalAgentLaunchSpec): string {
  const args = spec.args ?? [];
  const wrappedCommand = agentLaunchWrappedCommand(spec.shell, args);
  if (wrappedCommand?.command.trim()) {
    return wrappedCommand.command.trim();
  }
  return [spec.shell, ...args].join(" ").trim();
}

function resolveAgentDisabledReason(
  agent: ExternalAgentStatus,
  options: AgentActionOptions,
): string | undefined {
  if (!options.terminalLauncherAvailable) {
    return "Terminal launcher unavailable.";
  }
  if (agent.id === "custom") {
    return undefined;
  }
  if (!agent.cliCommand.trim()) {
    return "No launch command configured.";
  }
  return undefined;
}

function resolveAgentTone(
  agent: ExternalAgentStatus,
  disabledReason: string | undefined,
): AgentLauncherTone {
  if (disabledReason) {
    return agent.installed ? "danger" : "warning";
  }
  if (agent.id === "custom") {
    return "ready";
  }
  if (!agent.installed) {
    return "warning";
  }
  if (!agent.configReady) {
    return "warning";
  }
  return "ready";
}

function launchSpecContainsArg(
  spec: ExternalAgentLaunchSpec,
  flag: string,
): boolean {
  if ((spec.args ?? []).some((arg) => arg === flag)) {
    return true;
  }
  return Boolean(
    agentLaunchWrappedCommand(spec.shell, spec.args ?? [])?.command.includes(
      flag,
    ),
  );
}

interface AgentLaunchWrappedCommand {
  argIndex: number;
  command: string;
}

function agentLaunchWrappedCommand(
  shell: string,
  args: string[],
): AgentLaunchWrappedCommand | undefined {
  if (isWindowsCmdLaunch(shell, args) && args[3]?.trim()) {
    return { argIndex: 3, command: args[3] };
  }

  const commandFlagIndex = windowsPowerShellCommandFlagIndex(shell, args);
  const command = args[commandFlagIndex + 1];
  return commandFlagIndex >= 0 && command?.trim()
    ? { argIndex: commandFlagIndex + 1, command }
    : undefined;
}

function isWindowsCmdLaunch(shell: string, args: string[]): boolean {
  const lowerShell = shell.toLowerCase();
  return (
    lowerShell.endsWith("cmd.exe") &&
    args.length >= 4 &&
    args[0].toLowerCase() === "/d" &&
    args[1].toLowerCase() === "/s" &&
    args[2].toLowerCase() === "/k"
  );
}

function windowsPowerShellCommandFlagIndex(
  shell: string,
  args: string[],
): number {
  const lowerShell = shell.toLowerCase();
  if (
    !lowerShell.endsWith("pwsh.exe") &&
    !lowerShell.endsWith("powershell.exe")
  ) {
    return -1;
  }
  return args.findIndex((arg) => {
    const lowerArg = arg.toLowerCase();
    return lowerArg === "-command" || lowerArg === "-c";
  });
}

function insertGlobalCliArg(command: string, flag: string): string {
  const trimmed = command.trim();
  if (!trimmed) {
    return flag;
  }

  const firstWhitespace = trimmed.search(/\s/);
  if (firstWhitespace === -1) {
    return `${trimmed} ${flag}`;
  }

  return `${trimmed.slice(0, firstWhitespace)} ${flag}${trimmed.slice(
    firstWhitespace,
  )}`;
}
