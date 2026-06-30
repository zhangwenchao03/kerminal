---
id: PLAN-20260618-000030-sftp-advanced-file-manager
status: done
created_at: 2026-06-18T00:00:30+08:00
started_at: 2026-06-18T00:00:30+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# SFTP 高级文件管理交互

## 目标

- 参考 MobaXterm、WinSCP、FileZilla 等成熟 SFTP/文件传输客户端，补齐 Kerminal SFTP 面板的常见文件管理交互。
- 支持把本地文件或目录拖拽到 SFTP 面板后加入上传队列。
- 支持把远端条目拖到 SFTP 面板下载投放区后加入下载队列。
- 支持远程条目选择、内部 SFTP 剪贴板和 `Ctrl+C` / `Ctrl+V` 文件管理入口，为远程复制、跨主机复制和后续本地文件剪贴板上传打基础。
- 支持远程多选、批量复制到内部 SFTP 剪贴板，以及批量下载到同一个本地目录。
- 支持内部 SFTP 剪贴板粘贴后创建真实远程复制/跨主机 composite transfer 任务；跨主机默认采用本机流式桥接，必要时回退临时目录中转。
- 支持 Windows 系统文件剪贴板中的本地文件/目录在 SFTP 面板内 `Ctrl+V` 上传。
- 支持选中远端文件或目录后显式“下载为 ZIP”，经本地临时目录完成下载和压缩归档。
- 支持选择本地文件或目录后先在 Kerminal 本机压缩为 ZIP，再上传到当前远程目录。
- 支持选中远端文件或目录后显式“下载到剪贴板”，先下载到系统 Downloads 目录并在 Windows 写入系统文件剪贴板，供文件管理器中粘贴。
- 明确不同主机之间 SFTP 传输、压缩/归档的协议边界和实现路线，避免把 SFTP 协议本身不具备的能力伪装成原生命令。

## 非目标

- 本轮不实现 FTP FXP 类直连服务器间传输；SFTP 默认不提供任意两台 SSH 主机间的服务器端复制能力。
- 本轮不把 OS 文件剪贴板格式作为跨平台承诺；Windows 先支持 CF_HDROP 文件剪贴板读取和写入，macOS/Linux 暂返回空列表或明确不支持。
- 本轮不新增破坏性“上传后删除本地文件”或“下载后删除远端文件”的 move 语义。
- 本轮不把远端 shell 压缩作为默认隐式行为；首个 archive job 只采用 Kerminal 本机编排。

## 外部参考结论

- MobaXterm 在 SSH 会话旁自动提供图形 SFTP 浏览器，并支持从/到远端服务器拖放文件。
- WinSCP 支持从本地面板或 Windows Explorer 拖放上传，也支持通过 `Ctrl+V` 从系统剪贴板上传文件。
- FileZilla 的文件传输围绕本地/远端双面板、拖放和 transfer queue 组织，并允许通过限制连接数适配服务器并发约束。
- WinSCP 对不同会话复制的口径是：跨会话只能通过本地临时副本；直接远端到远端不是 SFTP 协议内建能力。

## 影响范围

| 影响域 | 是否涉及 | 入口/文件 | 验证方式 |
| --- | --- | --- | --- |
| 前端页面 | 是 | `src/features/sftp/SftpToolContent.tsx` | `npm run test:frontend -- src/features/sftp/SftpToolContent.test.tsx` |
| 前端 API | 是 | `src/lib/sftpApi.ts` | `npm run test:frontend -- src/lib/sftpApi.test.ts` |
| Tauri Command | 是 | `src-tauri/src/commands/sftp.rs` | `npm run test:rust -- sftp` |
| Rust 模型/服务 | 是 | `src-tauri/src/models/sftp.rs`、`src-tauri/src/services/sftp_service.rs` | `cargo test` targeted |
| Rust 依赖 | 是 | `src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` | `cargo test sftp` |
| Tauri 配置 | 是 | `src-tauri/tauri.conf.json` | 前端测试与桌面拖放人工 smoke |
| 文档/决策 | 是 | `.updeng/docs/decisions/ADR-0007-sftp-advanced-file-operations.md` | 文档检查 |

## 执行步骤

