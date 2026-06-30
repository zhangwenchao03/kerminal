<!-- @author kongweiguang -->

# Kerminal 代码规范、设计模式与性能治理调研

生成时间：2026-06-20T17:36:55+08:00

## 调研目标

- 对照成熟开源项目、官方规范和常见设计模式，评估 Kerminal 当前代码的主要规范风险。
- 判断 23 种 GoF 设计模式中哪些适合本仓库，哪些不应为了“套模式”而引入。
- 找出性能优化的候选方向，并区分“需要先量测”和“可以直接治理”的事项。
- 输出可执行的实施计划，避免一次性大规模重写。

## 参考资料

- [Rust API Guidelines](https://rust-lang.github.io/api-guidelines/about.html)：用于 Rust API 可读性、错误边界、命名和 crate 审查口径。
- [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html)：用于 TypeScript 源文件、类型、命名和一致性参考；本项目仍以现有 TypeScript strict 约束为主。
- [React memo](https://react.dev/reference/react/memo)、[useMemo](https://react.dev/reference/react/useMemo)、[useCallback](https://react.dev/reference/react/useCallback)、[Reducer + Context](https://react.dev/learn/scaling-up-with-reducer-and-context)：用于前端状态拆分、渲染纯度和性能优化边界。
- [Tauri 2 Calling Rust](https://v2.tauri.app/develop/calling-rust/) 与 [Tauri State Management](https://v2.tauri.app/develop/state-management/)：用于 async command、State、共享可变状态和 UI 卡顿风险判断。
- [Rust Design Patterns](https://rust-unofficial.github.io/patterns/) 与 [Refactoring.Guru Design Patterns Catalog](https://refactoring.guru/design-patterns/catalog)：用于模式语言参考，但 Rust 实现必须遵循 Rust idiom，不照搬 Java/OOP 写法。
- [VS Code source organization](https://github.com/microsoft/vscode/wiki/source-code-organization)：参考大型桌面应用按 platform/service 分层、接口和服务注册治理。
- [WezTerm](https://github.com/wezterm/wezterm)：参考 Rust 终端类项目对性能、终端运行时和多平台能力的长期治理方向。

## 仓库当前事实

- 栈：Tauri 2 + Rust、React 19 + TypeScript strict + Vite、SQLite、xterm.js。
- 当前源码规模统计：
  - Frontend source files：164
  - Frontend test files：71
  - Rust source files：162
  - Rust test files：63
- 行数状态：当前没有超过 1000 行的 `.ts/.tsx/.rs` 手写源码，但大量文件处于 800-999 行预警区，例如：
  - `src-tauri/src/services/tool_registry_service/catalog.rs`：984 行
  - `src/app/KerminalShell.tsx`：962 行
  - `src/features/tool-panel/ServerInfoToolContent.tsx`：960 行
  - `src/features/terminal/XtermPane.runtime.ts`：955 行
  - `src/features/workspace/workspaceStore.ts`：948 行
  - `src-tauri/src/services/sftp_service.rs`：908 行
- 测试和验证入口较完整：`npm run test:frontend`、`npm run test:rust`、`npm run build`、`npm run check`、终端 ghost 和 SSH/SFTP smoke。
- 前端有 TypeScript strict，但未发现 ESLint、Prettier 或 Biome 统一静态规范入口。
- Rust 侧有 `cargo fmt --check`、`cargo clippy --all-targets --all-features -- -D warnings`，但 `Cargo.toml` 尚未配置 release profile、编译时间或体积分析任务。
- `src-tauri/src/lib.rs` 集中注册大量 Tauri command，新增命令时容易扩大人工维护面。
- `AppState` 已形成集中服务容器，类似 Service Locator；好处是 Tauri command 注入简单，风险是服务依赖关系和初始化顺序都藏在一个结构里。
- 前端 `workspaceStore.ts` 是全局工作区状态核心，当前承担 machine、tab、pane、session restore、focus、broadcast 等多个子域。
- `SftpService` 已有 `SftpBackend` adapter 和传输队列，但 facade 仍覆盖浏览、读写、传输、归档、剪贴板、host key 和本地路径分类。
- `tool_registry_service/catalog.rs` 使用数据驱动注册工具，是好方向；但 schema、前端 preview、MCP manifest 和实际执行协议仍有分散风险。

## 现有优点

- 已经有“稳定 facade + 私有模块”的雏形，例如 `ai_tool_invocation_service/`、`command_suggestion_service/`、`sftp_service/` 子模块。
- SFTP 已抽出 backend adapter，适合后续做 fake、loopback、native backend 和传输策略测试。
- 前端已经大量抽出 model/testSupport，说明近期治理方向正确。
- 终端相关已有专门 runtime、输出写入、输入模型、建议调度、ghost frame budget 等测试和验证脚本。
- 主题、启动验证、freezePrototype 等项目规则已经写入 `AGENTS.md`，这是比“口头规范”更可靠的约束。

## 主要问题

1. **规范门禁不完整**
   - TypeScript strict 能抓类型问题，但不能统一 import 顺序、hooks 规则、可访问性、无效 JSX、未使用依赖、格式和复杂度。
   - Rust 有 fmt/clippy，但没有体积、编译时间和 release profile 的持续观察。

2. **入口和注册面过宽**
   - `src-tauri/src/lib.rs` 的 command 注册列表已经很长，缺少按 capability 分组的 registrar。
   - 工具协议存在后端 registry、前端 preview、执行器和 MCP manifest 多处表达，后续容易漂移。

3. **部分 facade 过浅或过宽**
   - `SftpService`、`workspaceStore`、`TerminalWorkspace`、`KerminalShell` 都在做较多编排。
   - 它们目前没有严重失控，但已经接近“新增功能继续堆入口”的临界点。

4. **设计模式使用需要收敛到真实变化点**
   - 当前代码中已经自然出现 Adapter、Facade、Command、Observer/Event、Strategy 的局部形态。
   - 不建议为了覆盖 23 种模式而引入 AbstractFactory、Prototype、Visitor 等没有真实变化点的抽象。

5. **性能优化缺少统一基线**
   - 发现候选包括前端 re-render、终端事件吞吐、SFTP 进度事件、SQLite 单连接 Mutex、bundle chunk 和 Rust release profile。
   - 但当前没有统一性能基线文件，不能直接判断优化收益。

## 23 种 GoF 模式适配判断

| 模式 | Kerminal 适配度 | 建议用法 |
| --- | --- | --- |
| Singleton | 低 | 不新增全局单例；现有 `AppState` 已承担运行时容器职责，避免继续扩大。 |
| Factory Method | 高 | 用于终端 session、SFTP transfer task、tool definition、API preview fixture 创建。 |
| Abstract Factory | 低 | 只有出现一组可替换产品族时再用，例如多种 AI provider runtime。 |
| Builder | 中高 | 用于复杂 request/command plan，例如 server info plan、terminal create request、tool schema。 |
| Prototype | 低 | 不建议引入；Rust clone 不能等同设计模式，只有模板化 profile/snippet 时再评估。 |
| Adapter | 高 | 已适合 SFTP backend、terminal provider、MCP client/server、Tauri/browser API。 |
| Bridge | 中 | 适合把 UI 工作台抽象与后端传输实现解耦，但不要与 Adapter 重复。 |
| Composite | 中 | 适合 workspace tab/pane layout、machine tree、SFTP directory tree。 |
| Decorator | 中 | 适合在不改业务服务时叠加 audit、redaction、rate limit、telemetry。 |
| Facade | 高 | 继续保留 `SftpService`、`AiToolInvocationService`、API wrapper 作为稳定入口，内部深化。 |
| Flyweight | 低中 | 只在终端 glyph/command suggestion 大量重复对象造成内存压力后再评估。 |
| Proxy | 中 | 适合 Tauri invoke wrapper、remote command gateway、MCP gateway 的权限/审计代理。 |
| Chain of Responsibility | 中高 | 适合 AI 工具风险策略、命令建议 provider pipeline、传输冲突处理策略。 |
| Command | 高 | 已适合 tool invocation、workflow step、terminal write、Tauri command request。 |
| Interpreter | 低 | 除非 workflow/snippet 形成稳定 DSL，否则不要引入。 |
| Iterator | 中 | Rust/TS 已天然支持；可用于 provider candidate 流和 directory traversal，不需要模式化命名。 |
| Mediator | 中 | 适合 SFTP 双面板工作台或 workspace shell 协调，但要防止变成新上帝对象。 |
| Memento | 中 | 适合 workspace session snapshot、settings migration、undo/restore，不作为首轮重点。 |
| Observer | 高 | 已适合 Tauri event、SFTP transfer update、terminal output、settings/theme change。 |
| State | 高 | 适合 terminal session、SFTP transfer lifecycle、workspace tab/pane lifecycle、AI pending invocation。 |
| Strategy | 高 | 适合 SFTP transport mode、command suggestion providers、AI policy、server info collection target。 |
| Template Method | 中 | 可用于 transfer pipeline 或 diagnostics collection skeleton，但 Rust 中更推荐函数组合/trait。 |
| Visitor | 低 | 除非有复杂 AST/树转换，不建议。 |

结论：第一阶段重点采用 `Facade`、`Adapter`、`Strategy`、`State`、`Observer`、`Command`、`Builder/Factory`、`Chain of Responsibility`。其他模式保持候选，不作为目标。

## 深模块候选

### 1. Command Surface Registrar

- 文件/模块：`src-tauri/src/lib.rs`、`src-tauri/src/commands/*`
- 当前摩擦：command 注册列表长，新增 capability 容易漏注册、难审查。
- 建议深化：每个 capability 提供 `register_*_commands()` 或宏/列表式 registrar，由 `lib.rs` 聚合。
- 模式：Facade、Factory/Registrar。
- 推荐强度：Strong。

### 2. Tool Contract Catalog

- 文件/模块：`src-tauri/src/services/tool_registry_service/catalog.rs`、`src/lib/toolRegistryApi.ts`、AI tool execution modules。
- 当前摩擦：工具定义、browser preview、MCP manifest、执行协议容易漂移。
- 建议深化：后端工具定义作为单一事实源；前端 preview 改成从 fixture/manifest builder 生成或显式同步测试。
- 模式：Builder、Facade、Command、Proxy。
- 推荐强度：Strong。

### 3. SFTP Transfer Engine

- 文件/模块：`src-tauri/src/services/sftp_service.rs`、`src-tauri/src/services/sftp_service/*`、`src/features/sftp/*`
- 当前摩擦：传输、归档、剪贴板、远端复制和事件在同一 facade 附近扩张。
- 建议深化：把 transfer lifecycle、transport strategy、event emitter、conflict policy、retry descriptor 作为内部深模块。
- 模式：Strategy、State、Observer、Template Method。
- 推荐强度：Strong。

### 4. Workspace Session State Machine

- 文件/模块：`src/features/workspace/workspaceStore.ts`、`src/app/KerminalShell.tsx`、`src/features/terminal/*`
- 当前摩擦：machine、tab、pane、focus、session restore、broadcast 交织。
- 建议深化：保留 Zustand facade，内部按 machine/tab/pane/session actions 分 slice，建立状态机纯函数测试。
- 模式：State、Command、Composite、Memento。
- 推荐强度：Strong。

### 5. Terminal Runtime Adapter

- 文件/模块：`XtermPane.tsx`、`XtermPane.runtime.ts`、`terminalOutputWriter.ts`、`terminalSuggestionProbeScheduler.ts`
- 当前摩擦：xterm runtime、Tauri event、输出节流、建议 probe 和 UI 生命周期需要长期稳定。
- 建议深化：把 terminal runtime 作为 adapter，React 组件只负责挂载和属性桥接。
- 模式：Adapter、Observer、Facade。
- 推荐强度：Worth exploring。

### 6. API Transport Facade

- 文件/模块：`src/lib/*Api.ts`
- 当前摩擦：120 处 `invoke` 调用，很多文件同时承担 Tauri transport、browser preview、类型定义和展示 fixture。
- 建议深化：按 capability 保留 public API，内部拆 `tauriTransport`、`browserPreview`、`contract types`。
- 模式：Proxy、Adapter、Facade。
- 推荐强度：Worth exploring。

## 性能优化候选

| 方向 | 当前信号 | 建议 |
| --- | --- | --- |
| React re-render | `KerminalShell.tsx` 订阅大量 workspace store selector；前端 memo/useCallback 相关调用约 132 处 | 先用 React Profiler 定位热点；优先降低状态提升范围和 selector 粒度，再按证据加 memo。 |
| 大列表/树 | SFTP、machine sidebar、tool registry、logs、settings catalog 都可能增长 | 超过 200 行可见数据后评估虚拟列表；先不要全局引入。 |
| xterm 事件吞吐 | 终端已有 ghost frame 和 output writer 测试 | 保持 frame budget；对 terminal output/history、cwd updates 做节流和批处理审计。 |
| SFTP transfer events | 传输事件影响 WebView 更新频率 | 保持 100-250ms 事件节流；队列 UI 用增量更新，避免每帧重建大数组。 |
| SQLite 单连接 Mutex | `SqliteStore` 使用单 `Mutex<Connection>`，55 个文件依赖 | 当前适合简单本地库；若出现 UI 卡顿或并发等待，再评估读写连接拆分或 blocking task。 |
| Tauri sync command | Tauri 官方建议重工作使用 async command | 审计所有可能执行网络、文件、压缩、系统采样的 command，确保不阻塞 UI 主线程。 |
| 前端 bundle | `@monaco-editor/react`、assistant-ui、xterm、streamdown 等依赖较重 | 用 `rollup-plugin-visualizer` 建基线；Monaco 和 AI markdown 相关能力优先 lazy load。 |
| Rust release 体积 | `Cargo.toml` 无 release profile | 引入 release profile 需单独验证 updater/平台兼容；先用 `cargo bloat` 和 `cargo build --timings` 建基线。 |

## 推荐治理顺序

1. 先建立规范和量测基线，不直接开大规模重构。
2. 对 command registry 和 tool contract 做低风险抽取，降低后续新增能力成本。
3. 对 SFTP transfer、workspace store、terminal runtime 做 tracer bullet，每次只迁移一个可验证行为。
4. 对性能候选先做 profiling，再只优化证据最强的链路。
5. 每个切片完成后必须跑对应窄测、`npm run build`，涉及 Tauri/Rust/窗口时补 `npm run tauri:dev`。

## 不建议做的事

- 不把 23 种模式全部塞进代码。
- 不为了减少行数创建没有不变量的 `utils` 或一行转调 service。
- 不一次性替换 `AppState`、`workspaceStore` 或所有 API wrapper。
- 不在当前 UI active 改动未收口时混入大规模前端重构。
- 不在没有量测前声称性能提升。

