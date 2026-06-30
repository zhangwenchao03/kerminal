# ADR-0009: Remote Workspace Editor

## 状态

Proposed

## 背景

- 当前 SFTP 文件预览是 `SftpToolContent` 中的弹窗和 `<pre>` 展示，后端 `sftp_preview_file` 只读取有限字节并返回 `utf-8-lossy` 文本。
- 用户目标是最终版远程文件编辑体验：美观、支持高亮查看、查找、替换、修改、保存同步到服务器，并能打开远程文件夹，在左侧以树形结构浏览文件和目录，体验接近 VS Code / Zed 的基础编辑工作区。
- 项目已经采用 React 19、Vite、Tailwind、Tauri 2，并已有原生 SFTP 后端、目录列表、传输队列和高级文件管理操作；新方案应该复用这些能力，而不是另起一套文件协议。

## 决策驱动因素

- 成熟编辑体验：语法高亮、查找/替换、多光标、折叠、快捷键、主题和大文件基础性能不能从零实现。
- Tauri 兼容：资源必须能本地打包，不依赖 CDN；Web Worker、CSP 和离线环境要可控。
- 远程安全保存：保存必须经过 SFTP 写回服务器，并处理远端文件被外部修改后的冲突。
- 工作区体验：文件夹树需要懒加载、键盘导航、重命名、刷新、上下文菜单和美观样式。
- 可维护性：不能把整个 IDE 框架强塞进当前产品，避免打破 Kerminal 现有工具面板、SSH 主机和 SFTP 服务边界。

## 备选方案

| 方案 | 优点 | 缺点 | 风险 | 验证方式 |
| --- | --- | --- | --- | --- |
| Eclipse Theia 整套 IDE framework | 完整 IDE、支持多语言和 VS Code extension protocol | 需要接管应用 shell、依赖重、许可证和架构复杂度高；和当前 Tauri/React 工具面板边界冲突 | 产品会被 IDE 框架牵引，SFTP/SSH 主机模型难以自然复用 | 不采用为内嵌方案；仅作为未来独立 IDE 模式参考 |
| Monaco Editor + Kerminal 自有远程工作区层 | VS Code 同源编辑器，编辑能力成熟；可用 Monaco model 映射远程文件 URI；能复用现有 SFTP 后端 | 需要自己实现文件树、tabs、保存冲突、workspace search 等工作区层能力 | Web Worker / Vite / Tauri 打包配置需要验证；包体积增加 | 采用 |
| CodeMirror 6 + 自有工作区层 | 模块化、较轻、搜索扩展成熟、主题可控 | VS Code-like 体验需要自己拼装更多扩展；语言生态和用户心理预期不如 Monaco | 完整度不足，容易变成“漂亮但像普通文本框” | 作为轻量 fallback |
| Ace Editor + 自有工作区层 | 历史成熟、功能多、搜索替换和多语言高亮可用 | 视觉和 API 更旧，React/Tauri 现代集成体验不如 Monaco / CodeMirror | 最终观感难达到用户要求的 VS Code / Zed 级别 | 不作为首选 |
| react-arborist 文件树 | 面向 VS Code sidebar / Finder / Explorer 类 tree，支持虚拟渲染、重命名、键盘导航、过滤和自定义样式 | 远程懒加载需要由项目侧控制数据模型 | 受控数据和远程刷新逻辑需测试 | 采用为首选树组件 |
| react-complex-tree 文件树 | 可访问性强、支持多选、拖拽、重命名、异步 data provider、零依赖 | 官方已提示 successor Headless Tree beta；视觉层仍需较多自定义 | 长期演进方向可能迁到 headless-tree | 作为备选树组件 |

## 决策

采用 Monaco Editor + `@monaco-editor/react` + `react-arborist`，在 Kerminal 内实现远程工作区编辑器。

原因：

- Monaco 是 VS Code 的完整浏览器编辑器，模型 URI 可以自然映射 `sftp://<hostId>/<path>`，适合多 tab、多文件编辑、语言识别和查找替换。
- `@monaco-editor/react` 已支持 React 19、多 model，并提供 loader 配置；但默认 CDN 行为必须改为本地 `monaco-editor` npm 包方式，以满足 Tauri 离线打包。
- `react-arborist` 明确定位为构建 VS Code sidebar、Mac Finder、Windows Explorer 类树形 UI，具备虚拟渲染、键盘导航、重命名和自定义样式，适合远程文件夹树。
- 当前 Kerminal 已有原生 SFTP 后端，应该扩展 read/write/stat/search 命令，而不是引入 Theia 或其他 IDE 框架接管文件系统。

## 影响

- 正向影响：文件预览从弹窗 `<pre>` 升级为可编辑、多 tab、带文件树的远程工作区；用户保存可直接同步到服务器。
- 负向影响：前端 bundle 体积增加；Monaco worker 配置会增加构建复杂度；远程保存需要更严格的数据安全和冲突处理。
- 需要同步修改：Rust SFTP 模型/服务/command，前端 SFTP API，SFTP UI 组件拆分，新增 editor store，新增依赖和测试。
- 不应移除现有 SFTP 传输队列、拖拽上传下载、复制/粘贴和压缩能力；新编辑器应复用并增强当前 SFTP 面板。

## 回滚或替代

- 如果 Monaco worker 在 Tauri/Vite 打包下不可接受，优先切换到 CodeMirror 6，不回退到 `<pre>`。
- 如果 `react-arborist` 的远程懒加载/受控数据模型成本高于预期，在文件树层切换到 `react-complex-tree`，编辑器和后端契约不变。
- 如果保存冲突策略未通过测试，先禁用写回能力，仅保留 Monaco 只读查看和本地复制，不发布可编辑入口。

## 验证

- 依赖引入后运行 `npm run typecheck`、`npm run test:frontend`、`npm run build`，确认 Monaco 本地打包和 worker 可用。
- Rust 端新增 loopback SFTP 测试，覆盖 read text、write text、stat revision、冲突拒绝、临时文件写入和 rename 提交。
- 前端测试覆盖打开文件夹、展开目录、打开文件、dirty tab、`Ctrl+S` 保存、冲突提示、二进制/大文件拒绝。
- 桌面 smoke：连接一台真实 SSH 主机，打开目录、编辑小文本文件、保存后在远端 `cat` 或重新打开确认内容一致。

## 外部依据

- Monaco Editor GitHub: https://github.com/microsoft/monaco-editor
- @monaco-editor/react GitHub: https://github.com/suren-atoyan/monaco-react
- CodeMirror search docs: https://codemirror.net/docs/ref/#search
- react-arborist GitHub: https://github.com/jameskerr/react-arborist
- react-complex-tree GitHub: https://github.com/lukasbach/react-complex-tree
- Eclipse Theia GitHub: https://github.com/eclipse-theia/theia
- Ace GitHub: https://github.com/ajaxorg/ace

