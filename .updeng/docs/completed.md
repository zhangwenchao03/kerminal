# 已完成能力

只记录当前仍有效、可复用的产品能力。已退场或被新架构替代的旧能力不在这里保留；历史证据仍可在 `plan/done/`、ADR 和对应报告中查找。

- 2026-06-24：[终端分屏控件上下文化调整](plan/done/PLAN-20260623-235501-terminal-split-contextual-controls.md) 已完成。单 pane 下不再常驻批量/分屏命令栏；分屏入口移动到 pane 标题栏，分屏出来的新会话只继承源 pane 的 cwd/currentCwd，不继承输出历史；多 pane 后显示批量发送栏和目标选择。验证记录见计划 Round Log。
- 2026-06-29：[SSH 凭据加密文件库与统一认证运行时](plan/done/PLAN-20260626-164938-ssh-credential-vault-auth-runtime.md) 已完成。SSH password、inline private key 和 key passphrase 通过 workspace encrypted vault 保存，公开 host TOML 只保留 `secret_ref`；终端、SFTP、SSH command、port forwarding、Docker/Compose、tmux、server info 和 MCP tools 共用 resolver，列表、日志和 validator 不批量返回明文。
- 2026-06-23：[SSH 跳板机能力完整落地实施计划](plan/done/PLAN-20260623-112143-ssh-jump-host-capability.md) 已完成。已保存 SSH 主机的跳板链统一接入 SSH terminal、SFTP、native command、server info、port forwarding、Docker/container、command suggestion 和远程工具路径；密码主机作为跳板时保留 `password` 与已保存密码 secret。
- 2026-06-22：[SFTP 传输工作台生产级完整实现计划](plan/done/2026-06-20-cross-host-sftp-transfer-workbench.md) 已完成。SFTP 传输工作台已形成生产级双面板文件传输体验：本机/远端面板、传输入队、拖拽、复制/粘贴、跨主机传输、ZIP 上传/下载、冲突 preflight 和 `overwrite` / `skip` / `rename` 策略均已闭环。
- 2026-06-21：[SSH 隧道右栏与主机网络助手实施计划](plan/done/2026-06-21-ssh-tunnel-network-assist.md) 已完成。支持 SSH local/remote/dynamic forwarding、主机网络助手、本机受管 HTTP CONNECT proxy、远端 SOCKS、代理注入和无外网主机临时使用本机网络出口。
- 2026-06-20：[Serial 和 Telnet 能力实现](plan/done/2026-06-20-serial-telnet-capabilities.md) 已完成。Telnet/Serial 主机创建、保存、侧边栏打开、工作区分屏、终端启动、命令历史和日志目标闭环完成；Serial 支持串口参数配置。
- 2026-06-19：[SFTP 高级文件管理交互](plan/done/2026-06-18-sftp-advanced-file-manager.md) 已完成。SFTP 面板支持本地文件/目录拖拽上传、远端拖拽下载、远端多选、批量下载、剪贴板复制/粘贴、跨主机传输、下载为 ZIP 和上传为 ZIP。
- 2026-06-18：[Native SFTP Manager](plan/done/2026-06-18-native-sftp-manager.md) 已完成。SFTP 文件管理改为原生 `russh` + `bssh-russh-sftp` backend，覆盖 host key 信任、目录浏览、预览、上传/下载、递归传输、队列、进度、取消、chmod、删除、重命名和性能设置。
