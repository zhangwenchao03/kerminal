const requiredIds = [
  "HITL-001 no-save-password",
  "HITL-002 saved-password-vault",
  "HITL-003 private-key-passphrase",
  "HITL-004 agent-auth",
  "HITL-005 jump-host",
  "HITL-006 external-launch-no-save",
  "HITL-007 host-key-and-auth-cancel",
  "HITL-008 disconnect-reconnect-concurrency",
  "HITL-009 codex-claude-agent-prompt",
  "HITL-010 diagnostics-and-redaction",
];

export function evidenceTemplate(now) {
  const generatedAt = now.toISOString();
  return `# Managed SSH Real-Target HITL Evidence

Generated at: ${generatedAt}

Rules:

- Do not write passwords, passphrases, private keys, vault refs, external secret refs, tokens, or raw environment variables into this file.
- Use host aliases, fingerprints, redacted session ids, command names, and screenshots/log snippets that prove behavior without exposing secrets.
- Keep this evidence file under \`.updeng/docs/verification/\` with a \`.md\` extension.
- Mark an item complete only after the real app behavior was observed in a Tauri window or through an explicit real-target smoke command.
- Every HITL checklist item must stay in exact checkbox form, for example \`- [x] HITL-001 no-save-password: ...\`; mentioning a HITL id in prose is not completion evidence.
- Every completed HITL item must include structured, non-placeholder evidence under its \`Evidence:\` block. Required anchors: \`Target alias:\`, \`Observed:\`, \`Diagnostics:\`, \`Tool result:\`, \`Screenshot/log ref:\`, and \`Redaction review:\`.
- \`Observed:\`, \`Diagnostics:\`, and \`Tool result:\` must be specific evidence summaries, not \`ok\`, \`passed\`, or other one-word status. \`Diagnostics:\` must name managed runtime/session/channel/fallback/auth evidence such as \`recentLegacyFallbacks=[]\`, channel counts, backend, or bulk-transfer lane.
- \`HITL-008\` evidence must explicitly mention an active SFTP/transfer, terminal input typed or echoed while that transfer is active, and visible responsiveness/latency evidence such as \`within 1s\`, \`<=500ms\`, a measured latency, or an equivalent responsive-window observation.
- \`Screenshot/log ref:\` must include at least one existing local evidence file under \`.updeng/docs/verification/\`; optional external \`https://\` review links may be added only as supplemental refs with concrete artifact paths. External links must not use localhost or example domains. Separate multiple refs with commas or semicolons.
- Local text evidence files (\`.md\`, \`.log\`, \`.txt\`, \`.json\`, \`.toml\`, \`.yml\`, \`.yaml\`, \`.csv\`, \`.html\`) are scanned for the same obvious secret patterns as this checklist, including password/passphrase/private key material, vault/external secret refs, Bearer tokens, API keys, token env vars, and JSON/YAML secret fields. Binary screenshot/video artifacts (\`.png\`, \`.jpg\`, \`.jpeg\`, \`.gif\`, \`.mp4\`, \`.mov\`, \`.webm\`) are checked for existence/hash and require \`Redaction review:\` evidence confirming manual/OCR redaction review.
- For final closeout, generate a machine-readable report with \`--json-report .updeng/docs/verification/managed-ssh-hitl-YYYYMMDD.json\`; the report records item status, evidence/script hashes, local artifact hashes, and artifact validation without echoing matched secret text.
- Default managed success paths must keep \`recentLegacyFallbacks=[]\`; legacy fallback is acceptable only for explicit unsupported/unwired/compatibility cases.

## Execution Matrix

| HITL | Real target setup | Required actions | Required local artifacts |
| --- | --- | --- | --- |
| HITL-001 no-save-password | SSH host alias with no saved password or key passphrase in host TOML | Open terminal, enter password/passphrase inside current xterm, then use right SFTP, tmux/system/container/port/remote command/MCP without re-entering the same secret | xterm prompt screenshot, runtime snapshot JSON/log, downstream tool result log |
| HITL-002 saved-password-vault | SSH host alias whose host TOML contains only redacted secret refs and whose secret is in encrypted vault | Open terminal and SFTP through managed runtime, inspect sanitized host TOML and runtime diagnostics | sanitized host TOML snippet, runtime snapshot JSON/log, SFTP result log |
| HITL-003 private-key-passphrase | Private-key target with passphrase and no key material in evidence | Open terminal through managed runtime, enter passphrase through expected prompt path, then use SFTP/exec/MCP | passphrase prompt screenshot, runtime snapshot JSON/log, SFTP/exec result log |
| HITL-004 agent-auth | Target authenticating through ssh-agent | Open terminal, SFTP, and remote command without password prompt or fallback | agent target runtime snapshot JSON/log, SFTP and command result log |
| HITL-005 jump-host | Jump-host route with redacted jump and target aliases | Validate jump route, open terminal, SFTP, exec, port, and MCP without bypassing jump | redacted route diagnostics, runtime snapshot JSON/log, tool result log |
| HITL-006 external-launch-no-save | Real external launch source such as PuTTY/MobaXterm/Xshell/SecureCRT/OpenSSH/Kerminal native with no saved host password | Launch Kerminal externally, open managed tab, use right SFTP/exec/MCP with session-only auth; if it fails, record whether the visible dialog is "外部 SSH 启动未接收" or "外部 SSH 启动失败" | external launch redacted intake log, optional failure dialog screenshot/log, runtime snapshot JSON/log, tool result log |
| HITL-007 host-key-and-auth-cancel | Test target or controlled host-key/auth-cancel scenario | Trigger host-key-required/changed and auth cancel, confirm stable managed errors and no silent legacy connection | error screenshot/log, runtime snapshot JSON/log showing fallback state |
| HITL-008 disconnect-reconnect-concurrency | Real host capable of high terminal output, SFTP transfer, port forward, polling, and MCP command | Run high output, large transfer, polling, port forward, and MCP concurrently; while the transfer is active, type a terminal command and record input echo/result latency or visible responsive-window evidence; interrupt/reconnect and confirm cleanup | concurrency screenshot/video/log, terminal input latency/echo log, transfer log, runtime snapshot JSON/log showing bulk-transfer and cleanup |
| HITL-009 codex-claude-agent-prompt | Real Codex and Claude CLI available in Kerminal terminal | Exercise multiline input, paste/navigation keys, cancel keys, and optional submit smoke after managed SSH changes | Codex prompt screenshot/log, Claude prompt screenshot/log, terminal runtime diagnostics |
| HITL-010 diagnostics-and-redaction | Any real target used above plus settings/MCP diagnostics access | Capture settings diagnostics, runtime snapshot, tool_help/operation_guide/tool results, and right sidebar panels without managed SSH notice boxes | settings screenshot, runtime snapshot JSON/log, MCP/tool output log, sidebar screenshot |

## Required Evidence

- [ ] HITL-001 no-save-password: A real SSH host without saved password opens terminal, asks for password/passphrase inside the current xterm, then SFTP, tmux, system info, container, port forwarding, remote command, and MCP runtime tools reuse the same authenticated target without asking for the same secret again.
  Evidence:
  Target alias:
  Observed:
  Diagnostics:
  Tool result:
  Screenshot/log ref:
  Redaction review:

- [ ] HITL-002 saved-password-vault: A saved-password host uses encrypted vault material, host TOML contains only secret refs, and diagnostics/MCP/runtime output exposes only redacted auth fingerprints.
  Evidence:
  Target alias:
  Observed:
  Diagnostics:
  Tool result:
  Screenshot/log ref:
  Redaction review:

- [ ] HITL-003 private-key-passphrase: A private-key target with passphrase opens terminal through managed runtime; passphrase is entered through the expected prompt path, and SFTP/exec/MCP reuse the managed session without leaking key material.
  Evidence:
  Target alias:
  Observed:
  Diagnostics:
  Tool result:
  Screenshot/log ref:
  Redaction review:

- [ ] HITL-004 agent-auth: An SSH agent target opens terminal and at least SFTP plus remote command through managed runtime without password prompt or fallback.
  Evidence:
  Target alias:
  Observed:
  Diagnostics:
  Tool result:
  Screenshot/log ref:
  Redaction review:

- [ ] HITL-005 jump-host: A jump-host route validates both jump and target auth prompts or auth sources, keeps jump route in the redacted session key, and SFTP/exec/port/MCP do not bypass the jump host.
  Evidence:
  Target alias:
  Observed:
  Diagnostics:
  Tool result:
  Screenshot/log ref:
  Redaction review:

- [ ] HITL-006 external-launch-no-save: A real external SSH launch from PuTTY/MobaXterm/Xshell/SecureCRT/OpenSSH/Kerminal native no-save material opens a Kerminal tab and the right-side SFTP/exec/MCP tools reuse session-only auth.
  Evidence:
  Target alias:
  Observed:
  Diagnostics:
  Tool result:
  Screenshot/log ref:
  Redaction review:

- [ ] HITL-007 host-key-and-auth-cancel: Host-key-changed and auth-cancel paths return stable managed errors, show auth-required or host-key-required in diagnostics/model evidence, and do not silently open a legacy connection.
  Evidence:
  Target alias:
  Observed:
  Diagnostics:
  Tool result:
  Screenshot/log ref:
  Redaction review:

- [ ] HITL-008 disconnect-reconnect-concurrency: Terminal high output, a large SFTP transfer, system polling, a port forward, and an MCP command run together on a real target; while the transfer is active, typed terminal input is echoed or returns within a recorded latency/window, transfer uses bulk-transfer isolation where applicable, and reconnect/cleanup state is visible after interruption.
  Evidence:
  Target alias:
  Observed: <include active SFTP/transfer state, the terminal input typed while transfer was active, echo/result behavior, and recorded latency/window>
  Diagnostics:
  Tool result: <include transfer status plus the terminal command echo/result timing and any port/MCP/polling result>
  Screenshot/log ref:
  Redaction review:

- [ ] HITL-009 codex-claude-agent-prompt: Real Codex and Claude CLI prompts run inside Kerminal terminal after managed SSH changes; multiline input, paste/navigation keys, cancel keys, and optional submit smoke behave correctly.
  Evidence:
  Target alias:
  Observed:
  Diagnostics:
  Tool result:
  Screenshot/log ref:
  Redaction review:

- [ ] HITL-010 diagnostics-and-redaction: Settings diagnostics, \`kerminal.runtime_snapshot.managedSsh\`, tool help/operation guide, and actual tool results show session id/backend/channel/fallback state; right sidebar function panels show no red/orange/green managed SSH notices; no secret text appears in screenshots, logs, MCP output, or this evidence file.
  Evidence:
  Target alias:
  Observed:
  Diagnostics:
  Tool result:
  Screenshot/log ref:
  Redaction review:

## Suggested Commands

\`\`\`powershell
pnpm run smoke:ssh-terminal:password
pnpm run smoke:ssh-terminal:password:wsl
cargo test --manifest-path src-tauri/Cargo.toml --test terminal_agent_cli_hitl_matrix -- --ignored --nocapture
pnpm run build
pnpm run tauri:dev
pnpm run verify:managed-ssh-hitl -- --check .updeng/docs/verification/managed-ssh-hitl-YYYYMMDD.md --json-report .updeng/docs/verification/managed-ssh-hitl-YYYYMMDD.json
pnpm run verify:managed-ssh-hitl -- --preflight --json-report .updeng/docs/verification/managed-ssh-hitl-preflight-YYYYMMDD.json
\`\`\`
`;
}
export function captureGuideTemplate(now) {
  const generatedAt = now.toISOString();
  return `# Managed SSH HITL Capture Guide

生成时间：${generatedAt}

这是一份真实主机人工采集清单，不是完成证明。不要把密码、私钥正文、passphrase、vault 引用、token、原始环境变量、需要保密的公网 IP、未脱敏的用户名或本机路径写进任何文件。

## 最终要交的文件

- 证据文档：\`.updeng/docs/verification/managed-ssh-hitl-YYYYMMDD.md\`
- JSON 报告：\`.updeng/docs/verification/managed-ssh-hitl-YYYYMMDD.json\`
- 最终检查命令：

\`\`\`powershell
pnpm run verify:managed-ssh-hitl -- --check .updeng/docs/verification/managed-ssh-hitl-YYYYMMDD.md --json-report .updeng/docs/verification/managed-ssh-hitl-YYYYMMDD.json
\`\`\`

## 操作规则

- 目标只写别名，例如 \`target-no-save\`、\`target-vault\`、\`target-agent\`、\`jump-redacted\`。
- 每个 HITL 项至少放 1 个本地证据文件，位置必须在 \`.updeng/docs/verification/\`。
- 文本证据只保留短日志或总结。截图、录屏要在证据文档里写明已人工或 OCR 脱敏检查。
- 正常 managed 路径应看到 \`recentLegacyFallbacks=[]\` 或等价的空 fallback。若出现 fallback，必须写清是 unsupported、unwired 还是显式兼容路径。
- 右侧所有功能栏不能出现 managed SSH 红色、橙色或绿色提示框；诊断信息只放在设置页、MCP 或 runtime 输出里。
- 填 evidence 时每项都保留这 6 个英文锚点：\`Target alias:\`、\`Observed:\`、\`Diagnostics:\`、\`Tool result:\`、\`Screenshot/log ref:\`、\`Redaction review:\`。

## 建议文件名

| HITL | 建议本地证据文件 |
| --- | --- |
| HITL-001 no-save-password | \`managed-ssh-hitl-001-xterm-prompt.png\`, \`managed-ssh-hitl-001-runtime.json\`, \`managed-ssh-hitl-001-tools.log\` |
| HITL-002 saved-password-vault | \`managed-ssh-hitl-002-host-toml-sanitized.md\`, \`managed-ssh-hitl-002-runtime.json\`, \`managed-ssh-hitl-002-sftp.log\` |
| HITL-003 private-key-passphrase | \`managed-ssh-hitl-003-xterm-prompt.png\`, \`managed-ssh-hitl-003-runtime.json\`, \`managed-ssh-hitl-003-tools.log\` |
| HITL-004 agent-auth | \`managed-ssh-hitl-004-runtime.json\`, \`managed-ssh-hitl-004-sftp-command.log\` |
| HITL-005 jump-host | \`managed-ssh-hitl-005-route-redacted.md\`, \`managed-ssh-hitl-005-runtime.json\`, \`managed-ssh-hitl-005-tools.log\` |
| HITL-006 external-launch-no-save | \`managed-ssh-hitl-006-external-launch-redacted.log\`, \`managed-ssh-hitl-006-dialog.png\`, \`managed-ssh-hitl-006-runtime.json\`, \`managed-ssh-hitl-006-tools.log\` |
| HITL-007 host-key-and-auth-cancel | \`managed-ssh-hitl-007-error.png\`, \`managed-ssh-hitl-007-runtime.json\`, \`managed-ssh-hitl-007-errors.log\` |
| HITL-008 disconnect-reconnect-concurrency | \`managed-ssh-hitl-008-concurrency.mp4\`, \`managed-ssh-hitl-008-latency.log\`, \`managed-ssh-hitl-008-transfer.log\`, \`managed-ssh-hitl-008-runtime.json\` |
| HITL-009 codex-claude-agent-prompt | \`managed-ssh-hitl-009-codex.png\`, \`managed-ssh-hitl-009-claude.png\`, \`managed-ssh-hitl-009-terminal-diagnostics.json\` |
| HITL-010 diagnostics-and-redaction | \`managed-ssh-hitl-010-settings.png\`, \`managed-ssh-hitl-010-runtime.json\`, \`managed-ssh-hitl-010-mcp-tools.log\`, \`managed-ssh-hitl-010-sidebar.png\` |

## 填写方法

### HITL-001 no-save-password

1. 准备一个没有保存凭据的真实 SSH 主机，只记录别名。
2. 在 Kerminal 打开 SSH terminal，在当前 xterm 里输入认证内容。
3. 不要重新输入同一份认证内容，继续打开右侧文件、tmux 或系统面板、端口转发、远程命令和 MCP 工具。
4. 证据写清 managed backend、session、channel 状态和各工具结果。

### HITL-002 saved-password-vault

1. 使用凭据已保存到 encrypted vault 的主机。
2. host TOML 截图或片段只能显示脱敏引用，不能显示真实 secret。
3. 打开 terminal 和 SFTP，记录 runtime 诊断和 SFTP 成功结果。

### HITL-003 private-key-passphrase

1. 使用需要 passphrase 的私钥主机，不记录私钥正文。
2. 确认 passphrase 走当前终端 prompt。
3. 不再次输入 passphrase，复用 SFTP、exec、MCP，并记录诊断和结果。

### HITL-004 agent-auth

1. 使用 ssh-agent 可认证的真实主机。
2. 打开 terminal、SFTP 和一个远程命令。
3. 证据要说明没有认证弹窗、没有 legacy fallback。

### HITL-005 jump-host

1. 使用真实跳板机链路，跳板和目标都只写别名。
2. 验证 terminal、SFTP、exec、端口转发和 MCP 都经过跳板链路。
3. 诊断里要能看到脱敏 route/session key，证明工具没有绕过跳板机。

### HITL-006 external-launch-no-save

1. 从真实外部启动来源打开 Kerminal，例如 PuTTY、MobaXterm、Xshell、SecureCRT、OpenSSH 或 Kerminal native。
2. 不保存凭据，只用 session-only 认证打开 managed tab。
3. 如果能打开 managed tab，继续使用右侧 SFTP、exec、MCP，记录脱敏 intake、runtime 诊断和工具结果。
4. 如果外部工具打开了 Kerminal 但没有进入 tab，保存弹窗或日志：看到“外部 SSH 启动未接收”表示参数未进入 pending 队列或被策略拒绝；看到“外部 SSH 启动失败”表示 pending 已接收但 materialize/open tab 失败。
5. SecureCRT/Xshell 出现 \`Unknown server key\` 时，先按“主机密钥确认”处理，再复测外部启动。

### HITL-007 host-key-and-auth-cancel

1. 这项测的是“主机密钥确认”和“取消登录”，不是常规成功连接。
2. 遇到未知或变化的主机密钥时，Kerminal 要明确提示；如果选择信任，再继续连接。
3. 在密码、passphrase 或主机密钥确认时点取消，Kerminal 要停止连接，不偷偷换旧连接方式。
4. 保存错误界面或日志、runtime fallback 状态。

### HITL-008 disconnect-reconnect-concurrency

1. 同时运行高输出 terminal、一个正在传输的 SFTP、系统轮询、端口转发和一个 MCP 命令。
2. 传输进行中，在 terminal 输入一条命令。
3. 记录输入回显或结果时间，例如 \`within 1s\`、\`<=500ms\` 或实测 latency。
4. 再做一次断开或重连，保存清理状态。

### HITL-009 codex-claude-agent-prompt

1. 在 Kerminal terminal 里启动真实 Codex CLI 和 Claude CLI。
2. 验证多行输入、粘贴、方向键/导航键和取消键。
3. 若要做 submit smoke，必须在证据里明确写允许提交；否则只做 no-submit 检查。
4. 保存脱敏截图、短日志和 terminal runtime 诊断。

### HITL-010 diagnostics-and-redaction

1. 保存设置页诊断、\`kerminal.runtime_snapshot.managedSsh\`、tool help、operation guide 和真实工具结果。
2. 保存右侧功能栏截图，确认没有 managed SSH 红/橙/绿提示框。
3. 运行最终检查前，逐个检查证据文件，确认没有 secret、私钥、token 或未脱敏路径。
`;
}
