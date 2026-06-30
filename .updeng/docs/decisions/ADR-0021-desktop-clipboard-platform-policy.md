# ADR-0021: 桌面剪贴板跨平台边界与 SFTP 系统文件剪贴板策略

## 状态

Proposed

## 修订关系

- Builds on: [ADR-0006: 原生 SFTP 后端](ADR-0006-native-sftp-backend.md)
- Builds on: [ADR-0007: SFTP 高级文件操作](ADR-0007-sftp-advanced-file-operations.md)
- Related: [Tauri 桌面插件生产级接入方案](../plan/active/PLAN-20260625-235439-tauri-desktop-plugin-hardening.md)

## 背景

- 用户要求 Kerminal 的桌面原生能力不能只考虑 Windows，剪贴板这类能力要同时面向 Windows 和 macOS 设计、实现和验收。
- 本轮已接入官方 `tauri-plugin-clipboard-manager`，并将终端文本粘贴、命令块文本复制、settings 导出、snippets、port forward、Compose YAML 路径、SFTP 本地/远端路径文本复制、Xterm selection-copy 和 tmux quickref 迁移到项目 `desktopClipboardApi` facade。
- 官方 `clipboard-manager` 能覆盖文本剪贴板这一层跨平台需求；它不能直接表达 Explorer/Finder 的系统文件列表剪贴板语义。
- SFTP 工作台存在两类不同的“剪贴板”：
  - 文本剪贴板：路径、命令、片段、终端文本等字符串。
  - 文件传输剪贴板：Kerminal 内部 SFTP 复制/粘贴的 transfer intent，以及可选的系统文件列表剪贴板。
- 当前 Windows 可通过 `clipboard-win::formats::FileList` 与系统文件列表剪贴板集成；macOS 若要对接 Finder pasteboard，需要单独 AppKit/NSPasteboard adapter、真实 macOS 验证和更细的失败语义，不应在本轮用未验证 native binding 赶工。

## 决策驱动因素

- 跨平台一致性：文本剪贴板是高频基础能力，必须在 Windows 和 macOS 上同等可用。
- 产品诚实性：不能把 Windows-only `FileList` 成功误写为 macOS 原生 Finder pasteboard 支持。
- 安全与权限：不为文件列表剪贴板引入 `fs:`、`shell:`、`http:` 或宽泛前端权限。
- 可维护性：业务组件只调用项目 facade/adapter，不散落 `navigator.clipboard`、`clipboard-win` 或 AppKit binding。
- 验证完整性：没有真实 macOS 运行证据前，不能宣称 Finder 系统文件 pasteboard 已完成。

## 决策

采用分层剪贴板策略。

### 1. 文本剪贴板是跨平台保证

- 所有生产文本剪贴板读写统一走 `src/lib/desktopClipboardApi.ts`。
- Tauri 桌面环境使用官方 `@tauri-apps/plugin-clipboard-manager` 的 text API。
- 浏览器预览环境允许 facade 内部使用 `navigator.clipboard` fallback；业务组件不直接调用浏览器 clipboard 文本 API。
- 默认 capability 只开放：
  - `clipboard-manager:allow-read-text`
  - `clipboard-manager:allow-write-text`
- 不开放 `clipboard-manager:default`、image/html/clear、`fs:`、`shell:` 或 `http:`。

### 2. SFTP 内部文件传输剪贴板是跨平台保证

- Kerminal SFTP 内部复制/粘贴模型继续作为 Windows 和 macOS 都支持的文件传输剪贴板。
- 本机文件进入 SFTP 的跨平台用户路径是：
  - Kerminal SFTP 内部复制/粘贴；
  - 本机文件拖放到 SFTP 工作台；
  - 文件选择/上传等现有显式操作。
- 这些路径不依赖 Explorer/Finder 系统文件列表剪贴板。

### 3. 系统文件列表剪贴板首期只承诺 Windows native

- Windows：继续支持系统文件列表剪贴板，使用 `clipboard-win::formats::FileList`。
- macOS：本轮不承诺 Finder `NSPasteboard` 文件列表互操作；用户可见降级为 Kerminal 内部 SFTP clipboard 和本机拖放。
- Linux/other：同 macOS，明确降级，不假装空剪贴板成功。
- 非 Windows 调用系统文件列表剪贴板时返回显式错误：
  - 当前平台暂不支持读取/写入系统文件剪贴板；
  - 提示使用 Kerminal SFTP 内部复制/粘贴或拖放本机文件。

