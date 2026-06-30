---
id: PLAN-20260619-000003-remote-workspace-editor
status: done
created_at: 2026-06-19T00:00:03+08:00
started_at: 2026-06-19T00:00:03+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# Remote Workspace Editor 实施计划

## 目标

- 把当前 SFTP 文件预览升级为完整远程文本编辑工作区。
- 支持打开远程文件夹，左侧树形展示文件和目录，目录展开时懒加载。
- 支持打开远程文本文件、语法高亮、文件内查找/替换、编辑、dirty 状态、保存写回服务器。
- 支持多 tab、关闭未保存确认、刷新、重命名、新建文件/目录、删除等基础文件管理动作。
- 支持保存冲突检测：远端文件在打开后被其他进程修改时，不静默覆盖。
- 保持现有 SFTP 高级文件管理能力：上传、下载、拖拽、复制、跨主机复制、ZIP 操作继续可用。

## 非目标

- 不做完整 VS Code extension host。
- 不在首轮实现 LSP、智能补全、调试器、Git 面板或终端内嵌编辑器。
- 不承诺二进制文件编辑；二进制文件只显示明确不可编辑状态。
- 不依赖远端 shell watcher；SFTP 无通用文件系统 watch 能力，首轮使用手动刷新和保存时 stat 检查。
- 不把 Theia 作为内嵌框架接入当前 Kerminal shell。

## 当前现状

- 前端入口：`src/features/sftp/SftpToolContent.tsx`。
- 当前预览状态：`preview` / `previewPath` / `previewLoadingPath`，打开文件后弹出 `ModalShell`，内部仅用 `<pre>` 展示文本。
- 当前读取限制：前端调用 `previewSftpFile({ maxBytes: 4096 })`。
- 后端入口：`src-tauri/src/commands/sftp.rs::sftp_preview_file`。
- 后端实现：`src-tauri/src/services/sftp_service.rs::preview_file` 打开远程文件，读取 `max_bytes + 1`，用 `String::from_utf8_lossy` 返回。
- 已有能力：目录列表、mkdir/delete/rename/chmod、上传下载、传输队列、拖拽上传/下载、内部剪贴板、跨主机复制、ZIP 上传下载。
- 缺口：没有完整读文件 API、没有写文件 API、没有文件 revision、没有编辑器模型、没有工作区树、没有 tabs、没有保存冲突处理。

## 调研结论

| 方案 | 结论 |
| --- | --- |
| Monaco Editor | 首选。VS Code 同源，内建成熟编辑能力，支持 model URI、多语言、快捷键、查找替换和 diff。当前 npm `monaco-editor` 最新为 `0.55.1`，MIT。 |
| @monaco-editor/react | 可用。当前 npm 最新 `4.7.0`，支持 React 19 和 multi-model。必须配置为从本地 `monaco-editor` npm 包加载，不能用默认 CDN。 |
| CodeMirror 6 | 备选。搜索、替换、扩展体系成熟且更轻，但 VS Code-like 完整体验需要更多拼装。 |
| Ace | 不推荐作为首选。功能成熟但视觉和集成体验偏旧，难满足“美观、像 VS Code/Zed”的目标。 |
| Eclipse Theia | 不推荐内嵌。它是完整 IDE framework，适合另起 IDE 产品，不适合塞进当前 Kerminal 工具面板。 |
| react-arborist | 首选文件树。当前 npm 最新 `3.10.5`，支持虚拟渲染、重命名、键盘导航、树过滤、受控/非受控数据和自定义样式。 |
| react-complex-tree | 备选文件树。异步 data provider 和可访问性强，但 successor Headless Tree 仍处 beta，首选性低于 react-arborist。 |

## 推荐架构

### 前端结构

新增或拆分以下模块：

| 模块 | 职责 |
| --- | --- |
| `SftpToolContent` | 保留为 SFTP 工具总入口，负责选中 SSH 主机、传输队列、旧文件操作入口和新工作区入口编排。 |
| `RemoteWorkspaceShell` | 三栏/两栏工作区布局：左侧文件树，中间 editor tabs + Monaco，底部状态栏。 |
| `RemoteFileTree` | 基于 `react-arborist` 展示远程目录树，支持展开懒加载、刷新、右键、新建、重命名、删除。 |
| `RemoteEditorTabs` | 管理已打开文件、dirty 标识、关闭确认、切换、保存全部。 |
| `RemoteMonacoEditor` | 封装 `@monaco-editor/react`，处理 theme、language、model URI、快捷键、find/replace、save action。 |
| `remoteWorkspaceStore` | 建议用 Zustand 或局部 reducer 管理 workspace root、tree cache、opened files、active file、dirty map、save status。 |
| `remoteFileLanguage.ts` | 根据扩展名和文件名推断 Monaco language，未知文件回退 plaintext。 |