- [x] 对齐已有 native SFTP 后端 ADR 和计划。
- [x] 记录高级文件操作 ADR。
- [x] 新增本地路径分类 command/API，让拖放路径可以区分文件和目录。
- [x] 启用 Tauri webview 文件拖放事件，并在 SFTP 面板接收 drop 后加入上传队列。
- [x] 新增远程条目选择、内部 SFTP 剪贴板和 `Ctrl+C` / `Ctrl+V` 基础交互。
- [x] 新增远程条目多选，支持 `Ctrl`/`Meta` 增减选择、`Shift` 范围选择、批量复制和批量下载。
- [x] 新增界面内拖拽下载：远端条目作为拖拽源，拖到 SFTP 面板下载投放态后复用普通/批量下载队列。
- [x] 新增远程复制/跨主机 composite transfer，优先经本机流式桥接 source SFTP 和 target SFTP，必要时回退本机临时目录中转。
- [x] 新增“下载为 ZIP”archive job，经本机临时目录下载远端条目并生成本地 zip。
- [x] 新增 Windows 系统文件剪贴板读取 command/API，内部 SFTP 剪贴板为空时 `Ctrl+V` 可上传本地文件/目录。
- [x] 新增“上传为 ZIP”archive job，经本机临时目录压缩本地文件或目录后上传远端 zip。
- [x] 新增“下载到剪贴板”任务，经系统 Downloads 目录落地远端文件/目录，并在 Windows 写入系统文件剪贴板。
- [x] 补充前后端测试。
- [x] 运行窄验证和全量前后端验证，并记录剩余风险。

## 验收标准

- 从系统文件管理器拖入一个文件到 SFTP 面板当前目录时，前端能识别本地路径并加入现有上传队列。
- 从系统文件管理器拖入目录时，前端能识别为目录并加入递归上传队列。
- 从 SFTP 远端列表拖动一个或多个可传输条目到面板下载投放态时，前端会复用普通/批量下载路径加入现有下载队列。
- 远程文件行可以被选中；选中后 `Ctrl+C` 会写入 Kerminal 内部 SFTP 剪贴板。
- 远程条目支持 `Ctrl`/`Meta` 多选和 `Shift` 范围选择；多选后 `Ctrl+C` 会复制所有可传输条目，工具栏“下载选中项目”会一次选择本地目录并逐项加入下载队列。
- 在同一 SFTP 面板内 `Ctrl+V` 会创建远程复制任务；切换到另一台 SSH 主机后粘贴会创建跨主机传输任务。
- 当内部 SFTP 剪贴板为空且 Windows 系统剪贴板包含本地文件/目录时，`Ctrl+V` 会把这些本地项目加入当前远程目录的上传队列。
- 选中远端文件或目录后，工具栏或右键菜单“下载为 ZIP”会创建可取消的下载归档任务。
- 选择本地文件或目录后，工具栏或右键菜单“上传为 ZIP”会创建可取消的归档上传任务，远端目标默认为 `<本地名称>.zip`。
- 选中远端文件或目录后，工具栏或右键菜单“下载到剪贴板”会创建下载任务；Windows 上任务成功后系统文件剪贴板指向下载到 Downloads 的本地项目。
- 跨主机传输和压缩能力有清晰用户口径，不误导为 SFTP 原生能力。

## 风险

- `dragDropEnabled` 变更影响 Tauri 原生拖放事件行为；需要确认不会破坏现有窗口交互。
- 浏览器 DOM drag/drop 无法可靠获得本地绝对路径，必须依赖 Tauri 原生 drag/drop 事件。
- OS 文件剪贴板跨平台格式差异大；当前仅 Windows CF_HDROP 首切片可用，macOS/Linux 需要后续实现平台读取。
- 跨主机复制优先经本机流式桥接，仍受本机到两台主机的网络路径影响；低并发配置或同主机目录复制到自身子树会回退临时中转并占用临时磁盘。
- “下载为 ZIP”会先把远端内容下载到本机临时目录再压缩，压缩阶段无法得到远端精确进度，取消会在文件块边界生效。
- “上传为 ZIP”会先在本机临时目录生成 zip，再上传 zip 文件；压缩阶段不占用 SFTP 连接槽位，但会占用本机 CPU 和临时磁盘。
- “下载到剪贴板”会把远端内容先落地到系统 Downloads 目录；如果同名文件或目录已存在，会自动追加 ` (2)`、` (3)` 等后缀避免覆盖。
- 非 Windows 平台当前不支持写入系统文件剪贴板；该入口会返回明确错误，不伪装成完整跨平台能力。

## 当前实现记录

