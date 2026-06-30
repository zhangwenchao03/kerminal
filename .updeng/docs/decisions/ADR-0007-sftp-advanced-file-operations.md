# ADR-0007: SFTP Advanced File Operations

## 状态

Accepted

## 背景

- Kerminal 已有原生 SFTP 后端、传输队列、进度、取消、并发上限和基础文件管理操作。
- 用户期望 SFTP 面板具备成熟客户端常见体验：拖拽上传下载、`Ctrl+C` / `Ctrl+V`、不同主机之间传输和压缩/归档。
- SFTP 协议主要提供远端文件系统访问，不内建任意两台 SSH 主机之间的服务器端复制，也不内建通用压缩/归档语义。

## 决策驱动因素

- 用户体验要接近 MobaXterm、WinSCP、FileZilla 等成熟客户端。
- 协议边界必须诚实：不能把需要 shell、临时文件或客户端编排的能力写成 SFTP 原生命令。
- 文件操作必须进入现有传输队列，继承并发、进度、取消和失败展示；复合任务允许在队列中作为单一用户任务展示。
- 跨平台实现优先；平台特有增强只能作为可选层。

## 备选方案

| 方案 | 优点 | 缺点 | 风险 | 验证方式 |
| --- | --- | --- | --- | --- |
| 全部尝试用 SFTP 协议直接实现 | 概念简单 | SFTP 不提供跨主机复制和通用压缩；大多数服务器不支持 copy 扩展 | 用户看到不可预测失败 | 不采用 |
| 依赖远端 shell 的 `cp`、`tar`、`scp` | 同主机复制/压缩可能很快 | 依赖远端 shell、命令、权限和环境；不同系统差异大 | 安全和兼容性风险高 | 仅作为后续显式高级动作 |
| Kerminal 本机编排：拖放上传、内部剪贴板、跨主机优先经本机流式桥接、必要时临时中转、压缩作为显式 archive job | 跨平台可控；能复用现有队列；失败原因可见；跨主机大文件默认不落本地临时盘 | 仍受本机到两台主机的网络路径影响；少数安全回退场景仍占用临时磁盘 | 需要清理临时文件和暴露磁盘风险 | 采用 |
| 平台特有 OS 文件剪贴板集成 | 与原生文件管理器体验最好 | Windows/macOS/Linux 剪贴板文件格式差异大 | 需要平台分支和清晰不支持口径 | 采用 Windows CF_HDROP 读取/写入首切片，其他平台后续增强 |

## 决策

采用 Kerminal 本机编排作为高级 SFTP 文件操作的默认架构。

原因：

- 拖拽上传使用 Tauri 原生 drag/drop 获取本地路径，再按文件/目录分类加入现有上传队列。
- `Ctrl+C` / `Ctrl+V` 先使用 Kerminal 内部 SFTP 剪贴板，记录源 host、源 remote path、kind 和操作意图；当内部剪贴板为空时，Windows 读取系统 CF_HDROP 文件剪贴板并加入上传队列，其他平台暂返回空列表。
- SFTP 面板支持远程条目多选；多项 `Ctrl+C` 会把所有可传输条目写入内部 SFTP 剪贴板，多项下载则显式选择一个本地目录后逐项进入现有下载队列。ZIP 下载和下载到本地文件剪贴板保持单条目语义，避免多项归档/剪贴板语义不清。
- 拖拽下载采用界面内投放区实现：远端条目作为 HTML 拖拽源，释放到 SFTP 面板后复用单项/批量下载队列。系统级把远端文件直接拖出到桌面仍不是当前 Tauri Webview 的稳定公开能力。
- 下载侧先采用显式“下载到剪贴板”：后端把选中远端文件或目录下载到系统 Downloads 目录下的唯一目标路径，下载成功后 Windows 写入 CF_HDROP 文件剪贴板；`Ctrl+C` 不改为下载语义，以保留远程复制和跨主机粘贴能力。
- 不同主机之间传输默认使用 Kerminal 本机流式桥接：同时持有 source host 和 target host 的 SFTP 连接槽，从源远端文件读出并直接写入目标远端文件，最终作为一个用户可见 composite job 展示。若用户配置的全局并发小于跨主机流式复制所需连接槽，或同主机目录复制目标位于源目录子树内，则回退到本机临时目录中转，避免等待永远无法满足的并发条件或递归复制自身。
- 压缩/归档设计为显式 archive job。已落地两条默认路径：“下载为 ZIP”会把远端文件或目录先下载到本机临时目录，再由 Kerminal 在本机生成 zip；“上传为 ZIP”会把本地文件或目录先在本机临时目录压缩为 zip，再通过 SFTP 上传。后续可扩展用户显式选择的远端 shell 压缩后再 SFTP 下载。默认不隐式执行远端命令。
- 同一主机远程复制优先使用同一 SFTP 会话内的客户端流式复制；目录复制到自身子树时降级为本地临时中转，避免流式遍历时递归复制新生成目录。

## 影响

- 正向影响：高级文件管理能力可以沿用现有传输队列、并发、进度、取消和错误模型。
- 负向影响：跨主机复制仍受本机到两台主机的网络路径限制；低并发配置或递归风险回退场景会占用本机临时磁盘。
- 平台影响：Windows 文件剪贴板读写依赖 CF_HDROP；macOS/Linux 暂不承诺同等系统剪贴板文件语义。
- 需要同步修改：SFTP 前端交互、Tauri drag/drop 配置、本地路径分类 command、内部剪贴板状态、composite transfer 模型和 archive job 模型。

## 回滚或替代

- 如果 Tauri 原生 drag/drop 在某平台不可用，保留现有“上传文件/上传文件夹”按钮作为可靠入口。
- 如果跨主机流式桥接的性能仍无法接受，后续可增加用户显式选择的远端 shell `scp` / `rsync` / `tar` 路径，但不作为默认。
- 如果 OS 文件剪贴板集成不稳定，不影响内部 SFTP 剪贴板和按钮入口。
- 当前 Tauri 2 只稳定暴露文件拖入事件，没有公开跨平台文件 drag-out 源 API；如果后续要支持真原生拖出，需要新增平台插件。未实现前保留界面内拖拽下载、“下载到剪贴板”和普通下载作为下载侧入口。

## 验证

- `npm run typecheck`
- `npm run test:frontend -- src/features/sftp/SftpToolContent.test.tsx src/lib/sftpApi.test.ts`
- `npm run test:rust -- sftp`
- 桌面版手工 smoke：拖放本地文件和目录到 SFTP 面板，确认进入上传队列。

## 外部依据

- MobaXterm SSH 会话提供图形 SFTP 浏览器，并支持向/从远端拖放文件：https://mobaxterm.mobatek.net/features.html
- WinSCP 支持从本地面板或 Windows Explorer 拖放上传，也支持复制本地文件后在 WinSCP 内 `Ctrl+V` 上传：https://winscp.net/eng/docs/task_upload
- FileZilla 使用本地/远端双面板、拖放和 transfer queue 组织传输，并说明传输使用独立连接以便浏览不中断：https://wiki.filezilla-project.org/Using
- WinSCP 说明直接远端到远端传输不是 SFTP 协议内建能力：https://winscp.net/eng/docs/faq_fxp
- WinSCP 不同 session duplicate 只能通过本地临时副本；同 session direct copy 依赖服务器扩展或额外 shell session：https://winscp.net/eng/docs/ui_duplicate