布局建议：

- 使用现有 `react-resizable-panels` 做左侧 explorer 和右侧 editor 的可拖拽分栏。
- 文件树宽度默认 260px，最小 180px，最大 420px。
- Monaco 区域不放卡片；用完整工作台风格，tabs 顶部、editor 中间、status bar 底部。
- 继续使用 Tailwind + lucide-react；文件图标按类型分组，未知文件用统一图标，不新增重型 icon 依赖。

### Monaco 集成要点

- 安装：`monaco-editor`、`@monaco-editor/react`。
- `loader.config({ monaco })` 使用本地 npm 包；禁止默认 CDN。
- Vite 需要显式处理 Monaco worker。首选在 `src/lib/monacoSetup.ts` 中配置 `MonacoEnvironment.getWorker`，为 editor/json/css/html/ts worker 使用 Vite worker import。
- 每个远程文件使用稳定 URI：`sftp://<hostId><normalizedPath>`。
- 不要只用 `value` prop 反复覆盖内容；打开文件时创建/复用 Monaco model，关闭 tab 时按 dirty 状态决定是否 dispose。
- 内建快捷键：
  - `Ctrl+S` / `Cmd+S`：保存当前文件。
  - `Ctrl+Shift+S` / `Cmd+Shift+S`：保存全部。
  - `Ctrl+F` / `Cmd+F`：Monaco 默认查找。
  - `Ctrl+H` / `Cmd+Alt+F`：替换入口，按 Monaco 默认行为和平台习惯绑定。
  - `Ctrl+P` / `Cmd+P`：后续文件快速打开。
- editor options 初始建议：line numbers、folding、bracket pair colorization、multi cursor、word wrap toggle、minimap 默认关闭、font 跟随终端字体设置或单独设置。

### 后端契约

新增 Rust / TS 模型：

```rust
pub struct SftpReadTextFileRequest {
    pub host_id: String,
    pub path: String,
    pub max_bytes: Option<usize>,
}

pub struct SftpFileRevision {
    pub size: u64,
    pub modified: Option<String>,
    pub permissions: Option<String>,
    pub content_sha256: Option<String>,
}

pub struct SftpReadTextFileResponse {
    pub host_id: String,
    pub path: String,
    pub content: String,
    pub encoding: String,
    pub line_ending: String,
    pub revision: SftpFileRevision,
    pub readonly: bool,
    pub binary: bool,
    pub truncated: bool,
}

pub struct SftpWriteTextFileRequest {
    pub host_id: String,
    pub path: String,
    pub content: String,
    pub encoding: String,
    pub expected_revision: Option<SftpFileRevision>,
    pub create: bool,
    pub overwrite_on_conflict: bool,
}
```

新增 Tauri commands：

- `sftp_read_text_file`
- `sftp_write_text_file`
- `sftp_stat_path`
- `sftp_list_workspace_children`，可复用现有 `sftp_list_directory`，但建议返回 tree 需要的 `hasChildren`、`isLoaded`、`readonly` 等字段。
- 后续：`sftp_search_workspace`、`sftp_replace_in_files`。

保存策略：

1. 打开文件时记录 revision：size、mtime、permissions、可选 sha256。
2. 保存前 stat 远端文件。
3. 如果 size/mtime/hash 与 expected revision 不一致，返回 conflict，不覆盖。
4. 用户选择覆盖时，带 `overwrite_on_conflict: true` 再保存。
5. 正常保存使用同目录临时文件：写入 `.kerminal-save-<uuid>.tmp`，写完后 rename 到目标路径；失败时尝试删除临时文件。
6. 保存后返回新 revision，前端更新 dirty baseline。
7. 尽量保留原文件权限；如果无法保留，明确返回 warning。

编码和大文件策略：

- 首轮支持 UTF-8 / UTF-8 lossy；检测到 NUL 或明显二进制时拒绝编辑。
- 默认单文件编辑上限建议 2 MiB，可在设置里扩到 10 MiB；超过上限显示“作为传输下载/外部处理”，不强行塞入 Monaco。
- 行尾识别 LF / CRLF，保存时默认保持原行尾；新文件用 LF。