- 已新增 `sftp_classify_local_paths` command/API，拖放本地路径时先由 Rust `std::fs::metadata` 分类为文件或目录。
- 已将主窗口 `dragDropEnabled` 改为 `true`，SFTP 面板通过 `getCurrentWebview().onDragDropEvent` 接收 Tauri 原生文件拖放事件。
- Drop 只在 SFTP 远程目录 drop zone 内生效；命中后复用现有 `enqueueSftpTransfer` 上传队列。
- 远端列表行支持 HTML 拖拽；拖拽单条未选中可传输项目时只下载该项，拖拽已选中项目时下载当前多选集合。释放到 SFTP 面板内的下载投放态后复用 `downloadEntriesToLocalTarget`，因此单文件走保存文件对话框，目录或多选走本地目录选择并逐项入队。
- 已支持远程条目选中、工具栏复制/粘贴、右键“复制项目”、以及 `Ctrl+C` / `Ctrl+V` 内部 SFTP 剪贴板基础交互。
- 已支持远程条目多选：`Ctrl`/`Meta` 点击增减选择，`Shift` 点击按当前可见列表选择范围；右键已选中项目时保留多选集合，`Ctrl+C` 和右键“复制项目”会把多项写入内部 SFTP 剪贴板。
- 工具栏“下载选中项目”在单选时沿用原下载行为；多选时只弹出一次本地目录选择，并为每个可传输远端条目创建下载队列任务。
- 当前 `Ctrl+V` 对同主机远程复制和跨主机传输会调用 `sftp_enqueue_remote_copy`。后台优先同时持有源/目标 SFTP 连接槽并在本机内存流式桥接；当全局并发小于跨主机流式复制所需连接槽，或同主机目录复制目标位于源目录子树内时，回退到本机临时目录中转并在完成后清理临时目录。
- 内部 SFTP 剪贴板为空时，`Ctrl+V` 会调用 `sftp_read_local_file_clipboard`。Windows 通过 `clipboard-win` 读取 CF_HDROP 文件列表后复用本地路径分类和上传队列；非 Windows 平台当前返回空列表并提示没有本地文件。
- 已新增 `sftp_enqueue_archive_download` command/API；选中远端文件或目录后可“下载为 ZIP”，后台先下载到 `paths.temp/sftp-archive-download/<transfer-id>/`，再用本机 zip 归档写入用户选择的目标路径。
- 已新增 `sftp_enqueue_archive_upload` command/API；选择本地文件或目录后先写入 `paths.temp/sftp-archive-upload/<transfer-id>/` 下的 zip，再把该 zip 上传到远端目标路径，完成后清理临时目录。
- zip 归档不会依赖远端 shell；zip 内部路径会清理绝对路径、反斜杠和 `..` 段。
- 已新增 `sftp_enqueue_clipboard_download` command/API；选中远端文件或目录后可“下载到剪贴板”，后端选择系统 Downloads 下的唯一目标路径，下载成功后 Windows 通过 `clipboard-win` 写入 CF_HDROP 文件剪贴板。
- `Ctrl+C` 仍保留为 Kerminal 内部 SFTP 剪贴板，用于同主机远程复制和跨主机传输；下载到本地文件剪贴板是显式按钮/右键动作。
- Windows 上 `Agent` 认证现在优先连接 OpenSSH agent named pipe `\\.\pipe\openssh-ssh-agent`，失败后再回退 Pageant。若系统 `ssh-agent` 未启动且没有 Pageant，SFTP 原生后端无法复用终端里的交互密码登录状态，需要在主机配置中保存密码或私钥凭据。

## 验证记录

