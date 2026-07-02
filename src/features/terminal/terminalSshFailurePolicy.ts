export type SshTerminalFailureClass =
  | "authentication"
  | "knownHosts"
  | "networkUnreachable"
  | "proxyJump"
  | "remoteShellStartup"
  | "permission"
  | "disconnect"
  | "unknown";

export interface SshTerminalFailure {
  class: SshTerminalFailureClass;
  retryable: boolean;
  userMessage: string;
  reconnectHint: string;
}

export interface SshTerminalReconnectDecision {
  autoReconnect: boolean;
  delayMs: number;
  notice: string;
  nextAttempt: number;
}

interface ReconnectPolicyInput {
  appearanceAutoReconnect: boolean;
  attempt: number;
  failure?: SshTerminalFailure;
}

const MAX_AUTO_RECONNECT_ATTEMPTS = 3;
const DEFAULT_RECONNECT_DELAY_MS = 3_000;
const MAX_TRACKED_SSH_OUTPUT_CHARS = 12_000;

const SSH_FAILURE_PATTERNS: Array<{
  class: SshTerminalFailureClass;
  patterns: RegExp[];
}> = [
  {
    class: "knownHosts",
    patterns: [
      /remote host identification has changed/i,
      /host key verification failed/i,
      /offending .*known_hosts/i,
      /no .* host key is known/i,
    ],
  },
  {
    class: "permission",
    patterns: [
      /unprotected private key file/i,
      /permissions .* too open/i,
      /bad permissions/i,
      /load key .* permission denied/i,
    ],
  },
  {
    class: "authentication",
    patterns: [
      /permission denied \((?:publickey|password|keyboard-interactive|gssapi)[^)]+\)/i,
      /authentication failed/i,
      /too many authentication failures/i,
      /all configured authentication methods failed/i,
    ],
  },
  {
    class: "proxyJump",
    patterns: [
      /stdio forwarding failed/i,
      /proxycommand/i,
      /proxyjump/i,
      /channel \d+: open failed/i,
      /connection closed by unknown port/i,
    ],
  },
  {
    class: "networkUnreachable",
    patterns: [
      /network is unreachable/i,
      /no route to host/i,
      /connection timed out/i,
      /operation timed out/i,
      /connection refused/i,
      /could not resolve hostname/i,
      /temporary failure in name resolution/i,
      /name or service not known/i,
    ],
  },
  {
    class: "remoteShellStartup",
    patterns: [
      /shell request failed/i,
      /exec request failed/i,
      /could not chdir to home directory/i,
      /(?:sh|bash|zsh|fish): .*not found/i,
      /no such file or directory/i,
      /cd: .*no such file or directory/i,
      /exec: .*not found/i,
    ],
  },
  {
    class: "disconnect",
    patterns: [
      /connection reset by peer/i,
      /broken pipe/i,
      /write failed/i,
      /received disconnect/i,
      /connection closed by/i,
      /client_loop: send disconnect/i,
    ],
  },
];

export function classifySshTerminalFailure(
  output: string,
): SshTerminalFailure | undefined {
  const normalized = stripAnsi(output);
  for (const candidate of SSH_FAILURE_PATTERNS) {
    if (candidate.patterns.some((pattern) => pattern.test(normalized))) {
      return sshFailureForClass(candidate.class);
    }
  }
  return undefined;
}

export function createSshTerminalFailureTracker() {
  let tail = "";
  let current: SshTerminalFailure | undefined;
  return {
    append(data: string) {
      if (current) {
        return current;
      }
      tail = `${tail}${data}`.slice(-MAX_TRACKED_SSH_OUTPUT_CHARS);
      current = classifySshTerminalFailure(tail);
      return current;
    },
    reset() {
      tail = "";
      current = undefined;
    },
    current() {
      return current;
    },
  };
}

export function decideSshTerminalReconnect({
  appearanceAutoReconnect,
  attempt,
  failure,
}: ReconnectPolicyInput): SshTerminalReconnectDecision {
  const nextAttempt = attempt + 1;
  if (!appearanceAutoReconnect) {
    return {
      autoReconnect: false,
      delayMs: DEFAULT_RECONNECT_DELAY_MS,
      nextAttempt,
      notice: "\r\n自动重连已关闭，可通过右键菜单重新连接。\r\n",
    };
  }
  if (failure && !failure.retryable) {
    return {
      autoReconnect: false,
      delayMs: DEFAULT_RECONNECT_DELAY_MS,
      nextAttempt,
      notice: `\r\n已停止自动重连：${failure.reconnectHint}\r\n`,
    };
  }
  if (nextAttempt > MAX_AUTO_RECONNECT_ATTEMPTS) {
    return {
      autoReconnect: false,
      delayMs: DEFAULT_RECONNECT_DELAY_MS,
      nextAttempt,
      notice:
        "\r\n自动重连已达到上限，可通过右键菜单在检查网络后重新连接。\r\n",
    };
  }
  return {
    autoReconnect: true,
    delayMs: DEFAULT_RECONNECT_DELAY_MS,
    nextAttempt,
    notice: `\r\n3 秒后自动重新连接...（第 ${nextAttempt}/${MAX_AUTO_RECONNECT_ATTEMPTS} 次）\r\n`,
  };
}

export function formatSshTerminalFailureMessage(
  failure: SshTerminalFailure | undefined,
  fallback: string,
) {
  return failure ? `\r\nSSH 会话已结束：${failure.userMessage}\r\n` : fallback;
}

function sshFailureForClass(
  failureClass: SshTerminalFailureClass,
): SshTerminalFailure {
  switch (failureClass) {
    case "authentication":
      return {
        class: failureClass,
        reconnectHint: "认证失败，请检查用户名、密码、私钥或 agent 后手动重连。",
        retryable: false,
        userMessage: "认证失败，请检查用户名、密码、私钥或 agent。",
      };
    case "knownHosts":
      return {
        class: failureClass,
        reconnectHint: "known_hosts 校验失败，请确认主机指纹后再手动重连。",
        retryable: false,
        userMessage: "known_hosts 校验失败，请确认主机指纹是否可信。",
      };
    case "permission":
      return {
        class: failureClass,
        reconnectHint: "本地私钥或 SSH 文件权限不符合要求，请修正权限后手动重连。",
        retryable: false,
        userMessage: "本地私钥或 SSH 文件权限不符合要求。",
      };
    case "proxyJump":
      return {
        class: failureClass,
        reconnectHint: "代理或跳板机链路失败，请检查跳板配置后手动重连。",
        retryable: false,
        userMessage: "代理或跳板机链路失败，请检查跳板配置。",
      };
    case "remoteShellStartup":
      return {
        class: failureClass,
        reconnectHint: "远端 shell、工作目录或启动命令失败，请修正后手动重连。",
        retryable: false,
        userMessage: "远端 shell、工作目录或启动命令失败。",
      };
    case "networkUnreachable":
      return {
        class: failureClass,
        reconnectHint: "网络暂不可达，请检查网络、DNS、端口或防火墙。",
        retryable: true,
        userMessage: "网络暂不可达，请检查网络、DNS、端口或防火墙。",
      };
    case "disconnect":
      return {
        class: failureClass,
        reconnectHint: "连接已断开，可等待网络恢复后重试。",
        retryable: true,
        userMessage: "连接已断开，可等待网络恢复后重试。",
      };
    case "unknown":
      return {
        class: failureClass,
        reconnectHint: "SSH 失败原因未归类，请查看终端输出后手动重连。",
        retryable: false,
        userMessage: "SSH 失败原因未归类，请查看终端输出。",
      };
  }
}

function stripAnsi(value: string) {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
}