### Workspace search / replace

分两级交付：

1. 文件内查找/替换：直接使用 Monaco，首轮必须完成。
2. 文件夹内搜索/替换：后续切片实现。Rust 端递归 SFTP 列目录，按 include/exclude、最大文件大小、二进制检测过滤，流式读取文本并做 regex 搜索；替换必须先展示 preview，用户确认选中项后才批量写回，并沿用 revision 冲突保护。

## 垂直切片

| 顺序 | 标题 | 类型 | 依赖 | 验收 |
| --- | --- | --- | --- | --- |
| 1 | 依赖和 Monaco 本地打包 spike | AFK | None | `npm run build` 通过；Tauri/Vite 中 Monaco worker 不从 CDN 加载；空编辑器能渲染。 |
| 2 | 后端文本读写契约 | AFK | 1 | loopback SFTP 测试覆盖读取、写入、revision、二进制拒绝和大文件上限。 |
| 3 | 远程文件夹树 | AFK | 2 | 打开 SSH 主机目录后左侧显示 root tree；展开目录懒加载；刷新、空态、错误态可见。 |
| 4 | Monaco 多 tab 文件编辑 | AFK | 2,3 | 点击文件打开 tab；语法高亮；文件内查找替换可用；修改后出现 dirty 标识。 |
| 5 | 保存同步和冲突处理 | AFK | 4 | `Ctrl+S` 写回远端；保存后重新读取内容一致；远端外部修改时提示 conflict，不静默覆盖。 |
| 6 | 文件树文件操作闭环 | AFK | 3,5 | 新建文件/目录、重命名、删除后 tree 和 tab 状态同步；删除已打开文件时提示并关闭/标记丢失。 |
| 7 | 视觉和工作台体验完善 | HITL | 4,5,6 | 用户确认整体观感达到 VS Code/Zed 基础工作区水准；无弹窗式低质预览残留。 |
| 8 | Workspace search / replace | HITL | 5 | 文件夹内搜索可取消、可过滤；批量替换必须有 preview 和 conflict 保护。 |

## 详细执行步骤

### Slice 1: 依赖和本地打包

- 新增依赖：`monaco-editor`、`@monaco-editor/react`、`react-arborist`。
- 新建 `src/lib/monacoSetup.ts`，配置本地 Monaco 和 worker。
- 新建 `RemoteMonacoEditor` 最小封装，仅渲染 readonly demo model。
- 跑 `npm run typecheck`、`npm run build`。
- 桌面环境 smoke：确认没有 CDN 请求、没有 worker 加载失败。

### Slice 2: 后端读写

- 扩展 `src-tauri/src/models/sftp.rs`。
- 扩展 `SftpBackend` trait：`read_text_file`、`write_text_file`、`stat_path`。
- 原生 backend 实现读取全量文本、二进制检测、sha256 或轻量 revision。
- 写回实现 temp file + rename，冲突时返回结构化错误。
- 新增 commands 并注册到 `src-tauri/src/lib.rs`。
- 扩展 `src/lib/sftpApi.ts` 和测试。

### Slice 3: 文件夹树

- 从 `SftpToolContent` 中抽出文件管理逻辑，避免 3000 行组件继续膨胀。
- `RemoteFileTree` 使用 `react-arborist` 受控数据。
- 展开目录时调用 `listSftpDirectory` 或新 `sftp_list_workspace_children`。
- tree cache 按 `hostId:path` 存储，支持 refresh node / refresh root。
- 右键菜单先接入已有 mkdir/rename/delete，上传下载入口保留。

### Slice 4: 编辑器 tabs

- `RemoteEditorTabs` 管理打开文件列表和 active file。
- 打开文件调用 `readSftpTextFile`，创建 Monaco model。
- path -> language 映射覆盖常见：shell、ts/tsx/js/json/yaml/toml/rust/python/go/java/css/html/md/env。
- Monaco `onDidChangeModelContent` 更新 dirty。
- 关闭 dirty tab 时使用项目现有 modal 风格确认保存/放弃/取消。

### Slice 5: 保存和冲突

- 注册 Monaco save action，拦截 `Ctrl+S` / `Cmd+S`。
- 保存时传 expected revision。
- 成功后更新 model baseline 和 tab revision。
- conflict 时展示三选项：重新加载、覆盖远端、打开 diff。
- diff 使用 Monaco `DiffEditor`，original 为打开时 baseline，modified 为当前内容；如用户选择重新加载，另存当前草稿到内存直到用户确认丢弃。