- 2026-06-18：`npm run typecheck` 通过。
- 2026-06-18：`npm run test:frontend -- src/features/sftp/SftpToolContent.test.tsx src/lib/sftpApi.test.ts` 通过，2 个测试文件 / 44 个测试。
- 2026-06-18：`cargo test --test sftp_service` 通过，6 个测试。
- 2026-06-18：`cargo test classify_local_paths` 通过，覆盖 3 个新增本地路径分类测试。
- 2026-06-18：`cargo test classify_clipboard_local_paths_accepts_files_and_directories` 通过，覆盖系统剪贴板路径分类 helper。
- 2026-06-18：`cargo test --test tauri_security_config` 通过，确认主窗口启用文件拖放事件且安全基线同步。
- 2026-06-18：`cargo fmt --check` 通过。
- 2026-06-18：`cargo test archive_download_task_writes_zip_from_remote_directory` 通过，覆盖归档下载后台任务和临时目录清理。
- 2026-06-18：`cargo test archive_upload_task_zips_local_directory_before_uploading` 通过，覆盖本地目录压缩、zip 内容上传和临时目录清理。
- 2026-06-18：`cargo test zip_local_path_to_file_includes_directory_contents` 通过，覆盖目录 zip 内容。
- 2026-06-18：`cargo test sftp` 通过，覆盖 SFTP 服务、AI SFTP tool、设置与安全配置相关测试。
- 2026-06-18：`rustfmt --edition 2021 --check src/services/sftp_service.rs src/models/sftp.rs src/commands/sftp.rs src/lib.rs` 通过，覆盖本次 Rust 改动文件格式。
- 2026-06-18：`npm run typecheck` 通过。
- 2026-06-18：`npm run test:frontend -- src/lib/sftpApi.test.ts src/features/sftp/SftpToolContent.test.tsx` 通过，2 个测试文件 / 47 个测试。
- 2026-06-18：`npm run test:frontend -- src/features/sftp/SftpToolContent.test.tsx src/lib/sftpApi.test.ts` 通过，2 个测试文件 / 51 个测试，覆盖 `Ctrl` 多选复制粘贴、`Shift` 范围选择、批量下载和界面内拖拽下载。
- 2026-06-18：此前 `cargo test clipboard_download` 被无关 MCP registry 旧签名阻塞的问题已解除；本轮 `npm run test:rust` 全量通过。
- 2026-06-18：`cargo test --lib remote_copy_task_uses_source_and_target_hosts` 通过，覆盖远程复制队列任务和源/目标主机连接槽占用。
- 2026-06-18：`cargo test --lib transfer_queue_uses_configured_global_and_host_limits` 通过，确认普通传输队列限流仍可用。
- 2026-06-18：`cargo test --lib remote_copy_staging_policy_uses_safe_fallback_only_when_needed` 通过，覆盖跨主机流式复制与安全回退判定。
- 2026-06-18：`cargo test --lib native_sftp_backend_streams_remote_copy_between_hosts` 通过，使用真实 loopback SSH/SFTP 服务验证跨主机文件流式复制。
- 2026-06-18：`cargo test --lib` 通过，43 个 lib 测试全绿。
- 2026-06-18：此前 `npm run typecheck` 被 settings/tool registry 测试数据缺少 `origin`/transport 字段阻塞的问题已解除；本轮 `npm run typecheck` 通过。
- 2026-06-19：`cargo test --test ai_agent_service chat_context_includes_custom_mcp_tools_and_skills_from_settings -- --nocapture` 通过，确认自定义 MCP 工具与 skills 仍进入 AI chat 上下文。
- 2026-06-19：`npm run test:rust` 通过，覆盖 lib、AI Agent、AI tool invocation、SFTP service、settings、Tauri security config 等 Rust 全量测试。
- 2026-06-19：`npm run typecheck` 通过。
- 2026-06-19：`npm run test:frontend` 通过，46 个测试文件 / 353 个测试。
- 2026-06-19：修复 Windows SFTP `Agent` 认证只尝试 Pageant 的问题；`cargo test --lib sftp` 通过，`npm run test:rust` 通过，`rustfmt --edition 2021 --check src/services/sftp_service.rs` 通过。全仓 `cargo fmt --check` 仍被当前工作树中既有 MCP/AI 文件格式差异阻塞，非本次 SFTP 文件。

## 后续切片

- Archive job 扩展：后续新增可选远端 shell 压缩后下载、归档格式选项和更清晰的压缩阶段状态。
- OS 文件剪贴板：Windows CF_HDROP 读取/写入已落地；后续补 macOS/Linux 文件剪贴板读取和写入，并考虑暴露平台不支持的明确提示。
- 原生拖出到桌面：已确认当前 Tauri 2 Webview API 只稳定提供本地文件拖入事件，没有公开的跨平台文件 drag-out 源 API；后续若要实现真原生拖出，需要平台插件分别接入 Windows OLE `DoDragDrop`/CF_HDROP、macOS file promise、Linux DnD/portal/GDK。当前已提供界面内拖拽下载、普通下载和 Windows“下载到剪贴板”作为可靠替代。

## 参考链接

- MobaXterm features: https://mobaxterm.mobatek.net/features.html
- WinSCP uploading files: https://winscp.net/eng/docs/task_upload
- FileZilla using guide: https://wiki.filezilla-project.org/Using
- WinSCP remote-to-remote FAQ: https://winscp.net/eng/docs/faq_fxp
- WinSCP duplicate dialog: https://winscp.net/eng/docs/ui_duplicate


