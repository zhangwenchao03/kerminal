# Kerminal

Kerminal 是一个多平台开发者终端工作台，目标是把本地终端、SSH/SFTP、分屏、主机管理、脚本片段、服务器信息和 AI Agent 放在同一个桌面应用里。

当前技术栈：

- Tauri 2 + Rust
- React 19 + TypeScript + Vite
- Tailwind CSS + shadcn/ui 风格组件 + lucide-react
- xterm.js 终端渲染
- SQLite 本地持久化，数据目录为 `~/.kerminal`

## 开发命令

```powershell
npm install
npm run dev
npm run tauri dev
```

## 验证命令

```powershell
npm run typecheck
npm run test:frontend
npm run test:rust
npm run build
npm run check:ssh-command-ghost
npm run verify:command-suggestion-latency
npm run verify:terminal-ghost-visual
npm run verify:terminal-ghost-app
npm run verify:terminal-ghost-frame
```

`check:ssh-command-ghost` 是 SSH 远程命令灰色提示的本地生产门禁，会串联终端输入/渲染目标测试、混合 provider 延迟门禁、本地 russh SSH/SFTP loopback smoke、本机 OpenSSH password terminal loopback smoke，以及 ghost overlay 帧预算、静态视觉、真实 xterm alternate-screen 和完整 React/Vite 应用链路检查。

`verify:command-suggestion-latency` 会用 10k history、5k remote commands、1k remote paths 和 1k Git refs 的本地缓存 fixture 跑非 ignored Rust 门禁，要求 history/spec、remoteCommand、remotePath 和 Git provider 查询的 median/max 延迟保持在预算内。

`verify:terminal-ghost-visual` 会生成 headless Chrome 截图和 JSON 断言，覆盖亮/暗主题下 ASCII 输入以及中文宽字符输入后的灰色后缀对齐和可读性。

`verify:terminal-ghost-app` 会启动真实 Vite 应用并用 headless Chrome 驱动 SSH pane，使用 fake Tauri IPC 返回 remoteCommand 候选，断言 DOM overlay、`data-provider=remoteCommand`、RightArrow 接受反馈和写入路径。

本地 loopback SSH/SFTP 灰色提示 smoke 不需要外部主机，会在本机启动临时 russh + SFTP server，覆盖 native russh 凭据执行、app `known_hosts`、远端 shell history 只读缓存、remoteCommand/remotePath/Git 刷新、慢响应/大输出/大目录下的缓存条数上限、刷新失败不破坏已有缓存，以及关闭 server 后的 SQLite cache-only 查询：

```powershell
npm run smoke:ssh-suggestions:loopback
```

Windows 开发机如果已有 WSL 发行版且其中已安装 OpenSSH Server、`ssh-keygen`、`git` 和 `sh`，可以运行临时真实 sshd smoke。脚本会在 WSL 内创建临时 `sshd`、Git repo、远端 history 和 PATH 命令，复用真实 SSH/SFTP smoke，并强制验证 POSIX `sh` builtin 候选的 `source=posixBuiltin` metadata；结束后清理临时 sshd 和密钥。可用 `KERMINAL_WSL_SMOKE_DISTRO=<distro>` 指定发行版：

```powershell
npm run smoke:ssh-suggestions:wsl
```

受限 `/bin/sh` 环境可以运行最小 PATH smoke。该模式的临时 sshd 只暴露一个包含 `sh` 的 PATH，不要求 Git、history 或 PATH 命令候选命中，只验证 remoteCommand 通过真实 OpenSSH 链路仍能返回 POSIX builtin 灰色提示：

```powershell
npm run smoke:ssh-suggestions:wsl:posix
```

交互式 SSH terminal 的 password 自动响应也有本地 loopback smoke。该入口只需要本机 OpenSSH client，不需要 WSL、外部测试主机、远端 fish/zsh 插件或远端联网；测试会在进程内启动 russh loopback server，验证 Kerminal 的 `SshTerminalService -> TerminalManager -> OpenSSH PTY` 路径能使用保存密码登录、写入 ASCII/UTF-8 中文命令、错密不进入 shell，并确保输出不泄露保存密码：

```powershell
npm run smoke:ssh-terminal:password:loopback
```

Windows 开发机如果 WSL 可用 root 用户，并且发行版中有 OpenSSH Server、`ssh-keygen`、`useradd`、`chpasswd` 和 `sh`，可以运行真实 OpenSSH password 交互终端 smoke。脚本会在 WSL 内创建临时用户、一次性密码和临时 `sshd`，通过 Kerminal 的交互式 SSH terminal 路径自动响应 password prompt，写入 ASCII 和 UTF-8 中文 PTY 命令并断言输出不泄露密码；结束后删除临时用户、sshd 和目录：

