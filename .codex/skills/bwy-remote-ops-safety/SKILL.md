---
name: bwy-remote-ops-safety
description: |
  用于远程运维安全相关任务，例如服务器诊断、Linux 命令、部署检查、Nginx、Docker、端口、systemctl、远程日志、生产排查或远程命令执行。仅本地代码实现、常规文档任务不使用；除删除、清空、销毁类操作外，其它远程操作可按需执行；删除类操作必须先获得用户明确确认，并说明影响范围和回滚方案。
---

# 远程运维安全规范

## 默认边界

- 默认允许低风险诊断和非危险操作，包括查看状态、读取日志、拉取排查文件、列目录、查询端口、查询磁盘和进程。
- 不把普通只读命令、`fetch` 拉取日志、`--dry-run`、本地创建排查输出目录等低风险动作拦截为危险操作。
- 除删除东西外，其它操作默认可执行，包括远程持久化写入、权限变更、服务状态变更、数据修改、部署检查和批量非删除操作。
- 删除、清空或销毁类动作必须先说明目的、影响范围、回滚方式，并获得用户明确授权；包括 `rm`、`unlink`、`truncate`、`drop`、`delete from`、Redis `flush*/del/unlink`、Docker `rm/rmi/prune`、Kubernetes `delete`、包卸载等。
- 密钥、密码、token 不写入仓库和文档。
- 服务器命令输出涉及敏感信息时只总结必要部分。
- 安全拦截要高信号低误伤：只有明确属于删除、清空、销毁类动作才阻断；其它命令按目标配置直接执行。
- 执行被判定为删除类的远程命令前，把最终命令原样展示给用户确认。

## 配置位置

- 服务器配置统一读取目标项目工作目录下的 `.updeng/docs/config/`。
- 优先读取目标项目的 `.updeng/docs/config/remote-servers.json`。
- 若目标项目只有模板文件，则回退读取 `.updeng/docs/config/remote-servers.example.json`。
- 只有在显式传入 `--config` 时，才读取指定路径。
- 目标项目缺少配置时，先运行 `updeng update <project>` 补齐 `.updeng/docs/config/remote-servers.example.json`，再复制为本地 `.updeng/docs/config/remote-servers.json` 并按项目实际值修改。
- `remote-servers.json` 用于保存实际主机、账号、部署路径和本机联调信息，必须加入 `.gitignore`，不提交仓库。
- `remote-servers.example.json` 只放可复制的示例结构，不写真实密码、token、私钥、生产敏感地址或一次性凭据。
- 历史临时目录不要作为配置入口；后续统一维护 `.updeng/docs/config/`。

## 远程服务器配置字段

- `host`、`port`、`user`：SSH 连接目标。
- `identity_file`、`jump_host`：可选字段，分别表示 SSH 私钥和跳板机。
- `ssh_backend`：可选值为 `auto`、`paramiko`、`ssh`。默认 `auto`；配置了 `password` 且未使用跳板机等 OpenSSH 专属选项时，脚本优先用 Paramiko 直接建立 Python SSH 会话。
- `password`：仅允许写在已忽略的本地 `remote-servers.json`；Paramiko 后端会读取该字段用于登录，不要写入示例文件、提交文件或长期文档。
- `paths`：项目部署路径元数据，常用键包括 `java_backend`、`livekit`、`openresty`。
- `security_mode`：`safe`、`readonly`、`restricted`、`unrestricted`。默认 `safe`。
- `allow_patterns` / `deny_patterns`：远程命令正则。`deny_patterns` 优先；`restricted` 无 allowlist 时拒绝执行。
- `path_allowlist` / `path_denylist`：限制 `fetch` 可读取的远程路径。
- `audit_log`：本地 JSONL 审计文件路径，记录目标、动作、命令、是否允许、退出码和拒绝原因。
- `command_aliases`：常用命令别名，脚本会先展开别名再做策略检查。
- `connect_timeout` / `command_timeout_sec`：连接超时和远程命令超时。
- `batch_mode`：是否启用 OpenSSH `BatchMode`。仅 `ssh_backend=ssh` 时传给系统 OpenSSH；密码登录建议使用 Paramiko 后端。
- `host_key` / `host_key_fingerprint` / `host_key_sha256`：Paramiko 后端可选的主机指纹校验字段，支持 `SHA256:...` 格式。
- `strict_host_key_checking` / `user_known_hosts_file`：SSH 主机校验策略；真实服务器指纹应通过可信渠道核对后再加入。
- `description`：目标说明。