### Slice 6: 文件操作同步

- 新建文件：先在 tree 里 inline 输入名称，提交后后端 create 空文件并打开。
- 重命名文件：如果该文件已打开，更新 URI/model/tab path；失败则回滚 tree 名称。
- 删除文件：如果已打开且 dirty，阻止删除或要求确认；删除成功关闭 tab。
- 目录删除/重命名：影响其下打开文件时，标记为 missing 或批量更新路径。

### Slice 7: 视觉完善

- 目标视觉：左侧 explorer 安静紧凑，右侧 editor 最大化利用空间；避免卡片套卡片。
- 顶部 tabs 显示文件名、dirty dot、关闭按钮、路径 tooltip。
- 底部 status bar 显示 host、path、encoding、line ending、cursor、language、save status。
- loading/error/empty 使用轻量 inline 状态，不用大面积说明文案。
- 深色/浅色跟随现有主题，并定义 Monaco theme 与 Tailwind 色板一致。

### Slice 8: Workspace search / replace

- 搜索面板支持 query、case sensitive、whole word、regex、include/exclude、max file size。
- Rust 搜索任务支持取消和进度。
- 搜索结果按文件分组，点击跳到 Monaco 对应 range。
- Replace in files 必须先展示 preview diff；默认不自动全量替换。
- 批量替换逐文件使用 revision 检查，冲突文件跳过并汇总。

## 验收标准

- 用户连接 SSH 主机后，能打开一个远程目录作为 workspace。
- 左侧树能展开目录，显示文件/文件夹，并支持刷新。
- 点击文本文件会在右侧打开 Monaco editor，而不是弹出 `<pre>` 预览。
- 文件内 `Ctrl+F` 查找、替换入口、语法高亮、编辑、undo/redo、多光标可用。
- `Ctrl+S` 保存后，远程服务器文件内容真实变化。
- 打开后远端文件被外部修改时，保存会提示冲突，不静默覆盖。
- 关闭 dirty 文件、删除已打开文件、重命名已打开文件都有明确状态处理。
- 二进制文件、大文件、权限失败、连接失败都有明确错误态。
- `npm run typecheck`、`npm run test:frontend`、`npm run test:rust`、`npm run build` 通过。

## 风险与应对

| 风险 | 应对 |
| --- | --- |
| Monaco worker 在 Tauri/Vite 中加载失败 | Slice 1 单独验证；必须本地 npm 包加载，不走 CDN。 |
| Bundle 变大 | 按需 worker、关闭不必要语言 worker；构建后检查 chunk，必要时 lazy load editor。 |
| 远端保存覆盖用户外部修改 | revision 检查 + conflict UI；默认拒绝覆盖。 |
| SFTP rename 覆盖语义因服务器差异失败 | 保存失败时保留临时文件清理逻辑，必要时 fallback 为 remove + rename，但必须在 conflict 检查之后。 |
| 大文件卡死 UI | 编辑大小上限、二进制检测、Monaco lazy mount、树虚拟渲染。 |
| `SftpToolContent` 继续膨胀 | 必须先抽模块，再加编辑器；不在原 3000 行组件里继续堆状态。 |
| Workspace search 远程递归太慢 | 后续独立切片，支持取消、限制大小、忽略目录、结果流式返回。 |

## 建议开工顺序

1. 先做 Slice 1，验证 Monaco 在 Tauri/Vite 离线包内稳定工作。
2. Slice 2 和 Slice 3 可并行：一个人做 Rust 读写契约，一个人做 tree shell 和数据模型。
3. Slice 4/5 必须串行，先能打开编辑，再做保存和冲突。
4. Slice 7 必须安排人工验收，因为用户明确要求“美观”和“不要低质预览”。
5. Slice 8 作为完整版增强，但不要阻塞文件级编辑保存上线；它的批量替换风险更高，应单独评审。

## 参考链接

- Monaco Editor: https://github.com/microsoft/monaco-editor
- @monaco-editor/react: https://github.com/suren-atoyan/monaco-react
- CodeMirror search: https://codemirror.net/docs/ref/#search
- react-arborist: https://github.com/jameskerr/react-arborist
- react-complex-tree: https://github.com/lukasbach/react-complex-tree
- Eclipse Theia: https://github.com/eclipse-theia/theia
- Ace: https://github.com/ajaxorg/ace

## 2026-06-19 实现记录

### 已完成