```powershell
npm run smoke:ssh-terminal:password:wsl
```

错误保存密码路径也有真实 OpenSSH smoke。脚本会使用临时主机的真实密码启动 `sshd`，但让 Kerminal 保存一个错误密码，验证自动响应只走失败路径、不进入已认证 shell，并且输出不泄露错误密码：

```powershell
npm run smoke:ssh-terminal:password:wsl:wrong
```

真实 SSH/SFTP 灰色提示 smoke 需要显式配置一台非生产测试主机，默认不会静默通过：

```powershell
$env:RUN_KERMINAL_SSH_SMOKE = "1"
$env:KERMINAL_SSH_SMOKE_HOST = "127.0.0.1"
$env:KERMINAL_SSH_SMOKE_USER = "dev"
$env:KERMINAL_SSH_SMOKE_PASSWORD = "<password>"
npm run smoke:ssh-suggestions
```

也可以用 `KERMINAL_SSH_SMOKE_PRIVATE_KEY`、`KERMINAL_SSH_SMOKE_KEY_PATH` 或 `KERMINAL_SSH_SMOKE_AUTH=agent` 认证；加密内联私钥可设置 `KERMINAL_SSH_SMOKE_PRIVATE_KEY_PASSPHRASE`。该全链路 smoke 会同时跑 remoteCommand/Git/远端 shell history 的 native russh 探测和 SFTP 路径探测，用来证明不依赖远端 fish/zsh 插件或本机 OpenSSH password helper。可选变量：`KERMINAL_SSH_SMOKE_PORT`、`KERMINAL_SSH_SMOKE_CWD`、`KERMINAL_SSH_SMOKE_PATH`、`KERMINAL_SSH_SMOKE_COMMAND_PREFIX`、`KERMINAL_SSH_SMOKE_BUILTIN_COMMAND`、`KERMINAL_SSH_SMOKE_BUILTIN_PREFIX`、`KERMINAL_SSH_SMOKE_PATH_PREFIX`、`KERMINAL_SSH_SMOKE_GIT_PREFIX`、`KERMINAL_SSH_SMOKE_HISTORY_PREFIX`；设置 `KERMINAL_SSH_SMOKE_HISTORY_PREFIX` 时会强制断言远端 shell history 候选命中，否则只断言刷新链路和审计记录。

真实 OpenSSH password 交互终端 smoke 也可以指向外部非生产主机，默认同样保持非零门禁。它会走 `SshTerminalService -> TerminalManager -> OpenSSH PTY`，验证保存密码自动响应、ASCII/UTF-8 中文命令写入和输出脱敏：

```powershell
$env:RUN_KERMINAL_SSH_TERMINAL_PASSWORD_SMOKE = "1"
$env:KERMINAL_SSH_TERMINAL_SMOKE_HOST = "127.0.0.1"
$env:KERMINAL_SSH_TERMINAL_SMOKE_USER = "dev"
$env:KERMINAL_SSH_TERMINAL_SMOKE_PASSWORD = "<password>"
npm run smoke:ssh-terminal:password
```

可选变量：`KERMINAL_SSH_TERMINAL_SMOKE_PORT`、`KERMINAL_SSH_TERMINAL_SMOKE_KNOWN_HOST_LINE`、`KERMINAL_SSH_TERMINAL_SMOKE_READY_MARKER` 和 `KERMINAL_SSH_TERMINAL_SMOKE_EXPECT_AUTH_FAILURE=1`。未提供 known_hosts 行时测试会尝试用本机 `ssh-keyscan` 获取主机公钥。设置 `EXPECT_AUTH_FAILURE=1` 时，提供的 password 会被当作错误保存密码，测试会断言认证失败且不泄露该值。

## 发布与自动更新

桌面端发布使用 GitHub Releases。推送 `vX.Y.Z` tag 后，
`.github/workflows/release.yml` 会在 Windows、Linux、macOS x64 和 macOS
arm64 上构建安装包，并上传 Tauri updater 需要的签名产物和 `latest.json`。

```powershell
git tag v0.1.0
git push origin main
git push origin v0.1.0
```

Updater 签名私钥不要提交到仓库。CI 需要配置：

```text
TAURI_SIGNING_PRIVATE_KEY
TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 在当前无密码私钥配置下可以留空。

完整产品计划在本地 Updeng 文档中维护，公开仓库只提交源码、构建配置和发布说明。