## 推荐只读命令

- `pwd`
- `ls -lah`
- `df -h`
- `free -h`
- `ps -ef | grep <name>`
- `ss -lntp`
- `tail -n 200 <log>`
- `grep -n "<keyword>" <log>`
- `systemctl status <service>`（只看状态，不重启）

## 常用例子

诊断命令：

```powershell
node .codex/skills/bwy-remote-ops-safety/scripts/remote_ops.js exec --target dev-app-01 --command "systemctl status app"
node .codex/skills/bwy-remote-ops-safety/scripts/remote_ops.js exec --target dev-app-01 --command "tail -n 200 /opt/app/logs/app.log"
node .codex/skills/bwy-remote-ops-safety/scripts/remote_ops.js fetch --target dev-app-01 --remote-path /opt/app/logs/app.log --local-path ./tmp/app.log
```

删除类授权说明模板：

```markdown
准备执行删除类远程命令：

- target：<server>
- 命令：`<exact command>`
- 影响范围：<会删除什么>
- 回滚方案：<备份、重建或不可回滚说明>
- 执行理由：<为什么需要删除>

请明确确认后再执行。
```

## 远程脚本

优先使用技能内的脚本：

```text
node .codex/skills/bwy-remote-ops-safety/scripts/remote_ops.js list
node .codex/skills/bwy-remote-ops-safety/scripts/remote_ops.js validate
node .codex/skills/bwy-remote-ops-safety/scripts/remote_ops.js exec --target dev-app-01 --command "df -h"
node .codex/skills/bwy-remote-ops-safety/scripts/remote_ops.js exec --target dev-app-01 --alias app-status
node .codex/skills/bwy-remote-ops-safety/scripts/remote_ops.js probe --target prod-app-01 --probe basic
node .codex/skills/bwy-remote-ops-safety/scripts/remote_ops.js fetch --target test-app-01 --remote-path /opt/app/logs/app.log --local-path ./tmp/app.log
```

脚本能力：

- 按目标项目的 `.updeng/docs/config/remote-servers*.json` 读取不同环境的服务器配置。
- 默认只拦截删除、清空、销毁类命令；其它命令可执行。
- 支持 `list`、`validate`、`exec`、`probe`、`fetch`。
- 支持上文配置字段，包括安全模式、命令 allow/deny、拉取路径 allow/deny、审计日志、命令别名、SSH 后端和连接参数。
- Paramiko 依赖缺失时，脚本会尝试通过 `uv run --with paramiko>=3.5,<4` 重新运行；生产密码只允许保存在已忽略的本地 `remote-servers.json`。

## 安全模式

- `safe`：默认模式。除删除、清空、销毁类操作外直接执行；删除类操作需要先说明影响和回滚，再由用户授权后追加 `--allow-write`。
- `readonly`：保留目标侧只读意图；内置策略会拒绝删除类操作，即使带 `--allow-write` 也拒绝。
- `restricted`：命令必须匹配 `allow_patterns`，且不能匹配 `deny_patterns`；适合 CI、第三方 agent 或临时授权账号。
- `unrestricted`：脚本层不做命令过滤，仅适合本地可信测试环境；生产环境不要使用。

## 使用要求

- 使用这个技能时，应先进入目标项目目录再执行脚本。
- 推荐由目标项目自己维护 `.updeng/docs/config/README.md`、`remote-servers.json`、`remote-servers.example.json`。
- 新项目没有远程配置时，优先复制 `.updeng/docs/config/remote-servers.example.json` 作为本地 `remote-servers.json`；真实服务器信息只补到已忽略的本地文件。
- 真实服务器信息由使用者在本地按需补充；提交前确认本地敏感配置未被 Git 跟踪。

## 写操作要求

- 只有删除、清空、销毁类命令被脚本拦截时，才需要先获得用户明确授权。
- 获得删除授权后，才可在 `exec` 时追加 `--allow-write`。
- 对删除类命令，即使传入 `--allow-write`，也应先向用户说明影响范围与回滚方案。
- `readonly` target 不接受 `--allow-write` 绕过删除类拦截；如确需删除，先改为专门的授权 target，并记录原因。