- 安装并接入 `monaco-editor`、`@monaco-editor/react`、`react-arborist`。
- 新增远程文本编辑后端契约：
  - `sftp_read_text_file`
  - `sftp_write_text_file`
  - `sftp_stat_path`
- 后端读文件返回 revision、encoding、line ending、binary/truncated/readonly 状态。
- 后端写文件使用同目录临时文件写入，再 rename 到目标路径；默认检查 expected revision，冲突时拒绝静默覆盖；支持显式 overwrite。
- 前端 `src/lib/sftpApi.ts` 补齐 read/write/stat TS 类型、Tauri invoke 和浏览器 fallback。
- 新增 `src/features/sftp/RemoteWorkspaceEditor.tsx`：
  - 左侧 `react-arborist` 远程目录树，按目录懒加载。
  - 文件 tab、dirty dot、关闭 tab。
  - Monaco 编辑器，支持语法高亮、文件内查找和替换入口、`Ctrl/Cmd+S` 保存。
  - 保存、重新加载、冲突后覆盖保存。
  - dirty tab 关闭确认，支持取消、放弃修改、保存后关闭。
  - 状态栏显示 language、line ending、encoding、readonly、错误状态。
- `SftpToolContent` 移除旧 `<pre>` 文件预览 modal，双击文件和右键“打开编辑器”改为打开远程编辑器。
- 入口行为修正：远程工作区不固定嵌入 SFTP 面板；双击 SFTP 目录时在弹框中打开该目录工作区，双击文件时在弹框中打开父目录工作区并自动打开该文件。目录单击仍保持进入目录浏览，但会短延迟以让双击优先触发弹框。
- 远程工作区弹框通过 `ModalShell` portal 挂载到应用 `document.body`，在当前应用顶层展示，不受右侧 SFTP 工具栏容器限制；弹框调整为应用内中等大工作区尺寸，主题底色、边框和阴影贴近主应用。
- 工作区弹框关闭时若存在未保存修改会明确确认；确认后允许关闭，不再静默拦截右上角关闭按钮。
- 工作区弹框头部新增独立窗口按钮：Tauri 环境下创建可拖出主应用范围的 `sftp-workspace-*` 原生窗口，浏览器环境下退化为 `window.open`；独立窗口复用同一远程目录树、Monaco 编辑器和保存能力。
- 保留现有 SFTP 上传、下载、传输队列、拖拽、复制、ZIP、chmod、rename、delete、mkdir 能力。

### 已覆盖测试

- `src/lib/sftpApi.test.ts`：
  - 新 read/write/stat Tauri command payload。
  - 浏览器 fallback 的读、写、stat 和 stale revision 冲突。
- `src/features/sftp/RemoteWorkspaceEditor.test.tsx`：
  - 远程树展开、打开文件、编辑保存。
  - 保存冲突后显示覆盖保存，并以 `overwriteOnConflict: true` 再写回。
  - dirty tab 关闭确认和保存后关闭。
- `src/features/sftp/SftpToolContent.test.tsx`：
  - 文件双击在弹框中进入远程工作区编辑器。
  - 目录双击在弹框中打开该目录远程工作区。
  - 工作区弹框尺寸不再铺满整个应用、右上角关闭按钮可关闭弹框、独立窗口按钮会生成工作区 URL。
- `src-tauri/src/services/sftp_service.rs` loopback 测试：
  - 真实 SFTP 读取文本文件。
  - stale revision 保存被拒绝。
  - 覆盖保存成功写回远端。
  - `stat_path` 返回保存后的 revision。

### 验证结果

- `npm test -- --run`：通过，51 个测试文件、373 个用例；测试环境会打印 Monaco CSS 解析警告，但用例通过。
- `npm run build`：通过；Monaco 本地 worker 已打入 dist，保留大 chunk 警告。
- `cargo test sftp_service`：通过，22 个相关用例。
- `cargo test` / `cargo check`：当前被无关的 `src/services/docker_host_service.rs` 编译错误阻塞；错误集中在 Docker 主机服务缺少 `resolve_host` 等函数，不属于本次 SFTP 编辑器改动。

### 后续增强

- 文件夹内全局搜索 / 批量替换还未实现；当前完成的是 Monaco 文件内查找/替换。
- 关闭 dirty tab 的确认弹窗、保存全部、DiffEditor 三方冲突视图可以继续作为下一切片补齐。
- 文件树中的新建文件、重命名/删除后同步打开 tab 的深度处理还可继续细化；现有旧文件管理操作仍可使用。