## 平台矩阵

| 能力 | Windows | macOS | Linux/other | 验收口径 |
| --- | --- | --- | --- | --- |
| 文本读写 | 官方 clipboard-manager | 官方 clipboard-manager | 官方 clipboard-manager 或浏览器 preview fallback | 两平台真实桌面 smoke：终端粘贴、文本复制、SFTP 路径复制 |
| SFTP 内部复制/粘贴 | 支持 | 支持 | 支持 | 前端 model/hook 测试 + 真实 SFTP 工作台 smoke |
| 本机文件拖放到 SFTP | 支持 | 支持 | 按 Tauri/WebView 文件拖放能力支持 | 真实 SFTP 工作台 smoke |
| 系统文件列表剪贴板 | Windows native `FileList` | 明确不支持 Finder pasteboard，本轮降级 | 明确不支持，本轮降级 | Windows 原生 smoke；非 Windows 错误文案/规则测试 |
| Finder pasteboard 文件列表互操作 | 不适用 | 未来候选 | 不适用 | 单独计划、AppKit adapter、真实 macOS 验证后再承诺 |

## 不采用的方案

| 方案 | 不采用原因 |
| --- | --- |
| 把系统文件列表剪贴板包装成“跨平台已支持” | 会误导 macOS 用户；当前没有 Finder pasteboard 实现和真实验证。 |
| 直接在本轮加入 AppKit/NSPasteboard binding | 当前环境不能真实 macOS 验证，且需要额外依赖、权限、路径编码和 Finder 互操作测试；不适合塞进插件硬化 lane。 |
| 为文件列表能力开放 `fs:` 或宽泛前端权限 | 与 Kerminal 当前安全边界冲突；SFTP 文件传输应继续由 Rust service 受控执行。 |
| 回退到业务组件直接用 `navigator.clipboard` | 会重新引入浏览器权限弹框和平台差异，破坏 facade 设计。 |

## 影响

- 正向影响：
  - 文本剪贴板满足 Windows/macOS 同等设计目标。
  - SFTP 系统文件列表剪贴板的边界清晰，不再作为未决语义阻塞当前插件方案。
  - 非 Windows 用户得到明确可操作降级，而不是无声失败或假空剪贴板。
  - 后续如果实现 Finder pasteboard，可以独立评审依赖、权限和验收矩阵。
- 负向影响：
  - macOS 用户不能直接从 Finder copy 文件后在 Kerminal SFTP 里通过系统剪贴板粘贴；需要用 Kerminal 内部复制/粘贴、拖放或上传入口。
  - Windows/macOS 在“系统文件列表剪贴板”这一小能力上不是同构实现，需要在产品文档和验收中明确。

## 后续候选

未来只有在满足以下条件时，才把 macOS Finder pasteboard 文件列表纳入完成口径：

- 单独计划或 ADR 评估 AppKit/NSPasteboard adapter。
- 不开放额外高风险前端权限；Rust service 层隔离 native binding。
- 覆盖读取 Finder copied files、写入可被 Finder paste 的 file URLs、空剪贴板、非文件内容、权限失败和路径编码。
- 真实 macOS `npm run tauri:dev` 或打包应用 smoke 通过。
- 与 Windows `FileList` 行为差异写入平台矩阵。

## 验证

- 已有/保留自动化：
  - `cargo test --target-dir target-codex-tauri-plugins --test sftp_service` 覆盖 Windows native support 标识和非 Windows 显式降级错误。
  - `cargo test --target-dir target-codex-tauri-plugins --test tauri_security_config` 锁定 clipboard text permissions，不允许 broad clipboard/fs/shell/http 权限。
  - `npm run test:frontend -- src/lib/desktopClipboardApi.test.ts` 覆盖 text clipboard facade 成功、失败和浏览器 fallback。
- 仍需真实运行：
  - Windows `npm run tauri:dev`：系统文件列表剪贴板、文本剪贴板、双实例、window-state、通知、日志落盘 smoke。
  - macOS `npm run tauri:dev`：文本剪贴板、SFTP 内部 clipboard/拖放降级、双实例、window-state、通知、日志落盘 smoke。
