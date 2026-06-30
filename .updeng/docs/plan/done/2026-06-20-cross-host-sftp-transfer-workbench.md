---
id: PLAN-20260620-080909-cross-host-sftp-transfer-workbench
status: done
created_at: 2026-06-20T08:09:09+08:00
started_at: 2026-06-21T23:36:00+08:00
completed_at: 2026-06-22T16:02:00+08:00
updated_at: 2026-06-22T16:02:00+08:00
owner: ai
---

# SFTP 传输工作台生产级完整实现计划

## 计划定位

这份计划替代上一版“跨主机 SFTP 传输工作台实施计划”。上一版重点证明 Kerminal 已具备跨主机 SFTP 桥接基础；本版把范围升级为生产级文件传输工作台：先修复当前左侧本地目录只能预览、不能拖动、不能右键、不能传输的问题，再把本机/远端、左右主机 tab、上下文菜单、拖拽、队列、冲突处理和生产保护做成完整闭环。

本计划当前同时作为生产级实施方案和执行台账。完整生产版仍按下方 15 个切片推进；本轮已先收口不依赖 Rust/Tauri 后端改动的第一批前端可用性切片。

## 背景与当前问题

用户现场反馈的关键问题：

- 传输台左边打开了本地目录，但目前更像只读预览，不能拖动、不能右键、不能直接传输。
- 传输工作台不能在界面内添加别的主机，无法形成真正的左右双主机工作流。
- 传输界面的右键菜单和右侧栏/左侧主机资产栏的右键菜单语义混淆，需要整理清楚。
- 参考截图里本地 tab、远端 tab、文件表格、右键菜单和工具栏都很密集，但不能照搬别人的视觉皮肤；Kerminal 需要结合自己的终端上下文和主机资产模型做产品化设计。

当前代码里已经出现和本计划相关的基础入口：

- `src/features/sftp/SftpTransferWorkbench.tsx`：传输工作台容器。
- `src/features/sftp/LocalTransferPane.tsx`：本地目录面板，目前需要从预览型面板升级为可操作文件面板。
- `src/features/sftp/sftpTransferWorkbenchModel.ts`：主机 tab、路径裁剪和 fallback 相关模型。
- `src/features/sftp/SftpToolContent.tsx`：现有远端 SFTP 工具主入口。
- `src/features/sftp/sftp-tool-content/SftpContextMenu.tsx`：远端文件右键菜单入口。
- `src/features/machine-sidebar/MachineSidebar.tsx` 和 `MachineSidebar.parts.tsx`：左侧主机资产树和资产右键菜单入口。
- `src-tauri/src/services/sftp_service.rs`、`src-tauri/src/services/sftp_service/transfer.rs`：上传、下载、远端复制和传输任务后端基础。

## 参考截图学习结论

截图 1：本机 tab 的文件面板菜单

- 顶部是 `本机` 和远端主机 tab。
- 表格是高密度文件列表，列包含文件名、类型、大小、修改时间等。
- 右键菜单第一项是 `传输(T)`，说明文件面板的最高频动作是把选中项送到另一侧，而不是资产管理。
- 本机侧菜单包含 `编辑`、复制、粘贴、复制路径、在系统文件管理器中打开、重命名、删除、刷新、新建。

截图 2：远端 tab 的文件面板菜单

- 远端菜单和本机菜单骨架接近，但动作不是完全相同。
- 远端侧增加 `更改权限...`、`rm -rf`、`压缩` 这类 SSH/SFTP 语义动作。
- 危险动作和普通删除需要分层，不能把 `rm -rf` 做成轻点即执行。

截图 3：双文件面板整体布局

- 左右都是可选 tab 的文件面板，一侧是本机，另一侧是远端。
- 每侧都有路径栏、图标工具栏、选择框和表格。
- 布局密度高，适合工程师反复传文件，不适合卡片化或营销式大空白。

需要学习的是交互语义：

- 文件传输工具的主要对象是“当前面板里的文件/目录”，不是“主机资产本身”。
- 左右面板都应是可操作目标，不应出现一侧只能预览的假面板。
- 本机和远端菜单应共享信息架构，但按能力裁剪。
- 工具栏适合图标加 tooltip，不适合在窄文件工具里堆大文字按钮。

不照搬的部分：

- 不复制对方窗口皮肤、颜色、圆角、图标顺序。
- 不把 Kerminal 做成通用文件管理器克隆。
- 不取消 Kerminal 的终端上下文、主机资产、生产主机提示和 AI/工具面板集成。

## 竞品和资料调研结论

- WinSCP 的 Commander 风格把本地和远端文件面板作为核心对象，用户可以通过拖拽、菜单和工具栏完成上传/下载；同时 WinSCP 也明确说明 SFTP 场景下通用的远端到远端直连并不是协议天然能力，需要谨慎表述跨主机传输模型。参考：[WinSCP Commander Interface](https://winscp.net/eng/docs/ui_commander)、[WinSCP transfer queue](https://winscp.net/eng/docs/ui_queue)、[WinSCP FAQ: remote to remote transfer](https://winscp.net/eng/docs/faq_fxp)。
- FileZilla 把本地站点、远程站点、传输队列作为稳定三段式体验，队列是可见的生产能力而不是临时 toast。参考：[FileZilla Client tutorial](https://wiki.filezilla-project.org/FileZilla_Client_Tutorial)。
- Xftp 支持多 tab 和 tab group，把远端窗口之间的传输做成一等交互。参考：[Xftp 8 manual](https://cdn.netsarang.net/docs/Xftp8_manual.pdf)、[Xftp features](https://www.netsarang.com/en/xftp-all-features/)。
- Termius 的 SFTP 设计强调多个连接并排、每个连接保持自己的上下文，并用 Transfers tab 展示传输任务。参考：[Termius: Rethinking SFTP for Mobile](https://termius.com/blog/rethinking-sftp-for-mobile)。
- SecureFX 的 FTP 选项里存在禁用 direct server-to-server transfer 的配置，说明成熟产品会给直连/中转能力留 fallback 和可解释性。参考：[SecureCRT/SecureFX file transfer options](https://documentation.help/SecureCRT/GO_File_Transfer_FTP.htm)。

对 Kerminal 的产品判断：

- 默认跨主机传输应称为“Kerminal 本机桥接”，不要暗示两台远端服务器彼此直连。
- SFTP 传输工作台的生产化重点不是再堆一个按钮，而是把双面板、菜单、拖拽、队列、冲突和安全确认做成一致模型。
- Kerminal 应保留“终端上下文 + 主机资产 + SFTP 工作台”的定位，不能变成脱离终端的普通文件管理器。

## 目标

- 本地面板从只读预览升级为可操作文件面板，支持选择、多选、右键、拖拽、上传、下载目标选择、复制路径、系统打开、刷新、新建、重命名和删除。
- 远端面板保持现有 SFTP 文件管理能力，并把右键菜单、工具栏和拖拽动作纳入统一文件面板模型。
- 传输工作台支持左右两侧 pane，每侧都能打开本机或已保存 SSH 主机 tab，并支持新增 SSH 主机入口。
- 默认保持左侧本机、右侧当前远端的易懂布局，但允许用户把任一侧切换为本机或多个 SSH 主机 tab。
- 支持本机到远端、远端到本机、远端到远端、同主机不同目录、本机到本机的基础复制闭环。
- 支持右键传输、工具栏方向按钮、复制/粘贴和拖拽传输。
- 底部队列展示源、目标、进度、速度、剩余时间、传输方式、失败原因、取消、重试和清理。
- 目标冲突默认不静默覆盖，提供覆盖、自动重命名、跳过和应用到全部。
- 生产主机、危险远端操作和覆盖操作有明确二次确认。
- 所有新增 UI 同时验证浅色、深色和跟随系统主题。

## 非目标

- 不在首版实现 FTP/FTPS/FXP。
- 不默认让源服务器通过 shell、scp 或 rsync 直接连接目标服务器。
- 不默认把 Kerminal 本地私钥、密码或 agent 转发到远端主机。
- 不在首版做双向同步、目录比较、云同步、团队共享队列。
- 不在首版做断点续传和暂停后从断点恢复；可以保留取消、失败重试和重新入队。
- 不把左侧主机资产树的右键菜单改造成文件菜单。
- 不把 SFTP 工作台做成系统文件管理器替代品；本机文件能力服务于传输工作流。

## 用户体验原则

1. 文件面板是操作主体。

   在传输工作台里，用户右键的是文件、目录、空白区域或 pane tab；动作应该围绕文件传输和文件操作展开。

2. 主机资产菜单和文件菜单分域。

   左侧主机资产树右键菜单用于连接、编辑主机、复制主机、分组、删除资产、打开终端、打开文件；传输面板右键菜单用于传输、打开、复制、粘贴、重命名、删除、权限、压缩等文件操作。

3. 同骨架，不同能力。

   本机和远端文件菜单共享大致分组和排序，但按目标能力启用或隐藏动作。本机有系统文件管理器打开；远端有 chmod、rm -rf、压缩、远端编辑。

4. 传输动作优先。

   文件面板选中项的第一优先动作是传输到另一侧。菜单、工具栏和拖拽都应围绕“从当前面板到另一侧”建立默认方向。

5. 高密度但不拥挤。

   使用表格、稳定列宽、图标按钮、tooltip 和状态栏；避免卡片、营销式 hero、过大留白和文本按钮堆叠。

6. 每个 tab 保持上下文。

   同一侧多个主机 tab 的路径、选择、隐藏文件开关、错误状态和加载状态互相隔离。

7. 错误和危险要可解释。

   失败任务必须能看出源、目标、原因和下一步；覆盖、删除、rm -rf、生产主机操作必须有明确确认。

## 生产级产品形态

### 入口

- 右侧工具栏保留 `文件` 入口，默认打开当前资产文件视图。
- 当前资产视图里提供 `打开传输工作台`，进入双面板模式。
- 左侧主机资产树右键提供：
  - `打开文件`
  - `添加到传输工作台左侧`
  - `添加到传输工作台右侧`
- SSH 终端 tab 或 pane 的上下文可后续提供 `打开当前目录文件`，初始路径使用终端当前 cwd。
- 如果右侧栏空间不足，双面板工作台允许展开到主工作区或弹出独立窗口；首版可以先在现有工具区域内适配，但必须保证表格列和队列不被挤到不可用。

### 布局

双面板传输工作台包含四个区域：

- 顶部全局栏：工作台标题、当前传输策略、队列折叠开关、展开/弹出按钮。
- 左 pane group：tab 条、路径栏、工具栏、文件表格。
- 右 pane group：tab 条、路径栏、工具栏、文件表格。
- 底部传输队列：表格或紧凑列表，可折叠但不应完全消失。

默认布局：

- 左侧打开 `本机` tab，路径为用户 home 或上次传输工作台路径。
- 右侧打开当前选中的 SSH 主机 tab；如果没有当前 SSH 主机，则显示 `添加目标主机` 空态。

每个 pane tab 的目标类型：

- `local`：本机目录。
- `ssh`：已保存 SSH 主机的 SFTP 目录。
- `container`：后续扩展，不进入首版核心验收。

### 文件表格

每个 pane 使用相同的表格基础：

- 选择列。
- 文件名。
- 类型。
- 大小。
- 修改时间。
- 权限。
- 所有者/组，远端优先显示，本机可按平台能力显示或隐藏。

交互：

- 双击目录进入。
- 双击文件：本机用系统默认打开；远端用现有预览/编辑器或下载到临时只读预览。
- 单击选择，多选支持 Shift/Ctrl。
- 空白区域右键显示当前目录菜单。
- 表头排序可后置；首版至少保证稳定目录优先和名称排序。
- 长路径和长文件名必须省略并提供 tooltip，不允许撑破布局。

### 主机 tab

每侧 pane group 顶部有 tab 条：

- `+` 添加目标。
- tab 展示连接状态、目标名称和关闭按钮。
- 同一个主机可以在同一侧打开多个 tab，用于停留在不同目录。
- 关闭 active tab 后切到相邻 tab。
- 每侧首版最多建议 8 个 tab，超过后进入下拉列表，避免横向失控。

`+` 添加目标菜单：

- `本机`
- 最近使用主机。
- 已保存 SSH 主机搜索列表。
- `新建 SSH 主机...`，复用现有远程主机创建弹框；创建成功后自动作为当前侧新 tab 打开。
- `从当前终端主机添加`，如果当前终端是 SSH 且有 hostId。

## 右键菜单域与动作矩阵

### 菜单域

| 菜单域 | 出现位置 | 操作对象 | 允许动作 | 禁止混入 |
| --- | --- | --- | --- | --- |
| 主机资产菜单 | 左侧 MachineSidebar 主机/分组 | 主机资产、分组资产 | 打开终端、打开文件、编辑主机、复制主机、移动分组、删除资产、添加到传输工作台 | 文件复制、粘贴文件、chmod、rm-rf、压缩 |
| 文件面板菜单 | 传输工作台文件行、目录空白处 | 文件、目录、当前路径 | 传输、打开/编辑、复制、粘贴、复制路径、新建、重命名、删除、刷新、权限、压缩 | 编辑主机、删除主机、移动分组 |
| pane tab 菜单 | 传输工作台左右 tab | 当前文件面板 tab | 关闭 tab、关闭其他、复制当前路径、在另一侧打开同主机、刷新连接 | 删除主机资产、文件删除 |

实现要求：

- 三类菜单可以复用同一套 `MenuSurface`、`MenuItem`、图标和主题样式，但 action model 必须分开。
- 不能为了样式统一把主机资产菜单和文件菜单合成一个判断巨大的菜单。
- 测试必须覆盖：在文件面板右键不出现主机编辑；在主机资产右键不出现 chmod/rm-rf；在 tab 右键不出现文件删除。

### 文件面板菜单骨架

选中文件或目录时：

| 分组 | 本机目标 | 远端目标 | 说明 |
| --- | --- | --- | --- |
| 高频传输 | 传输到另一侧、打开、编辑 | 传输到另一侧、打开/预览、编辑 | `传输` 保持第一项 |
| 剪贴板 | 复制、粘贴、复制路径 | 复制、粘贴、复制路径 | 复制/粘贴使用工作台内部剪贴板，不等同系统剪贴板 |
| 文件操作 | 重命名、删除、刷新 | 重命名、删除、刷新 | 删除要确认；生产远端增强确认 |
| 新建 | 新建文件夹、新建文件 | 新建文件夹、新建文件 | 空白处右键也显示 |
| 本机专属 | 在文件管理器中打开、复制系统路径 | 不显示 | Windows/macOS/Linux 走系统能力 |
| 远端专属 | 不显示 | 更改权限、压缩、rm -rf | `rm -rf` 必须危险分组并强确认 |

空白区域右键：

- 粘贴到此处。
- 上传到此处，本机 pane 不显示上传，远端 pane 显示本机文件选择。
- 新建文件夹。
- 新建文件。
- 刷新。
- 复制当前路径。
- 本机显示 `在文件管理器中打开`。

禁用态要求：

- 动作不可用时优先隐藏；如果隐藏会造成用户困惑，则禁用并提供 tooltip 原因。
- 没有另一侧目标时，`传输到另一侧` 禁用并提示“先在另一侧添加本机或 SSH 主机”。
- 远端未连接或 host key 未信任时，文件操作禁用，只保留连接/信任入口。

## 工具栏与快捷操作

每个 pane 的工具栏采用图标按钮加 tooltip：

- 后退。
- 前进。
- 上级目录。
- Home。
- 刷新。
- 显示/隐藏隐藏文件。
- 新建文件夹。
- 新建文件。
- 上传。
- 下载。
- 传输到另一侧。
- 复制路径。
- 删除。

规则：

- 图标按钮尺寸稳定，不因 tooltip、loading、长文本改变布局。
- 只在需要说明方向时使用短文本，例如 `到右侧`、`到左侧` 可以出现在中间方向按钮上。
- 使用项目现有 icon 体系，优先 lucide 图标。
- 工具栏动作和右键菜单调用同一 action model，不能各写一套判断。
- 快捷键首版覆盖：F5 刷新、Delete 删除、Ctrl+C 内部复制、Ctrl+V 内部粘贴、Enter 打开、Backspace 上级目录。

## 拖拽与复制粘贴

### 拖拽

必须支持：

- 本机 pane 文件/目录拖到远端 pane：上传。
- 远端 pane 文件/目录拖到本机 pane：下载。
- 远端 A 拖到远端 B：远端复制，通过 Kerminal 本机桥接。
- 同主机左目录拖到右目录：同主机远端复制。
- 本机左目录拖到本机右目录：本机复制，走本地文件后端，不要求用户打开系统文件管理器。
- 多选拖拽：拖动选中项中的任意一项时，默认拖动整个选择集。

拖拽反馈：

- drag ghost 显示数量和首个文件名。
- 目标 pane 高亮可投放区域。
- 投放到目录行时，目标为该目录；投放到空白处时，目标为当前目录。
- 不能投放时显示明确原因，例如“另一侧未选择目录”“远端未连接”“目标是源目录子树”。
- 大目录拖拽后先进入扫描/预检，再进入传输。

首版不要求：

- 从远端文件直接拖出到 Windows Explorer。
- 从 Windows Explorer 拖入本机 pane 做本机复制；从系统拖入远端 pane 上传可以作为可选增强。
- Shift 拖拽移动。首版全部默认复制，移动另开危险操作切片。

### 内部复制/粘贴

- Ctrl+C 记录选中项、源目标、源路径、类型和时间。
- Ctrl+V 在当前 pane 目录粘贴。
- 本机到远端、本机到本机、远端到本机、远端到远端都走同一 transfer resolver。
- 剪贴板状态在工作台内可见，例如路径栏旁显示“已复制 3 项”。
- 如果源 tab 关闭，剪贴板仍可用；执行时按 source endpoint 重新解析。

## 传输执行模型

### endpoint 抽象

统一抽象：

```ts
type FileEndpoint =
  | { kind: "local"; path: string }
  | { kind: "remote"; hostId: string; hostLabel: string; path: string };
```

统一请求：

```ts
type TransferIntent = {
  source: FileEndpoint;
  target: FileEndpoint;
  entries: Array<{ name: string; kind: "file" | "directory" | "symlink"; path: string }>;
  conflictPolicy: "ask" | "overwrite" | "rename" | "skip";
  requestedBy: "drag" | "contextMenu" | "toolbar" | "paste";
};
```

resolver 输出：

| 源 | 目标 | 后端动作 |
| --- | --- | --- |
| local | remote | 上传，复用 managed transfer |
| remote | local | 下载，复用 managed transfer |
| remote | remote | remote copy，本机流式桥接或本机中转 |
| local | local | 本机复制，新增 local file copy task |

### 跨主机传输策略

默认：

```text
source host SFTP -> Kerminal memory buffer -> target host SFTP
```

fallback：

```text
source host SFTP -> Kerminal temp directory -> target host SFTP
```

说明：

- UI 显示“传输方式：本机桥接”或“传输方式：本机中转”。
- 不暗示两台远端服务器彼此直连。
- 不把目标凭据复制到源服务器。
- 本机中转目录只能在 Kerminal 受控 temp 路径下创建，失败/取消后必须清理。

后续高级模式：

- 同主机 server-side copy 可以作为 P2 优化，需检测 OpenSSH `copy-data` 或其他能力，不支持时回退。
- 远端命令加速可以作为 P3/HITL 能力，默认关闭，需要单独 ADR、安全确认和凭据边界。

## 队列与可观测性

底部队列表格列：

| 列 | 内容 |
| --- | --- |
| 名称 | 文件/目录名，多项批次显示首项 + 数量 |
| 状态 | 排队、预检、扫描、连接中、传输中、成功、失败、已取消 |
| 进度 | 百分比、进度条、已传/总字节 |
| 大小 | total bytes，未知显示 `-` |
| 源 | `本机:C:\...` 或 `host:/path` |
| 目标 | `本机:C:\...` 或 `host:/path` |
| 方式 | 上传、下载、本机桥接、本机中转、本机复制 |
| 速度 | 前端按事件差值估算，后端可后续下发 |
| 剩余 | 基于速度和剩余字节估算 |
| 操作 | 取消、重试、打开目标、清理 |

队列行为：

- 运行中和排队任务常驻。
- 成功任务短暂保留，并支持手动清理。
- 失败任务保留失败原因和重试入口。
- 用户可以按状态、源主机、目标主机过滤。
- 队列事件必须包含结构化 source/target，不能继续只把跨主机源塞进 `localPath` 字符串。
- 重试必须重新入队生成新 transfer id，并保留 `retryOf` 关系。

## 冲突处理与危险操作

### 传输冲突

传输前预检目标：

- 单项：目标存在时弹冲突对话框。
- 多项：汇总冲突，支持应用到全部。
- 大目录：先扫描并按需预检；目录内大量冲突时进入批量策略。

冲突选项：

- 覆盖。
- 自动重命名。
- 跳过。
- 取消本批次。

默认策略：

- 默认不静默覆盖。
- 自动重命名使用 `.copy`、`.copy-2` 等递增规则。
- 目录冲突首版做合并目录 + 文件冲突逐项策略；不做 destructive replace directory。

### 生产保护

- source 或 target 任一主机标记为生产时，传输前显示生产提示。
- 覆盖生产目标文件需要更强确认。
- 删除、rm-rf、覆盖目录、批量 chmod 必须显示影响范围。
- 不在错误信息、队列详情和日志里泄漏密码、私钥路径内容或 token。

### 远端危险操作

- 普通删除和 `rm -rf` 分开。
- `rm -rf` 只在远端目录或多选场景显示，并放在危险分组。
- `rm -rf` 需要二次确认；生产主机可要求输入目标目录名。
- chmod 支持常用权限选择和高级八进制输入，但必须校验格式。

## 技术实施方案

### 前端模块边界

建议组件和模型：

- `src/features/sftp/SftpTransferWorkbench.tsx`
  - 双面板工作台总容器。
  - 管理左右 pane group、active tab、剪贴板、传输队列显示和空态。
- `src/features/sftp/SftpPaneGroup.tsx`
  - 单侧 tab 条、添加目标、关闭 tab、active pane。
- `src/features/sftp/SftpFilePane.tsx`
  - 本机和远端共用的文件面板视图。
  - 接收 target、listing、selection、action model。
- `src/features/sftp/LocalTransferPane.tsx`
  - 短期可继续存在，但目标是被 `SftpFilePane` 吸收或变成 local target adapter。
- `src/features/sftp/sftpPaneModel.ts`
  - endpoint、tab、selection、path resolver、drag payload。
- `src/features/sftp/sftpFileActionModel.ts`
  - 工具栏和右键菜单共享的 action availability。
- `src/features/sftp/sftpContextMenuDomainModel.ts`
  - 文件面板菜单、pane tab 菜单、资产菜单的分域规则和测试。
- `src/features/sftp/SftpTransferQueuePanel.tsx`
  - 底部队列表格。
- `src/features/sftp/sftpTransferResolver.ts`
  - TransferIntent 到 upload/download/remoteCopy/localCopy 的解析。
- `src/features/sftp/SftpTransferConflictDialog.tsx`
  - 冲突处理。
- `src/features/sftp/SftpHostTabTargetPicker.tsx`
  - 添加本机/SSH 主机/新建 SSH 主机。

拆分原则：

- `SftpToolContent.tsx` 只做入口编排，不能继续把文件列表、菜单、队列、拖拽、对话框都堆进去。
- 本机和远端的 UI 共用表格和菜单结构；数据读取、文件操作通过 adapter 区分。
- 工具栏、右键菜单、快捷键都调用同一 action model。

### 后端和 API

需要补齐或确认的能力：

- 本地目录 listing：已有 `listLocalDirectory` 基础时，扩展到生产级字段和错误码。
- 本地 stat：用于冲突预检。
- 本地新建文件夹/文件。
- 本地重命名。
- 本地删除。
- 本地复制任务：local -> local。
- 本地打开系统文件管理器：可走前端 shell/open 能力或 Tauri command。
- 上传/下载：复用现有 managed transfer。
- remote copy：复用现有 `sftp_enqueue_remote_copy`，但补齐结构化 source/target 和 transport mode。
- retry：新增 `sftp_retry_transfer` 或统一 `transfer_retry`。

推荐结构化 summary：

```rust
#[serde(rename_all = "camelCase")]
pub enum TransferEndpoint {
    Local { path: String },
    Remote { host_id: String, host_label: String, path: String },
}

#[serde(rename_all = "camelCase")]
pub enum TransferOperation {
    Upload,
    Download,
    RemoteCopy,
    LocalCopy,
}

#[serde(rename_all = "camelCase")]
pub enum TransferTransportMode {
    LocalFs,
    SingleHostSftp,
    ClientBridge,
    LocalStage,
}
```

兼容策略：

- 旧 `SftpTransferSummary` 字段先保留，新增字段用 optional。
- 前端队列优先读新字段，缺失时 fallback 到旧字段。
- 浏览器 mock、测试 fake backend 和 Tauri backend 同步更新，避免开发态和桌面态行为分裂。

### 状态持久化

首版持久化：

- 左右 pane group 的 tab 列表。
- active tab。
- 每个 tab 的 target 和 path。
- split ratio。
- show hidden。
- 最近使用目标主机。

首版不持久化：

- 当前 selection。
- 未执行的内部剪贴板。
- 成功任务的完整历史。

恢复规则：

- 主机被删除时，对应 tab 显示“主机不存在”，允许关闭或重新选择。
- host key 变化时，只影响对应 tab。
- 本机路径不存在时回退 home，并显示一次性提示。

## 生产执行总纲

这次改造不能按“左边补几个按钮、右边补几个按钮”的方式推进。生产版要先把工作台拆成稳定的产品和技术层级，再按端到端行为逐步交付：

1. 目标模型层：定义本机、远端、pane tab、selection、drag payload、clipboard payload、transfer intent 和 conflict policy，所有入口只产生 intent，不直接拼后端请求。
2. 文件面板层：本机和远端共享文件表格、选择、空态、错误态、右键菜单、工具栏和快捷键协议；差异能力通过 action availability 裁剪。
3. 目标管理层：左右两侧都是 pane group，每侧可以打开本机或多个 SSH 主机 tab，新增主机后能直接成为当前侧目标。
4. 传输解析层：resolver 把 `source endpoint + target endpoint + entries + requestedBy` 转成上传、下载、远端复制或本机复制。
5. 执行与队列层：所有传输都入队，队列显示源、目标、方式、状态、进度、失败原因和后续操作。
6. 生产保护层：冲突预检、覆盖策略、危险操作确认、生产主机增强确认、失败重试和审计/日志。
7. 恢复与验收层：工作台状态持久化、主题验证、真实启动 smoke、真实 SSH smoke 和边界回归。

本计划按“能独立验收的垂直切片”推进。每个切片都必须至少包含模型/组件/后端契约中必要的一段、对应测试、真实启动或跳过理由、Round Log。不要做只改 UI 但无法执行的假闭环，也不要做只改后端但没有入口的隐形能力。

### 当前基线

截至 2026-06-22T09:00:04+08:00，已经完成或具备最窄验证的基础：

- 本地面板不再只是占位预览，已具备本地 listing、路径输入、目录选择、刷新、上级目录、系统打开、行选择、Ctrl/Meta 多选、右键菜单、复制路径、拖拽 payload 和 `传输到右侧` 上传入队。
- `sftpTransferResolver` 已建立 local/remote endpoint 和 transfer intent 的纯模型，覆盖 local -> remote、remote -> local、remote -> remote、local -> local 的解析基础。
- 工作台已接入本地面板，上传入队后可刷新传输队列，队列开始展示传输方式。
- 右侧远端面板已能把选中的远端文件/目录通过工具栏或右键菜单直接下载到左侧本机当前目录；该路径复用 managed download 队列，不再弹系统目录选择器。
- SFTP 文件面板右键菜单、机器侧栏主机资产菜单、pane/tab 菜单已经建立显式 domain/action 分域，测试覆盖文件菜单不混入主机编辑、主机菜单不混入 chmod/rm-rf。
- 左侧已支持 `本机 + SSH` tab，左右 active pane 能派生 local/remote `SftpTransferTarget`，左侧 SSH tab 关闭后回退本机。
- 工作台内 `新建 SSH 主机...` 已接入 Shell 层 `RemoteHostCreateDialog` 桥接：记录 pending side/workspace tab，创建成功且主机支持 SFTP 后，刷新主机树并把新 host 打开到请求的左侧或右侧。该切片已完成 full gate：Shell/Workbench 最窄集成测试、SFTP 目录回归、typecheck、source-size、build 和真实 dev server HTTP smoke 均通过。
- P6 已完成首个 remote drag payload 切片：远端行拖拽会写入带 source host、host label 和 entries 的内部 MIME payload；远端 pane drop 能解析该 payload，并在目标 pane 为 SSH 时复用 remote copy runner 入队。旧的 remote download path MIME 和 `text/plain` 兼容仍保留。
- P6 已完成 remote -> local 拖拽下载切片：`LocalTransferPane` 可识别远端 payload，把 payload source host 作为下载源、当前本机目录作为下载目标，复用 `buildBatchDownloadTransferPlan` 和 `enqueueSftpTransfer` 入队下载；坏 payload 不入队并显示错误。
- P6 已完成 local -> remote 拖拽上传切片：`LocalTransferPane` 会写入本机 payload，拖拽选中行时携带当前选中集合；远端 SSH pane 可识别该 payload，并上传到当前远端目录。
- P6 已补首个不能投放原因：本机 payload 拖到非 SSH/SFTP 目标时，远端 hook 会设置 `dropEffect=none` 并显示“本机文件只能拖放到 SSH/SFTP 远端目录。”，不再静默忽略或误入队。
- 前序前端窄测、SFTP 目录回归、typecheck、build 和 dev server HTTP smoke 已通过；真实 SSH smoke、Tauri smoke、主题截图、完整内部复制/粘贴、本机到本机 drop/copy、统一不能投放 reason model、本机后端写操作、冲突预检和完整队列生产化仍未完成。

这意味着下一步不应该再重复做本地只读面板、右侧到左侧基础下载、菜单域分离、新建 SSH 主机桥接、remote -> remote 拖拽 payload 基础、remote -> local 拖拽下载或 local -> remote 拖拽上传。后续应继续补齐内部剪贴板、本机到本机复制、冲突预检、队列生产化和最终真实验收。

### 生产实施包

| 包 | 名称 | 目标 | 主要文件/模块 | 完成标准 | 验证 |
| --- | --- | --- | --- | --- | --- |
| P0 | 计划和边界收口 | 把用户反馈、截图学习、竞品抽象和生产验收写入同一个 active plan | 本计划、`in-progress.md`、`plan/INDEX.md` | 文档能直接分派给 agent；明确非目标、风险、验收和顺序 | Markdown review |
| P1 | 文件目标模型 | endpoint、pane tab、selection、drag/paste payload 和 resolver 成为唯一传输入口 | `sftpTransferResolver.ts`、`sftpTransferWorkbenchModel.ts`、新增 pane model | 四类传输都能被模型表达；无效目标能被拒绝 | 模型单测 |
| P2 | 本地面板补全 | 本机侧具备真正文件面板能力，不再只是预览 | `LocalTransferPane.tsx`、`localTransferPaneModel.ts`、本地文件 API | 选择、右键、拖拽、上传、新建、重命名、删除、系统打开可用 | 组件测试、Tauri smoke |
| P3 | 远端到本机 | 右侧远端文件可直接传到左侧本机目录 | `SftpTransferWorkbench.tsx`、`SftpToolContent` transfer target、`useSftpTransferActions` | 工具栏和右键能下载到左侧当前本机路径；拖拽归 P6 统一实现 | hook 测试、工作台测试 |
| P4 | 菜单域分离 | 主机资产菜单、文件面板菜单、pane tab 菜单分域 | `MachineSidebar.parts.tsx`、`SftpContextMenu`、文件菜单 action model | 文件菜单不出现主机编辑；主机菜单不出现 chmod/rm-rf；tab 菜单不出现文件删除 | action model snapshot |
| P5 | 双侧 tab 和新增主机 | 左右任意侧都能添加本机/SSH tab，并可新建 SSH 主机 | pane group 组件、host picker、`RemoteHostCreateDialog` 集成 | 任一侧可添加多个主机；同主机多 tab 路径隔离；新主机可作为目标 | 组件测试、Shell 集成测试 |
| P6 | 拖拽和内部剪贴板 | 所有复制类传输统一走 resolver | drag/drop hooks、clipboard model、transfer action model | local/remote 任意组合可拖拽和 Ctrl+C/Ctrl+V；不能投放时有原因 | hook 测试、浏览器 smoke |
| P7 | 本机写操作和 local copy | 本机新建、重命名、删除、本机到本机复制走 Tauri 后端 | `src-tauri` local file commands、`sftpApi*` 类型/transport | Windows 路径、权限不足、目标存在、取消操作可解释 | Rust 测试、Tauri smoke |
| P8 | 队列生产化 | 队列从“结果反馈”升级为传输任务台 | transfer summary、queue panel、runner hooks | 展示源、目标、方式、速度、ETA、取消、重试、清理 | 前端测试、事件合并测试 |
| P9 | 冲突和生产保护 | 默认不静默覆盖，危险操作必须确认 | conflict dialog、stat preflight、production guard | 覆盖/重命名/跳过/应用到全部可用；生产目标增强确认 | 模型测试、人工 smoke |
| P10 | 持久化和最终验收 | 重启恢复工作台，完成自动化和人工验收 | workspace store、settings/local storage、verification docs | 浅色/深色/跟随系统、真实 SSH、Tauri dev、build 全部通过 | 完整验收清单 |

### 下一轮优先级

P3、P4、P5、P6 和 P7 主体能力已经完成到最窄可验证状态：右侧远端可以传到左侧本机，菜单域已分离，左侧支持 SSH tab，工作台内可以发起新建 SSH 主机并把创建结果回填到请求侧，四类拖拽/内部剪贴板已有 resolver 闭环，本机 copy/create/rename/delete/root scope/delete audit 已经接入 Tauri 后端并通过阶段验证。

下一步必须从“补交互”切到“生产保护和最终验收”：

1. P7 收口：把本机新建/重命名从 `window.prompt` 替换为项目内主题化弹框，并补浅色、深色、跟随系统截图；AI/MCP 本机写开放不直接实现，先做策略 ADR/HITL。
2. P8 队列生产化：新增队列面板模型和组件，展示源、目标、方式、速度/ETA、失败原因、取消、重试、清理；后端补 `retryOf`、速度/ETA 或可计算事件契约。
3. P9 冲突和安全写策略：先做统一 preflight，再把当前 SFTP 写入中的默认 `TRUNCATE` 改成受 `conflictPolicy` 控制；覆盖、自动重命名、跳过、应用到全部必须能被模型和后端表达。
4. P9 生产保护：生产主机、覆盖、删除、chmod、rm-rf、remote copy to prod 需要增强确认和可审计失败；前端确认不能替代后端 guard。
5. P10 持久化和最终验收：工作台 tab/path/状态恢复，transfer history / operation audit 稳定落库，完成真实 SSH、Tauri dev、build、浅色/深色/跟随系统主题截图和最终 review 记录。

原因：

- 用户最初指出的“本地面板不能操作”“不能加别的主机”“右击菜单域混淆”已经有最窄闭环，继续重复这些区域会浪费切片。
- 当前最大真实风险是静默覆盖和不可恢复写操作：后端 SFTP 文件写入仍存在 `TRUNCATE` 路径，生产版不能只靠前端冲突弹框兜底。
- 本机写操作进入 AI/MCP surface 目前被契约测试禁止；开放它属于安全策略变更，必须先确认 scope、审计、确认策略和外部 MCP 风险。
- 多个 SFTP 文件已接近 1000 行硬限制，后续 worker 必须优先新增模型/面板/弹框文件，只对大组件做最小接线。

### Subagent 并行执行矩阵

| Worker | 切片 | 类型 | ownedPaths | sharedPaths | 依赖 | 验证 |
| --- | --- | --- | --- | --- | --- | --- |
| W1 | P7 主题化输入和主题截图 | AFK | `src/features/sftp/LocalNamePromptDialog.tsx`、`src/features/sftp/LocalNamePromptDialog.test.tsx` | `src/features/sftp/LocalTransferPane.tsx`、`src/features/sftp/LocalTransferPane.test.tsx` | 现有 local create/rename API | `npm run test:frontend -- src/features/sftp/LocalNamePromptDialog.test.tsx src/features/sftp/LocalTransferPane.test.tsx`、`npm run typecheck`、`npm run build`、三主题截图 |
| W2 | P8 前端队列面板生产化 | AFK | `src/features/sftp/SftpTransferQueuePanel.tsx`、`src/features/sftp/SftpTransferQueuePanel.test.tsx`、`src/features/sftp/sftpTransferQueuePanelModel.ts` | `src/features/sftp/SftpTransferWorkbench.tsx`、`src/features/sftp/sftpTransferModel.ts`、`src/lib/sftpApiTypes.ts` | P8 后端字段可先用前端估算 fallback | `npm run test:frontend -- src/features/sftp/SftpTransferQueuePanel.test.tsx src/features/sftp/SftpTransferWorkbench.test.tsx src/features/sftp/sftpTransferModel.test.ts`、`npm run typecheck` |
| W3 | P8 后端队列契约 | AFK | `src-tauri/src/models/sftp.rs`、`src-tauri/src/services/sftp_service/transfer_lifecycle.rs`、`src-tauri/src/services/sftp_service/transfer_registry.rs`、`src-tauri/src/services/sftp_service/tests/transfer_queue.rs` | `src-tauri/src/commands/sftp.rs`、`src/lib/sftpApiTypes.ts`、`src/lib/sftpApi.ts` | 现有内存 queue | `cargo test transfer_queue --lib`、`cargo check`、前端 `sftpApi` 类型测试 |
| W4 | P9 冲突预检模型 | AFK | `src/features/sftp/sftpTransferConflictModel.ts`、`src/features/sftp/sftpTransferConflictModel.test.ts`、`src-tauri/src/services/sftp_service/transfer_preflight.rs` | `src/features/sftp/sftpTransferResolver.ts`、`src/lib/sftpApi.ts`、`src/lib/localFilesApi.ts`、`src-tauri/src/commands/sftp.rs` | P8 summary schema 基本稳定 | 前端冲突模型单测、`cargo test transfer_preflight --lib`、`cargo check` |
| W5 | P9 安全写策略 | AFK | `src-tauri/src/services/sftp_service/transfer_io.rs`、`src-tauri/src/services/sftp_service/backend.rs`、`src-tauri/src/services/sftp_service/tests/native_backend.rs` | `src-tauri/src/models/sftp.rs` | W4 preflight / `conflictPolicy` contract | `cargo test native_sftp_backend --lib`、`cargo test transfer_queue --lib`、`cargo check` |
| W6 | P9 冲突/生产保护 UI | AFK | `src/features/sftp/SftpConflictDialog.tsx`、`src/features/sftp/SftpProductionGuardDialog.tsx` 及测试 | `src/features/sftp/LocalTransferPane.tsx`、`src/features/sftp/sftp-tool-content/SftpActionDialog.tsx`、`src/features/sftp/sftp-tool-content/useSftpDialogActions.ts` | W4 冲突模型；`Machine.production` 字段可用 | 对应 dialog/hook 测试、`npm run typecheck` |
| W7 | P10 transfer history / operation audit | AFK | `src-tauri/src/storage/*transfer*`、`src-tauri/tests/storage_foundation.rs` | `src-tauri/src/storage/migrations.rs`、`src-tauri/src/storage/mod.rs`、`src-tauri/src/services/sftp_service/transfer_lifecycle.rs` | P8/P9 字段稳定 | `cargo test --test storage_foundation`、`cargo test transfer_queue --lib`、`cargo check` |
| W8 | P10 工作台持久化和最终验收 | AFK/HITL | `src/features/sftp/sftpTransferWorkbenchPersistence.ts`、测试、`.updeng/docs/review/...` | `src/features/sftp/SftpTransferWorkbench.tsx`、本计划 | P8/P9 完成；真实 SSH 环境需要人工 | `npm run test:frontend -- src/features/sftp`、`npm run typecheck`、`npm run build`、dev server smoke、`npm run tauri:dev`、真实 SSH smoke、三主题截图 |
| W9 | AI/MCP 本机写策略 ADR | HITL | `.updeng/docs/decisions/ADR-*.md` 或 `.updeng/docs/issues/*` | `src-tauri/tests/tool_registry_service/contract.rs`、`src-tauri/src/services/tool_registry_service/**` | 用户确认是否开放本机写给 AI/MCP | 文档评审；确认后再进入实现 |

下一轮建议验证：

- `npm run test:frontend -- src/features/sftp/sftp-tool-content/sftpRemoteTransferModel.test.ts src/features/sftp/sftp-tool-content/useSftpRemoteDownloadDragActions.test.ts src/features/sftp/sftp-tool-content/useSftpTransferActions.test.ts`
- `npm run test:frontend -- src/features/sftp`
- `npm run typecheck`
- `npm run check:source-size`
- `npm run build`
- `npm run dev -- --host 127.0.0.1 --port <free-port> --strictPort` 后 HTTP smoke。

### 分派规则

每个 agent 领一个实施包时必须写清：

- 领取的包编号和目标。
- 要写入的 owned/shared paths。
- 已读取的 lane checkpoint。
- 最窄验证命令。
- 完成后在本计划 Round Log 追加：修改文件、验证结果、未覆盖项、是否需要 Tauri smoke、是否生成 checkpoint。

禁止事项：

- 禁止把主机资产菜单和文件面板菜单合并成一个大组件后靠 if 判断硬凑。
- 禁止直接从 UI 事件拼后端请求，必须先经过 resolver/action model。
- 禁止默认覆盖目标文件。
- 禁止把跨主机传输描述成远端服务器直连，除非另有能力检测和安全确认。
- 禁止为了一个切片宽泛格式化 `src/features/sftp/**`。

### 生产完成定义

生产版完成不是“按钮都出现”，而是以下事实同时成立：

- 本机和远端都是一等文件面板，左右两侧都可以作为源或目标。
- 用户能在工作台内添加已有 SSH 主机或新建 SSH 主机，不需要跳出工作流。
- 文件面板右键、工具栏、拖拽、内部复制/粘贴触发同一套 action model 和 resolver。
- 四类复制闭环都可执行：local -> remote、remote -> local、remote -> remote、local -> local。
- 队列能解释任务发生了什么、为什么失败、如何取消或重试。
- 冲突和危险操作不会静默造成数据破坏。
- 主机资产右键菜单、文件面板右键菜单、pane tab 右键菜单语义分离。
- 浅色、深色、跟随系统主题可读；文字不重叠；窄右栏和展开模式都可用。
- 自动化验证、真实 dev server smoke、涉及 Tauri 能力时的 `npm run tauri:dev` smoke，以及至少一个真实 SSH smoke 有证据。

## 实施切片

| 顺序 | 标题 | 类型 | 依赖 | 主要交付 | 验收 |
| --- | --- | --- | --- | --- | --- |
| 1 | 文件目标和 pane 状态模型定版 | AFK | None | 定义 `FileEndpoint`、pane tab、selection、drag payload、TransferIntent；补单测 | 模型测试覆盖本机、远端、同主机多 tab、源目标解析 |
| 2 | 本地文件面板生产化 | AFK | 1 | `LocalTransferPane` 支持选择、多选、右键、刷新、系统打开、复制路径、新建、重命名、删除基础能力 | 本地目录不再只是预览；右键菜单和工具栏可执行；本地面板单测通过 |
| 3 | 本机/远端文件表格统一 | AFK | 1,2 | 抽 `SftpFilePane` 和 table presentation，本机/远端共享列、选择和空态 | 远端现有 SFTP 行为不回退；本机和远端表格视觉一致 |
| 4 | 文件菜单域模型 | AFK | 2,3 | 抽 `sftpFileActionModel` 和菜单分域测试；文件面板菜单与主机资产菜单分开 | 文件菜单不出现主机编辑；主机菜单不出现 chmod/rm-rf；tab 菜单不出现文件删除 |
| 5 | 工具栏和快捷键统一动作 | AFK | 4 | 每个 pane 的图标工具栏、tooltip、F5/Delete/Ctrl+C/Ctrl+V/Enter/Backspace 接入同一 action model | 工具栏和右键启用态一致；浅色/深色可读 |
| 6 | 主机 tab 和新增主机入口 | AFK/HITL | 1,3 | 左右 pane group 都支持本机/SSH tab、`+` 添加、搜索已保存主机、新建 SSH 主机后打开 | 任一侧可添加多个主机 tab；同主机多 tab 路径互不污染；新建主机可成为目标 |
| 7 | Transfer resolver 和本机到远端上传 | AFK | 1-6 | local -> remote 右键、工具栏、拖拽入队；冲突暂时按 ask 占位 | 本机文件拖到远端目录能上传，队列显示源本机和目标主机 |
| 8 | 远端到本机下载闭环 | AFK | 7 | remote -> local 右键、工具栏、拖拽入队；目标本机目录刷新 | 远端文件拖到本机 pane 能下载；失败显示原因 |
| 9 | 远端到远端和同主机目录复制 | AFK | 7,8 | remote -> remote 走 `sftp_enqueue_remote_copy`；同主机不同路径也走复制；同路径自动改名 | 主机 A 到主机 B 文件/目录复制成功；队列显示本机桥接或中转 |
| 10 | 本机到本机复制 | AFK | 7 | local -> local 走本地复制任务，补本地 copy 后端和队列摘要 | 左右均为本机时拖拽可复制，不出现无效死角 |
| 11 | 冲突预检和批量策略 | HITL/AFK | 7-10 | stat 预检、覆盖/自动重命名/跳过/应用到全部、目录合并策略 | 不静默覆盖；多项冲突可批量处理；生产目标覆盖增强确认 |
| 12 | 队列表格和重试 | AFK | 7-11 | `SftpTransferQueuePanel` 展示源/目标/方式/速度/ETA/取消/重试/清理 | 失败任务可重试；跨主机任务源目标清晰；旧任务字段兼容 |
| 13 | 危险远端操作和生产保护 | HITL/AFK | 4,6,11 | chmod、压缩、普通删除、rm-rf、生产主机提示和二次确认梳理 | `rm-rf` 不会误触；生产主机覆盖/删除有确认；权限输入校验 |
| 14 | 状态持久化和恢复 | AFK | 6-12 | 保存左右 tab、路径、split、showHidden、最近目标；主机删除/路径缺失恢复 | 重启后恢复工作台；失效主机和路径有可解释状态 |
| 15 | 真实启动、主题和端到端验收 | HITL/AFK | 1-14 | 自动化测试、build、dev server、Tauri smoke、浅色/深色/跟随系统、真实 SSH 主机 smoke | 验收清单全部通过，未覆盖项写入风险 |

## 各切片详细要求

### Slice 1：文件目标和 pane 状态模型定版

涉及：

- `src/features/sftp/sftpPaneModel.ts`
- `src/features/sftp/sftpTransferWorkbenchModel.ts`
- `src/features/sftp/sftpTransferResolver.ts`

要求：

- 明确 `local` 和 `remote` endpoint。
- tab id 与 host id 分离，允许同一 host 多 tab。
- selection 只保存路径和类型，不保存不稳定 DOM 状态。
- drag payload 既支持单项也支持多选。
- 目标路径 resolver 覆盖投放到目录行和当前目录空白处。

验证：

- 本机到远端、远端到本机、远端到远端、本机到本机的 resolver 单测。
- 同源同目标路径、源目录投放到自身子树、tab 关闭后的 payload 解析测试。

### Slice 2：本地文件面板生产化

涉及：

- `src/features/sftp/LocalTransferPane.tsx`
- `src/features/sftp/localTransferPaneModel.ts`
- 本地文件 API 或 Tauri command。

要求：

- 本机文件列表支持多选和行级右键。
- 空白区域右键支持粘贴、新建、刷新、系统打开。
- 行级右键第一项是传输到另一侧。
- 本机删除、重命名、新建要有错误提示和刷新。
- Windows 路径、隐藏文件、权限不足、目录不存在要有明确状态。

验证：

- 本地目录 listing 成功、权限失败、路径不存在测试。
- 右键 action availability 测试。
- 本机面板选中项拖拽 payload 测试。

### Slice 3：本机/远端文件表格统一

要求：

- 本机和远端共享行高度、选择列、文件图标、空态、错误态。
- 远端特有列可显示权限/所有者，本机不具备时隐藏或显示 `-`。
- 不因某一侧列少导致左右表格错位严重。
- 所有 portal 和弹层继承全局主题。

验证：

- 现有 SFTP 远端测试不回退。
- 浅色、深色和跟随系统截图验收。

### Slice 4：文件菜单域模型

要求：

- 主机资产菜单、文件面板菜单、pane tab 菜单分别建 action model。
- 菜单外观可复用，但 domain 不复用。
- 右键菜单第一组保持高频动作，危险动作放底部。

验证：

- 三类菜单的 action snapshot 测试。
- 本机行、远端行、空白区域、tab、主机资产分别覆盖。

### Slice 5：工具栏和快捷键统一动作

要求：

- 工具栏按钮只调用 action model。
- 快捷键只在工作台 focus 内生效，不抢终端输入焦点。
- tooltip 写清动作和禁用原因。
- 图标按钮尺寸和间距稳定。

验证：

- 键盘事件单测。
- focus 在终端时不会触发文件删除。

### Slice 6：主机 tab 和新增主机入口

要求：

- 左右 pane group 都有 `+`。
- 支持搜索已保存 SSH 主机。
- 支持 `新建 SSH 主机...`，复用现有创建弹框。
- 创建成功后自动添加到触发侧。
- 主机连接失败只影响对应 tab。

验证：

- 左右侧分别添加多个主机 tab。
- 同一 host 多 tab 路径隔离。
- 新建 SSH 主机后出现在对应 pane。

### Slice 7-10：四类传输闭环

要求：

- 所有传输入口都走同一个 resolver。
- 多选入队时显示批量摘要。
- 目标刷新只刷新相关 pane，不全局乱刷新。
- 失败不清空 selection。

验证：

- local -> remote 上传。
- remote -> local 下载。
- remote -> remote 跨主机复制。
- remote -> remote 同主机不同目录复制。
- local -> local 本机复制。
- 多选和目录递归。

### Slice 11：冲突预检和批量策略

要求：

- 传输前 stat 目标路径。
- 目标存在时必须弹策略，不静默覆盖。
- 批量场景支持应用到全部。
- 自动重命名递增检查。
- 目录合并和文件覆盖语义要在弹框里明确。

验证：

- 单文件冲突。
- 多文件部分冲突。
- 目录冲突。
- 生产目标覆盖。

### Slice 12：队列表格和重试

要求：

- transfer summary 新增 source/target/operation/transportMode。
- 旧字段保留兼容。
- 前端计算速度和 ETA。
- 失败任务重试生成新任务，不复用旧 id。
- 清理成功任务不影响运行中任务。

验证：

- 跨主机任务显示源主机和目标主机。
- 本机复制显示本机路径。
- 取消、失败、重试、清理。

### Slice 13：危险远端操作和生产保护

要求：

- `rm -rf` 与普通删除分开。
- chmod 输入校验。
- 压缩动作只在远端可用并显示目标产物路径。
- 生产主机覆盖、删除、rm-rf 增强确认。
- 所有危险操作写审计或至少可被 transfer/action log 追踪。

验证：

- 非生产和生产主机确认文案不同。
- 取消确认不执行后端调用。
- 权限错误、路径不存在、只读目录有明确错误。

### Slice 14：状态持久化和恢复

要求：

- 工作台关闭/重启后恢复左右 tab 和路径。
- 主机被删除时不崩溃。
- 本机路径不存在时回退 home。
- 不持久化敏感凭据和 selection。

验证：

- store 单测。
- 删除 host 后恢复。
- 不同主题下恢复后仍可读。

### Slice 15：真实启动和端到端验收

自动化验证：

- `npm run test:frontend -- src/features/sftp`
- `npm run test:frontend -- src/features/machine-sidebar`
- `npm run typecheck`
- `npm run build`
- `npm run dev -- --host 127.0.0.1 --port <free-port>` 并做 HTTP smoke。
- 涉及 Tauri/Rust 后端后运行 `npm run tauri:dev` 或记录无法运行原因。
- Rust 定向测试按实际改动选择：
  - `cd src-tauri; cargo test sftp --lib -- --nocapture`
  - `cd src-tauri; cargo test sftp_transfer --test <target> -- --nocapture`

人工 smoke：

1. 打开 SFTP 工具，进入传输工作台。
2. 左侧本机目录右键文件，能看到传输、打开、复制、粘贴、复制路径、系统打开、重命名、删除、刷新、新建。
3. 右侧远端目录右键文件，能看到传输、编辑、复制、粘贴、复制路径、重命名、删除、chmod、rm-rf、压缩、刷新、新建。
4. 左侧本机文件拖到右侧远端目录，上传成功。
5. 右侧远端文件拖到左侧本机目录，下载成功。
6. 左右分别添加两个 SSH 主机 tab，主机 A 文件拖到主机 B，跨主机复制成功。
7. 目标已有同名文件时，弹出覆盖/重命名/跳过。
8. 生产主机作为目标且覆盖时，有增强确认。
9. 失败任务在队列里显示原因并能重试。
10. 浅色、深色、跟随系统主题下，菜单、弹框、队列和表格无重叠、无不可读文本。

## 验收标准

- 本机面板不再是只读预览，用户能直接右键、拖拽、传输、复制路径、系统打开、刷新、新建、重命名和删除。
- 传输工作台任意一侧都能添加本机或 SSH 主机 tab。
- 用户能在工作台内新建 SSH 主机，并把新主机直接作为左侧或右侧目标。
- 文件面板右键菜单和左侧主机资产右键菜单语义完全分离。
- 本机和远端文件面板菜单同骨架、不同能力；`传输` 是选中项第一优先动作。
- 工具栏是图标化、可 tooltip 解释、可禁用说明的紧凑工具栏。
- 本机到远端、远端到本机、远端到远端、同主机不同目录、本机到本机都能完成复制类传输。
- 多选文件和目录能一次入队。
- 队列能清楚展示源、目标、方式、进度、速度、剩余时间、失败原因、取消、重试和清理。
- 目标冲突不静默覆盖，用户能选择覆盖、自动重命名、跳过或取消。
- 生产主机覆盖和危险远端操作有二次确认。
- 浅色、深色、跟随系统主题均可读，没有文本重叠。
- `npm run build` 通过；涉及真实桌面能力的实现必须完成 `npm run tauri:dev` smoke 或明确无法执行原因。

## 风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| 继续在现有面板上补按钮导致模型更乱 | 后续拖拽、菜单、队列难维护 | 先定 endpoint、pane、action model，再接 UI |
| 本机面板能力不足 | 用户仍觉得只能预览 | Slice 2 必须先让本机面板可右键、可拖拽、可执行 |
| 主机资产菜单和文件菜单混用 | 用户误删主机或找不到文件动作 | 三类菜单 domain 分离并加测试 |
| 用户误以为跨主机是远端直连 | 安全和性能预期错误 | 队列显示本机桥接/本机中转，帮助文案说明 |
| 目标冲突静默覆盖 | 数据损坏 | 冲突预检作为生产版必做切片 |
| 生产主机误操作 | 生产事故 | host production 标记触发增强确认 |
| `SftpToolContent` 继续膨胀 | 开发成本和回归风险升高 | 抽 pane、queue、action model、resolver |
| Tauri 本地文件权限差异 | Windows/macOS/Linux 行为不一致 | 后端 command 做平台适配，错误码结构化 |
| 队列事件字段不兼容 | 旧 UI 或测试失败 | 新字段 optional，旧字段兼容一段时间 |
| UI 在窄右栏不可用 | 表格和队列被挤压 | 支持展开到主工作区或独立窗口 |

## 实施顺序建议

第一阶段：修复基础可用性。

- Slice 1 到 Slice 5。
- 目标是本地面板可操作、菜单域清楚、工具栏和快捷键统一。

第二阶段：形成完整双面板传输。

- Slice 6 到 Slice 10。
- 目标是左右任意本机/SSH tab，四类传输都能跑通。

第三阶段：补齐生产品质。

- Slice 11 到 Slice 15。
- 目标是冲突、队列、重试、生产保护、持久化和真实启动验收。

不要先做 P3 远端命令加速；默认桥接模型已经足够支撑生产版，先把用户每天会点到的本机面板、右键、拖拽、队列和冲突做好。

## 后续可以单独立项的增强

- 目录比较和双向同步。
- 暂停/断点续传。
- 同主机 server-side copy capability detection。
- 远端命令加速跨主机传输。
- 文件传输历史持久化和搜索。
- 从远端拖出到系统文件管理器。
- 容器文件系统加入左右 pane target。
- 更完整的权限、owner/group 修改。

## Round Log

### 2026-06-22T10:24:29+08:00 P6 非 SSH 目标 drop 拒绝原因

本轮按“采用 subagent 并行完成 SFTP 传输工作台生产级完整实现计划”继续推进。主线程先刷新 lane 状态和 CodeGraph 上下文，同时派出两个只读 explorer 并行审计：`Singer` 负责 P6 剩余内部剪贴板、本机到本机、不能投放原因和视觉状态；`Averroes` 负责 P7-P10 本机写操作、队列生产化、冲突保护、持久化和最终验收。两个 explorer 均确认完整计划仍未完成，P7-P10 后续会进入 Rust/Tauri 与真实 SSH/HITL，本轮先收一个低冲突 P6 前端切片。

已落地代码切片：

- `src/features/sftp/sftp-tool-content/useSftpTransferActions.ts`：本机工作台 payload 拖到非 SSH/SFTP 目标时，`drag enter/over/drop` 明确拒绝；`dropEffect` 设置为 `none`，清理 drop active 状态，并显示“本机文件只能拖放到 SSH/SFTP 远端目录。”；不会调用本机路径分类、上传 runner 或 remote copy runner。
- `src/features/sftp/sftp-tool-content/useSftpTransferActions.test.ts`：新增非 SSH target 拒绝测试，覆盖 `dragEnter`/`dragOver`/`drop`、可见错误原因和无副作用断言。

验证结果：

- `npm run test:frontend -- src/features/sftp/sftp-tool-content/useSftpTransferActions.test.ts`：1 个测试文件、12 个测试通过。
- `npm run test:frontend -- src/features/sftp/sftp-tool-content/useSftpTransferActions.test.ts src/features/sftp/sftp-tool-content/sftpLocalUploadDropModel.test.ts src/features/sftp/LocalTransferPane.test.tsx`：3 个测试文件、23 个测试通过。
- `npm run typecheck`：通过。
- `npm run test:frontend -- src/features/sftp`：46 个测试文件、319 个测试通过。
- `npm run check:source-size`：通过，665 files，over-limit=0，warning=46；`useSftpTransferActions.test.ts` 已到 991 行，后续新增 hook 测试必须先拆分测试文件。
- `npm run build`：通过；保留既有 Vite large chunk warning。
- `npm run dev -- --host 127.0.0.1 --port 1496 --strictPort` 后 HTTP smoke `GET http://127.0.0.1:1496/` 返回 200；临时 dev server 已按端口停止，1496 无残留监听。

本轮未跑：

- `npm run tauri:dev` 未执行；本轮只改 React/TypeScript 前端 hook 和测试，没有新增 Rust、Tauri command、窗口、权限或 capability 修改。
- 未做真实 SSH/HITL 和主题截图；本轮只补非法 drop 原因的一条前端行为。

剩余边界：

- P6 仍需补内部 Ctrl+C/Ctrl+V、本机到本机 drop/copy、统一不能投放 reason model、drag ghost/drop 视觉状态和更完整的视觉验收。
- P7/P8/P9/P10 仍需继续推进本机写操作、队列生产化、冲突预检/生产保护、持久化和真实 SSH/Tauri/主题最终验收。

### 2026-06-22T10:05:41+08:00 P6 local -> remote 拖拽上传闭环

本轮接续被中断的 SFTP 完善任务，继续收口 P6 拖拽能力：工作台左侧本机文件/目录可以拖到右侧 SSH 远端 pane，并上传到右侧当前远端目录。实现继续避开 `SftpTransferWorkbench.tsx` 主文件膨胀，只做本机 pane payload、远端 hook 消费和测试补强。

已落地代码切片：

- `src/features/sftp/sftp-tool-content/sftpLocalUploadDropModel.ts` 新增工作台内部本机文件拖拽 payload 模型，提供 `SFTP_LOCAL_FILE_DRAG_PAYLOAD_MIME`、build/parse 和 MIME 类型检测；payload 记录 source side、base path 和 entries。
- `src/features/sftp/LocalTransferPane.tsx` 复用本机拖拽 payload 模型；拖拽已选中的本机行时携带当前选中集合，拖拽未选中行时只携带该行，保留 `text/plain` 兼容路径。
- `src/features/sftp/sftp-tool-content/useSftpTransferActions.ts` 在远端 pane drag enter/over/drop 识别本机 payload，进入 SSH 目标 pane 时设置 drop active 状态；drop 后解析 payload 并复用现有 `uploadDroppedLocalPaths(paths, currentPath)` 上传到当前远端目录，坏 payload 给出可见错误。
- `src/features/sftp/SftpToolContent.tsx` 仅补充 `setDragDropActive` wiring，让远端浏览器现有 drop overlay 能服务工作台本机拖入上传。
- `src/features/sftp/sftp-tool-content/sftpLocalUploadDropModel.test.ts`、`LocalTransferPane.test.tsx`、`useSftpTransferActions.test.ts` 覆盖本机 payload build/parse、选中集合拖拽 MIME 和 local -> remote drop 上传调用。

验证结果：

- `npm run test:frontend -- src/features/sftp/sftp-tool-content/sftpLocalUploadDropModel.test.ts src/features/sftp/LocalTransferPane.test.tsx src/features/sftp/sftp-tool-content/useSftpTransferActions.test.ts`：3 个测试文件、22 个测试通过。
- `npm run typecheck`：通过。
- `npm run test:frontend -- src/features/sftp`：46 个测试文件、318 个测试通过。
- `npm run check:source-size`：通过，665 files，over-limit=0，warning=46；当前最大 SFTP 文件 `SftpTransferWorkbench.tsx` 为 970 行。
- `npm run build`：通过；保留既有 Vite large chunk warning。
- `npm run dev -- --host 127.0.0.1 --port 1493 --strictPort` 后 HTTP smoke `GET http://127.0.0.1:1493/` 返回 200；临时 dev server 已按端口停止，1493 无残留监听。

本轮未跑：

- `npm run tauri:dev` 未执行；本轮只改 React/TypeScript 前端 payload/model/hook/component 和前端测试，没有新增 Rust、Tauri command、窗口、权限或 capability 修改。
- 未做真实 SSH 主机拖拽上传和截图级视觉验收；当前验证覆盖前端 payload、drop 状态、上传目录参数和调用链，真实 SSH/主题截图验收留到 P10。

剩余边界：

- P6 仍需补内部 Ctrl+C/Ctrl+V、本机到本机 drop/copy、不能投放原因、drag ghost/drop 状态和更完整的视觉验收。
- P7/P8/P9 仍需继续推进本机写操作、队列生产化、冲突预检和生产保护。

### 2026-06-22T09:00:04+08:00 P6 remote -> local 拖拽下载闭环

本轮继续 active goal，收口 P6 中最直接对应用户反馈的拖拽缺口：远端文件/目录可以拖到左侧本机 pane，并下载到当前本机目录。实现不修改 `SftpTransferWorkbench.tsx`，避免继续推高 997 行的主工作台文件。

协作记录：

- 只读 explorer `Fermat` 复核了最小接入点，结论是 `LocalTransferPane` 当前没有 drop 处理，最小实现应在本机 pane root 消费 `SFTP_REMOTE_DRAG_PAYLOAD_MIME`，用 payload source host + 当前本机目录构造下载任务，不上提到 Workbench。

已落地代码切片：

- `src/features/sftp/sftp-tool-content/sftpRemoteTransferModel.ts` 新增 `remoteDragPayloadEntriesToSftpEntries`，把远端 drag payload entry 转回可复用现有下载 plan 的 `SftpEntry`；新增 `hasSftpRemoteDragPayloadType`，让本机 pane 和远端 pane 共用 MIME 检测逻辑。
- `src/features/sftp/LocalTransferPane.tsx` 在本机 pane root 增加 remote drag enter/over/leave/drop 处理，只识别远端 payload；drop 时以 payload 的 `sourceHostId` 为下载 host，以当前 `listing.path` 为目标本机目录，复用 `buildBatchDownloadTransferPlan` 与 `enqueueSftpTransfer` 入队。
- `src/features/sftp/sftp-tool-content/useSftpTransferActions.ts` 改为复用 `hasSftpRemoteDragPayloadType`，避免远端 pane 和本机 pane 各自维护 MIME 判断。
- `src/features/sftp/LocalTransferPane.test.tsx` 新增 remote payload drop 下载入队测试和坏 payload 不入队错误测试；`sftpRemoteTransferModel.test.ts` 新增 payload entry 转换和 MIME 类型集合检测测试。
- `src/features/tool-panel/AiToolContent.tsx` 删除并行 AI lane 遗留的未使用 type-only import，修复全仓 `typecheck` 和 `source-size` 门禁；未修改 AI 运行逻辑。

验证结果：

- `npm run test:frontend -- src/features/sftp/LocalTransferPane.test.tsx src/features/sftp/sftp-tool-content/sftpRemoteTransferModel.test.ts`：2 个测试文件、23 个测试通过。
- `npm run test:frontend -- src/features/sftp/LocalTransferPane.test.tsx src/features/sftp/sftp-tool-content/sftpRemoteTransferModel.test.ts src/features/sftp/sftp-tool-content/useSftpTransferActions.test.ts`：3 个测试文件、33 个测试通过。
- `npm run test:frontend -- src/features/sftp`：45 个测试文件、303 个测试通过。
- `npm run typecheck`：通过。
- `npm run check:source-size`：通过，657 files，over-limit=0，warning=42；最大文件仍是 `SftpTransferWorkbench.tsx` 997 行，本轮没有增加该文件。
- `npm run build`：通过；保留既有 Vite large chunk warning。
- `npm run dev -- --host 127.0.0.1 --port 62237 --strictPort` 后 HTTP smoke `GET http://127.0.0.1:62237/` 返回 200，页面长度 644；临时 dev server 已停止且 62237 无残留监听。

本轮未跑：

- `npm run tauri:dev` 未执行；本轮只改 React/TypeScript 前端 model/hook/component 和前端测试，没有新增 Rust、Tauri command、窗口、权限或 capability 修改。
- 未做真实 SSH 主机拖拽下载；当前验证覆盖前端 payload、任务构造和入队调用，真实 SSH smoke 留到 P10 最终验收。

剩余边界：

- P6 仍需补内部 Ctrl+C/Ctrl+V、本机到远端 drop、本机到本机 drop/copy、不能投放原因、drag ghost/drop 状态和更完整的视觉验收。
- P7/P8/P9 仍需继续推进本机写操作、队列生产化、冲突预检和生产保护。

### 2026-06-22T08:43:50+08:00 P6 remote drag payload 首个闭环和计划状态同步

本轮按用户“完整实施计划写到文档”的要求补齐计划状态，同时把已经进入工作区的 P6 首个拖拽切片收口到文档。该切片只声明 remote -> remote 拖拽 payload 和 drop 消费闭环，不把完整 P6 夸大为已完成。

已落地代码切片：

- `src/features/sftp/sftp-tool-content/sftpRemoteTransferModel.ts` 新增 `SFTP_REMOTE_DRAG_PAYLOAD_MIME`、`SftpRemoteDragPayload`、`buildSftpRemoteDragPayload` 和 `parseSftpRemoteDragPayload`，remote drag 不再只有路径字符串。
- `src/features/sftp/sftp-tool-content/useSftpRemoteDownloadDragActions.ts` 在拖拽开始时可写入 source host、host label 和 entries，同时保留旧 remote download MIME 与 `text/plain`，避免破坏既有下载路径。
- `src/features/sftp/sftp-tool-content/useSftpTransferActions.ts` 在远端 pane drag enter/over/drop 识别新 payload；目标 pane 是 SSH 时解析 payload，构造 remote copy paste plan，并复用现有 `runRemoteCopyTask` 入队。
- 相关测试补到 `sftpRemoteTransferModel.test.ts`、`useSftpRemoteDownloadDragActions.test.ts` 和 `useSftpTransferActions.test.ts`，覆盖 payload build/parse、legacy MIME 兼容和 remote -> remote drop 调用 remote copy runner。

验证结果：

- `npm run test:frontend -- src/features/sftp/sftp-tool-content/sftpRemoteTransferModel.test.ts src/features/sftp/sftp-tool-content/useSftpRemoteDownloadDragActions.test.ts src/features/sftp/sftp-tool-content/useSftpTransferActions.test.ts`：3 个测试文件、36 个测试通过。
- `npm run dev -- --host 127.0.0.1 --port 61074 --strictPort` 后 HTTP smoke `GET http://127.0.0.1:61074/` 返回 200，页面长度 644；首次停止只杀到 `npm.cmd` 父进程，Vite 子进程仍监听 61074，随后按端口精确停止 owning process 并确认 61074 无残留监听。

本轮未跑：

- 本轮只追加 P6 窄测、真实 dev server HTTP smoke 和文档状态同步；`npm run typecheck`、`npm run test:frontend -- src/features/sftp`、`npm run check:source-size`、`npm run build` 已在本轮前序 P6 验证中通过，未重复运行。
- `npm run tauri:dev` 未执行；P6 首个拖拽切片只改 React/TypeScript 前端 model/hook，没有新增 Rust、Tauri command、窗口、权限或 capability 修改。

剩余边界：

- P6 还没覆盖 `LocalTransferPane` 消费远端 payload，因此 remote -> local 拖拽/download 仍需继续。
- Ctrl+C/Ctrl+V 内部剪贴板、本机到远端 drop、本机到本机 copy/drop、drag ghost、不能投放原因和 drop target 视觉状态仍未完成。
- `SftpTransferWorkbench.tsx` 已接近 1000 行硬限制，后续 P6 必须优先拆 model、hook 或子组件，避免继续把逻辑塞回主组件。

### 2026-06-22T08:27:41+08:00 P5 工作台内新建 SSH 主机 full gate

本轮继续 active goal，先补 P5“工作台内新建 SSH 主机...”的完整前端验证门禁，不新增代码。当前实现已经具备：左右添加主机下拉触发新建 SSH 主机，Shell 记录 pending side/workspace tab，创建成功且是 SFTP-capable host 后回填到对应工作台侧；Workbench 只消费匹配 workspace tab 和未处理 sequence 的 created target。

验证结果：

- `npm run test:frontend -- src/features/sftp/SftpTransferWorkbench.test.tsx src/app/KerminalShell.test.tsx`：2 个测试文件、43 个测试通过。
- `npm run test:frontend -- src/features/sftp`：45 个测试文件、293 个测试通过。
- `npm run typecheck`：通过。
- `npm run check:source-size`：通过，648 files，over-limit=0，warning=42；`SftpTransferWorkbench.tsx` 已到 997 行，后续 P6 不应继续往该文件堆逻辑。
- `npm run build`：通过；保留既有 Vite large chunk warning。
- `npm run dev -- --host 127.0.0.1 --port 53199 --strictPort` 后 HTTP smoke `GET http://127.0.0.1:53199/` 返回 200；临时 dev server 已按监听端口停止，53199 无残留监听。

验证插曲：

- 1481 和 1482 端口已被占用，未碰未知监听进程；改用动态探测出的 53199 完成真实 dev server smoke。

本轮未跑：

- `npm run tauri:dev` 未执行；P5 新建主机切片本轮只验证 React/Shell 前端桥接，没有新增 Rust、Tauri command、窗口、权限或 capability 修改。

剩余边界：

- P6 进入 remote drag payload 跨 pane 与内部复制/粘贴；由于 `SftpTransferWorkbench.tsx` 接近 1000 行硬上限，P6 必须优先在模型/hook/子组件中落地，Workbench 只允许最小 wiring 或先抽出辅助模块。

### 2026-06-22T08:18:12+08:00 完整计划文档二次收口和 P5 新建主机记录

本轮按用户最新指令只做“完整实施计划写到文档”的收口，不继续扩展实现代码。已重新核对三张截图和官方资料抽象：本机/远端都应是一等文件面板，文件面板右键和主机资产右键必须分域，双面板工作台应保持高密度表格、路径栏、工具栏和队列可见。

文档补齐：

- 更新 `当前基线`，把 P3 远端到本机、P4 菜单域分离、P5/P6 左侧 `本机 + SSH` tab 和“工作台内新建 SSH 主机...”桥接都写入当前事实。
- 更新 `下一轮优先级`，不再把已完成的 P4/P5 首批切片当作下一步；后续优先级改为 P5 full gate、P6 remote drag payload/内部剪贴板、P7 本机写操作和 P8/P9 队列/冲突。
- 保持完整生产版范围：P0-P10 实施包、15 个垂直切片、截图学习、竞品抽象、菜单域矩阵、传输 resolver、队列、冲突、生产保护、持久化、真实验收和风险对策仍在同一个 active plan 中。
- 同步更新 `.updeng/docs/plan/INDEX.md` 与 `.updeng/docs/in-progress.md` 的 SFTP 计划摘要。

本轮记录的已存在代码切片：

- `SftpTransferWorkbench` 已暴露 `onCreateSshHost`、`createdHostTarget` 和 `workspaceTabId`，左右添加主机下拉均可触发 `新建 SSH 主机...`。
- `KerminalShell` 已记录 pending side/workspace tab，创建成功后只把 SSH/SFTP-capable host 回填到对应工作台侧；取消创建会清理 pending target。
- Workbench 只消费匹配 `workspaceTabId` 且未处理过 sequence 的 created target，避免多个工作台 tab 误收新主机。

验证结果：

- `npm run test:frontend -- src/features/sftp/SftpTransferWorkbench.test.tsx src/app/KerminalShell.test.tsx`：2 个测试文件、43 个测试通过。

本轮未跑：

- `npm run typecheck`、`npm run test:frontend -- src/features/sftp`、`npm run check:source-size`、`npm run build` 和真实 dev server smoke 未执行；本轮目标是文档收口，只对需要写入文档的 P5 新建主机事实做最窄测试复核。
- `npm run tauri:dev` 未执行；本轮没有新增 Rust/Tauri/窗口/capability 修改。

剩余边界：

- P5 新建主机切片还需要补 full gate 后再视作生产验收完成，并刷新 lane checkpoint。
- remote drag payload 跨 pane、内部复制/粘贴、本机写操作、remote -> remote 完整传输、冲突预检、队列生产化、真实 SSH smoke 和主题截图仍未完成。

### 2026-06-22T07:56:32+08:00 P5/P6 左侧 SSH tab 和对侧 target 闭环

本轮使用只读 subagent 复核 P5/P6 入口。subagent 结论是：当前右侧已有 SSH host tab 与添加主机下拉，左侧仍固定为 `LocalTransferPane`；最小生产切片应先让左侧支持“本机 + SSH tab”，并按 active 左右 pane 派生对侧 `SftpTransferTarget`，工作台内“新建 SSH 主机...”可作为后续 Shell 弹框集成切片。

已落地代码切片：

- `src/features/sftp/SftpTransferWorkbench.tsx` 新增左侧 pane 状态：`leftTabs`、`activeLeftTabId`、`leftCurrentPaths`，默认 active tab 是本机。
- 左侧新增 `添加左侧服务器` 下拉，可从已保存 SSH 主机中添加左侧 SSH tab；左侧 tab 条保留 `本机` tab，并支持 SSH tab 关闭后回退本机。
- 当左侧 active 为本机时，右侧远端面板继续收到 `{ kind: "local"; side: "left"; localPath }` target；当左侧 active 为 SSH 时，右侧远端面板收到 `{ kind: "remote"; side: "left"; hostId; remotePath }` target。
- 当左侧 active 为 SSH 且右侧 active 为 SSH 时，左侧远端面板也会收到右侧 remote target，为后续 remote -> remote 右键/工具栏传输入口提供 UI target。
- `HostTabButton` 的关闭控件改成明确的 `关闭 <host>` button，避免只在 SVG 上绑定点击，组件测试可以覆盖关闭回退。
- `src/features/sftp/sftpTransferWorkbenchModel.ts` 新增 `SFTP_TRANSFER_LOCAL_TAB_ID` 和 `resolveActivePaneTabId`，保证左侧 SSH tab 被移除或关闭后不会留下失效 active id。
- `SftpTransferWorkbench.test.tsx` 补充左侧添加 SSH、左侧远端路径上报、切回本机、关闭左侧 SSH tab 回退本机等回归。
- `sftpTransferWorkbenchModel.test.ts` 补充 active pane tab 本机 fallback 纯模型测试。

验证结果：

- `npm run test:frontend -- src/features/sftp/SftpTransferWorkbench.test.tsx src/features/sftp/sftpTransferWorkbenchModel.test.ts`：2 个测试文件、23 个测试通过。
- `npm run typecheck`：通过。
- `npm run test:frontend -- src/features/sftp`：45 个测试文件、290 个测试通过。
- `npm run check:source-size`：通过，642 files，over-limit=0，warning=41；本轮未触发 1000 行硬限制。
- `npm run build`：通过；仅保留既有 Vite large chunk warning。
- `npm run dev -- --host 127.0.0.1 --port 1479 --strictPort` 后 HTTP smoke `GET http://127.0.0.1:1479/` 返回 200，并已停止临时 dev server，1479 端口无残留监听。
- `git diff --check -- src/features/sftp/SftpTransferWorkbench.tsx src/features/sftp/SftpTransferWorkbench.test.tsx src/features/sftp/sftpTransferWorkbenchModel.ts src/features/sftp/sftpTransferWorkbenchModel.test.ts`：通过，仅有 Windows LF/CRLF 归一化提示。

本轮未跑：

- `npm run tauri:dev` 未执行；本轮只改 React/TypeScript 工作台 UI、纯模型和前端测试，未修改 Rust、Tauri command、窗口、权限或 capability。

剩余边界：

- 工作台内 `新建 SSH 主机...` 尚未接入 `RemoteHostCreateDialog`；下一切片需要在 Shell 层记录 pending side，创建成功后刷新主机树并把新 host 加到对应 pane。
- 左侧本机仍只支持 local -> remote；local -> local 本机复制、remote drag payload 跨 pane、冲突预检和生产主机增强确认仍归后续 P6/P9/P10。
- 同一 SSH 主机多个 tab 的真实 `SftpToolContent` 内部浏览状态仍需后续单独评估；本轮先保证外层 target/path map 按 tab id 隔离。

### 2026-06-22T00:47:10+08:00 P4 菜单域分离收口

本轮用一个只读 subagent 复核机器侧栏主机资产菜单与 SFTP 文件面板菜单边界；subagent 结论是 SFTP 文件面板已经是 model -> render -> action resolver 结构，机器侧栏需要显式 domain/action 标记，避免 JSX 菜单和模型漂移。

已落地代码切片：

- `src/features/sftp/sftp-tool-content/sftpContextMenuModel.ts` 为 SFTP 文件面板菜单补 `SFTP_FILE_PANEL_MENU_DOMAIN`、`SFTP_FILE_PANEL_MENU_ACTIONS` 和 item-level `domain`。
- `src/features/sftp/sftp-tool-content/SftpContextMenu.tsx` 在菜单容器和菜单项上输出 `data-menu-domain="sftpFilePanel"`，菜单项同时输出 `data-menu-action`。
- `src/features/machine-sidebar/machineSidebarMenuModel.ts` 新增机器侧栏 root/group/machine asset 三个菜单域及 action model：`machineSidebarRoot`、`machineGroup`、`machineAsset`。
- `src/features/machine-sidebar/MachineSidebar.tsx`、`MachineSidebar.parts.tsx` 在主机资产、分组和 root 右键菜单容器/菜单项上输出明确 `data-menu-domain` 与 `data-menu-action`。
- 新增 `machineSidebarMenuModel.test.ts`、`machineSidebarMenuDomain.test.tsx`、`SftpContextMenu.test.tsx`，并补强 `sftpContextMenuModel.test.ts`，覆盖 host asset actions 与 file-panel actions 不相交、root/group/machine/SFTP DOM domain 标记，以及 SSH/Docker 主机菜单 action 集差异。

验证结果：

- `npm run test:frontend -- src/features/machine-sidebar/machineSidebarMenuModel.test.ts src/features/machine-sidebar/machineSidebarMenuDomain.test.tsx src/features/machine-sidebar/MachineSidebar.test.tsx`：3 个测试文件、40 个测试通过。
- `npm run test:frontend -- src/features/sftp/sftp-tool-content/sftpContextMenuModel.test.ts src/features/sftp/sftp-tool-content/SftpContextMenu.test.tsx src/features/sftp/sftp-tool-content/sftpContextMenuActionModel.test.ts src/features/sftp/sftp-tool-content/useSftpContextMenuActions.test.ts`：4 个测试文件、21 个测试通过。
- `npm run typecheck`：通过。
- `npm run test:frontend -- src/features/sftp src/features/machine-sidebar`：52 个测试文件、356 个测试通过。
- `npm run check:source-size`：通过，641 files，over-limit=0，warning=40；`MachineSidebar.parts.tsx` 已到 953 行，后续不应继续堆逻辑。
- `npm run build`：通过；仅保留既有 Vite large chunk warning。
- `npm run dev -- --host 127.0.0.1 --port 1477 --strictPort` 后 HTTP smoke `GET http://127.0.0.1:1477/` 返回 200，并已停止临时 dev server，1477 端口无残留监听。
- `git diff --check -- <本轮 touched paths>`：通过，仅有 Windows LF/CRLF 归一化提示。

本轮未跑：

- `npm run tauri:dev` 未执行；本轮只改 React/TypeScript 菜单模型、DOM data 属性和前端测试，未修改 Rust、Tauri command、窗口、权限或 capability。

同步记录：

- 写入 `src/features/sftp/**` 前已读取 `lane-code-quality` checkpoint、coordination status、active plan 和当前 shared diff；本轮只做菜单域最小增强，不格式化 SFTP 或 MachineSidebar 大文件。
- checkpoint 已刷新：`.updeng/docs/coordination/checkpoints/lane-sftp-transfer-workbench-production.json`。

### 2026-06-22T00:27:41+08:00 P3 current-directory regression hardening

本轮在已有 P3 实现上做最小验证补强，不改生产代码。

背景：

- 复核当前实现后确认 P3 已具备右侧远端选中项通过 `SftpTransferTarget.kind === "local"` 下载到左侧本地当前目录的链路。
- 为避免“只在初始本地目录生效，用户切换左侧目录后仍下载到旧目录”的回归，本轮补组件级测试。

Touched paths：

- `src/features/sftp/SftpTransferWorkbench.test.tsx`
- `.updeng/docs/verification/source-size.json`
- `.updeng/docs/plan/done/2026-06-20-cross-host-sftp-transfer-workbench.md`
- `.updeng/docs/plan/INDEX.md`
- `.updeng/docs/in-progress.md`

本轮新增/确认：

- `SftpTransferWorkbench.test.tsx` 新增“左侧本地目录变化后右侧 transfer target 同步更新”的回归测试：模拟用户选择 `D:\deploy` 后，右侧 mock SFTP 面板收到 `transfer-target:left:D:\deploy`，并且左侧路径输入同步显示新目录。
- 保持 P3 生产代码不变：右侧工具栏/右键的传到左侧继续走 managed download runner，不新增 Rust/Tauri 后端入口。

验证结果：

- `npm run test:frontend -- src/features/sftp/SftpTransferWorkbench.test.tsx src/features/sftp/sftp-tool-content/useSftpTransferActions.test.ts src/features/sftp/LocalTransferPane.test.tsx`：3 个测试文件、25 个测试通过。
- `npm run test:frontend -- src/features/sftp`：44 个测试文件、283 个测试通过。
- `npm run typecheck`：通过。
- `npm run check:source-size`：通过，636 files，over-limit=0，warning=40。
- `npm run build`：通过；仅保留既有 Vite large chunk warning。
- `npm run dev -- --host 127.0.0.1 --port 1476 --strictPort` 后 HTTP smoke 返回 200，并已按 1476 监听端口停止临时 Vite 进程。
- `git diff --check -- src/features/sftp/SftpTransferWorkbench.test.tsx .updeng/docs/verification/source-size.json`：通过，仅有 Windows LF/CRLF 归一化提示。

本轮未跑：

- `npm run tauri:dev` 未执行；本轮只新增 React/Vitest 回归测试和计划记录，未修改 Rust、Tauri command、窗口、权限或 capability。

同步记录：

- 写入 `src/features/sftp/**` 前已同步 `lane-code-quality` active plan、最新 checkpoint、coordination status 和当前 shared diff；本轮只改测试，不重排/格式化 shared production files。
- checkpoint 路径待刷新：`.updeng/docs/coordination/checkpoints/lane-sftp-transfer-workbench-production.json`。

### 2026-06-22T00:25:57+08:00 P3 右侧远端传到左侧本机闭环

本轮使用一个只读 subagent 复核 P3 实施路径，主线程完成代码集成、测试、构建和文档收口。subagent 结论是：P3 应复用现有 managed download 队列，不新增后端；远端拖到左侧本机需要跨 pane payload 和 host/entry 元数据，归 P6 统一做。

已落地代码切片：

- `src/features/sftp/sftp-tool-content/types.ts` 将 `SftpTransferTarget` 从 remote-only 扩展为 `remote | local` union；remote target 显式携带 `kind: "remote"`，local target 携带 `localPath` 和 `side`。
- `src/features/sftp/LocalTransferPane.tsx` 向父级上报左侧当前本机目录路径。
- `src/features/sftp/SftpTransferWorkbench.tsx` 根据左侧本机路径生成 `{ kind: "local"; side: "left" }` target，并传给右侧 `SftpToolContent`；右侧工作台模式下显示 `传到左侧`，不再显示会打开 picker 的普通下载入口。
- `src/features/sftp/sftp-tool-content/useSftpTransferActions.ts` 按 target kind 分流：local target 走 `buildBatchDownloadTransferPlan` + managed transfer runner；remote target 继续走 remote-copy runner。
- `src/features/sftp/sftp-tool-content/SftpContextMenu.tsx`、`sftpContextMenuModel.ts`、`sftpContextMenuActionModel.ts`、`useSftpContextMenuActions.ts` 新增传输面板专属 `transferToTarget` 右键动作，并保持普通 SFTP 浏览器下载 picker 语义不变。
- 相关测试补齐 local target、remote target union、右键菜单模型、右键动作执行和 Workbench props 断言。

验证结果：

- `npm run test:frontend -- src/features/sftp/SftpTransferWorkbench.test.tsx src/features/sftp/sftp-tool-content/useSftpTransferActions.test.ts src/features/sftp/sftp-tool-content/sftpRemoteTransferModel.test.ts src/features/sftp/sftp-tool-content/sftpContextMenuModel.test.ts src/features/sftp/sftp-tool-content/sftpContextMenuActionModel.test.ts src/features/sftp/sftp-tool-content/useSftpContextMenuActions.test.ts`：6 个测试文件、51 个测试通过。
- `npm run typecheck`：通过。
- `npm run test:frontend -- src/features/sftp`：44 个测试文件、282 个测试通过。
- `npm run check:source-size`：通过；637 个文件，0 个超过 1000 行硬限制，40 个 warning。
- `npm run build`：通过；仅保留既有 Vite chunk size warning。
- `npm run dev -- --host 127.0.0.1 --port 1492 --strictPort` 后 HTTP smoke `GET http://127.0.0.1:1492/` 返回 200，并已停止临时 dev server。
- lane checkpoint 已生成：`.updeng/docs/coordination/checkpoints/lane-sftp-transfer-workbench-production.json`。

未覆盖和后续边界：

- 本轮只改 React/TypeScript 前端路径，未改 Rust/Tauri command、权限、窗口或 capabilities，因此未运行 `npm run tauri:dev`。
- 远端拖拽到左侧本机尚未实现，归 P6；原因是现有 remote drag payload 仍在右侧 hook 内部流转，左侧 pane 还拿不到完整 host/entry 元数据。
- 下载冲突预检、覆盖/重命名/跳过策略仍归 P9；当前 managed download 后端是否覆盖同名本地文件需要后续生产保护切片明确。
- 下载完成后左侧目录自动刷新仍未做；当前只刷新传输队列，左侧目录刷新应等待队列成功事件或 P8 队列生产化统一处理。

### 2026-06-22T00:08:08+08:00 生产完整实施计划文档收口

本轮只做文档，不改生产代码。

补齐内容：

- 在本计划中新增 `生产执行总纲`，明确目标模型层、文件面板层、目标管理层、传输解析层、执行与队列层、生产保护层、恢复与验收层。
- 新增 `当前基线`，记录第一批已完成的本地面板、resolver、队列展示和验证结果，避免后续 agent 重复做已完成切片。
- 新增 `生产实施包`，把完整生产版拆成 P0 到 P10，可直接分派给 agent，并写清主要模块、完成标准和验证方式。
- 新增 `下一轮优先级`，明确下一步优先做右侧远端传到左侧本机当前目录，原因是它能把工作台从单向上传升级为最小真实双栏。
- 新增 `分派规则` 和 `生产完成定义`，约束后续实现必须经过 resolver/action model，不能混用主机资产菜单和文件面板菜单，不能静默覆盖，不能误导跨主机传输方式。

资料和截图吸收：

- 复核用户提供的三张截图：本机菜单、远端菜单和双文件面板整体布局。
- 使用官方资料抽象 WinSCP Commander、FileZilla 本地/远端/队列、Cyberduck 拖放/队列、Termius 多连接/Transfers 的共性，但不复制对方视觉皮肤。
- 本计划的产品判断是：Kerminal 学习成熟 SFTP 工具的交互密度和任务模型，但保留终端上下文、主机资产、安全提示和本机桥接边界。

验证：

- 文档结构检查：计划已包含背景、截图学习、竞品调研、目标、非目标、UX 原则、产品形态、菜单域、工具栏、拖拽、传输模型、后端契约、持久化、生产执行总纲、实施包、切片、详细要求、验收、风险、实施顺序和 Round Log。
- 本轮未运行代码测试；没有修改代码、配置、Rust/Tauri 后端或前端构建产物。

### 2026-06-21T23:59:47+08:00 第一批可收口切片

协作方式：

- 使用一个只读 subagent 审计当前 SFTP 传输台缺口，结论是本地面板仍是主要断点：缺右键、选择、拖拽和传输入队；菜单域整体没有被强行混用，但需要持续分层。
- 使用一个 resolver worker 实现 `TransferIntent` / endpoint 纯模型和测试；主线程复核后接入当前本地面板上传路径。
- 主线程负责 lane 同步、最小集成、类型边界修复、验证和本计划记录。
- 已生成 lane checkpoint：`.updeng/docs/coordination/checkpoints/lane-sftp-transfer-workbench-production.json`。

已落地代码切片：

- `src/features/sftp/LocalTransferPane.tsx` 从占位预览升级为可加载本地目录的操作面板，支持本地路径输入、选择目录、刷新、上级目录、系统打开、行选择、Ctrl/Meta 多选、右键菜单、复制路径、行拖拽 payload，以及 `传输到右侧` 上传入队。
- `src/features/sftp/LocalTransferPane.test.tsx` 覆盖本地目录加载、右键上传入队和拖拽 payload。
- `src/features/sftp/sftpTransferResolver.ts` / `sftpTransferResolver.test.ts` 建立 local/remote endpoint 与 transfer intent resolver，覆盖 local -> remote、remote -> local、remote -> remote、本机复制等基础解析和无效目标边界。
- `src/features/sftp/SftpTransferWorkbench.tsx` 接入新的 `LocalTransferPane`，本机上传后刷新队列，并在队列中显示传输方式。
- `src/features/sftp/sftpTransferModel.ts` 增加传输方式标签、取消/清理可用性和 archive phase 显示兼容。

本轮修正：

- `resolveTransferIntent` 的 entry kind 模型保留 `symlink`，但当前 `enqueueSftpTransfer` 只接受 `file | directory`。本轮在 `LocalTransferPane` 入队边界新增显式收窄，避免宽模型泄漏到 managed transfer 后端契约。

验证结果：

- `npm run test:frontend -- src/features/sftp/LocalTransferPane.test.tsx src/features/sftp/SftpTransferWorkbench.test.tsx src/features/sftp/sftpTransferResolver.test.ts src/features/sftp/sftpTransferModel.test.ts`：4 个测试文件、39 个测试通过。
- `npm run typecheck`：通过。
- `npm run test:frontend -- src/features/sftp`：44 个测试文件、280 个测试通过。
- `npm run build`：通过，耗时约 2m50s；仅保留既有 Vite chunk size warning。
- `npm run dev -- --host 127.0.0.1 --port 1491 --strictPort` 后 HTTP smoke `GET http://127.0.0.1:1491/` 返回 200，并已停止临时 dev server。

本轮未跑：

- `npm run tauri:dev` 未执行；本轮只改 React/TypeScript 前端与前端测试，没有修改 Rust、Tauri command、窗口、权限或 capability。后续进入本地文件写操作、传输后端、窗口弹出或权限切片时必须补桌面 smoke。
- 未做真实 SSH 主机端到端上传；本轮只完成前端入队链路和模型/组件测试。

剩余生产版缺口：

- 左右两侧任意本机/SSH tab、工作台内新增 SSH 主机入口仍未完成。
- 本地面板新建、重命名、删除、本机到本机复制仍未接后端。
- 远端到本机、远端到远端、同主机目录复制的 UI 入口和拖拽闭环仍需继续接 resolver。
- 冲突预检、覆盖/自动重命名/跳过、生产主机增强确认仍未完成。
- 队列的速度、ETA、失败重试和完整源/目标结构化展示仍需继续补齐。
- 真实浅色、深色、跟随系统截图和真实 SSH smoke 仍是最终验收门禁。

### 2026-06-22T10:34:06+08:00 P6 本机 Ctrl+C 内部剪贴板切片

本轮采用两个只读 subagent 并行复核：一个复核 P6 内部 clipboard 最小模型和接线入口，一个复核 `useSftpTransferActions.test.ts` 继续膨胀风险。结论是本轮只做 workbench 内部 clipboard 的本机 Ctrl+C 写入，不迁移远端 Ctrl+V 执行层，避免打破既有远端复制/粘贴链路。

已落地代码切片：

- 新增 `src/features/sftp/sftpTransferClipboardModel.ts` / `sftpTransferClipboardModel.test.ts`，建立 `SftpWorkbenchClipboard` union：本机 clipboard 保存 `sourcePath + entries + copiedAt`，远端 clipboard 用 wrapper 兼容既有 `SftpClipboard`。
- `src/features/sftp/LocalTransferPane.tsx` 新增 `onLocalClipboardChange`，本机文件/目录选中后按 Ctrl/Meta+C 会写入 workbench clipboard；焦点在路径输入框时不拦截系统复制。
- `src/features/sftp/SftpTransferWorkbench.tsx` 将共享 clipboard 状态升级为 workbench 内部 union，传给远端 pane 时解包为旧 `SftpClipboard | null`，远端 Ctrl+C 继续通过 wrapper 回写，左侧本机 pane 可写入 local clipboard。
- `src/features/sftp/LocalTransferPane.test.tsx` 补充本机 Ctrl+C 写入 clipboard 和路径输入框不拦截回归。

验证结果：

- `npm run test:frontend -- src/features/sftp/sftpTransferClipboardModel.test.ts src/features/sftp/LocalTransferPane.test.tsx src/features/sftp/SftpTransferWorkbench.test.tsx`：3 个测试文件、31 个测试通过。
- `npm run typecheck`：通过。
- `npm run test:frontend -- src/features/sftp`：47 个测试文件、324 个测试通过。
- `npm run check:source-size`：通过；670 个文件，0 个超过 1000 行硬限制，46 个 warning；`SftpTransferWorkbench.tsx` 当前 996 行，后续 P6/P7 不应继续堆逻辑。
- `npm run build`：通过；仅保留既有 Vite large chunk warning。
- `npm run dev -- --host 127.0.0.1 --port 1497` 后 HTTP smoke `GET http://127.0.0.1:1497/` 返回 200，并已停止临时 dev server；端口 1497 无残留监听。

未覆盖和后续边界：

- 本轮没有实现 Ctrl+V 执行、local -> local copy/drop 执行、统一 cannot-drop reason model 或拖拽视觉增强，这些仍属于 P6 剩余范围。
- 本轮未运行 `npm run tauri:dev`；只修改 React/TypeScript 前端、前端测试和计划文档，未修改 Rust、Tauri command、窗口、权限或 capability。

### 2026-06-22T10:43:15+08:00 P6 本机 clipboard -> 远端 Ctrl+V 上传切片

本轮继续采用两个只读 subagent 并行复核 P6 Ctrl+V：一个审计执行层，明确生产版 local clipboard -> remote paste 应落在远端 `useSftpTransferActions.pasteSftpClipboard`，不能只在 workbench 顶层捕获键盘；另一个审计测试落点，建议后续新增 `useSftpTransferActions.clipboard.test.ts` / `SftpTransferWorkbench.clipboard.test.tsx`，避免继续膨胀 991 行的 `useSftpTransferActions.test.ts`。

已落地代码切片：

- `src/features/sftp/sftpTransferClipboardModel.ts` 新增 `buildSftpWorkbenchClipboardPastePlan`，把 workbench local clipboard + remote target 解析为 `requestedBy: "paste"` 的 resolver transfer plan，并对空剪贴板/不支持目标返回状态。
- `src/features/sftp/SftpTransferWorkbench.tsx` 保留 union clipboard，不再在顶层把 clipboard 缩成 remote-only；远端 body 渲染时同时传旧 `sftpClipboard` 和新的 `workbenchClipboard`，文件行数仍控制在 1000 行硬限制内。
- `src/features/sftp/SftpToolContent.tsx` / `src/features/sftp/sftp-tool-content/useSftpTransferActions.ts` 接收 `workbenchClipboard`；当 clipboard 为 local 时，远端 Ctrl+V / 粘贴动作通过 resolver plan 转成 `runTransferTask` 上传任务，remote clipboard 和系统剪贴板 fallback 保持原语义。
- `src/features/sftp/LocalTransferPane.tsx` 同步支持本机面板内 Ctrl+C 后 Ctrl+V 上传到右侧目标，复用同一 clipboard paste plan；这不替代远端 pane 语义，只作为本机 pane 的并行闭环。
- `src/features/sftp/sftpTransferClipboardModel.test.ts` 和 `src/features/sftp/LocalTransferPane.test.tsx` 补充 local clipboard paste plan、本机 Ctrl+V 入队上传回归。

验证结果：

- `npm run test:frontend -- src/features/sftp/sftpTransferClipboardModel.test.ts src/features/sftp/LocalTransferPane.test.tsx`：2 个测试文件、14 个测试通过。
- `npm run test:frontend -- src/features/sftp/SftpTransferWorkbench.test.tsx src/features/sftp/SftpToolContent.clipboard.test.tsx`：2 个测试文件、29 个测试通过。
- `npm run test:frontend -- src/features/sftp`：47 个测试文件、327 个测试通过。
- `npm run typecheck`：通过。
- `npm run check:source-size`：通过；670 个文件，0 个超过 1000 行硬限制，46 个 warning；`SftpTransferWorkbench.tsx` 当前 993 行。
- `npm run build`：通过；仅保留既有 Vite large chunk warning。
- `npm run dev -- --host 127.0.0.1 --port 1498` 后 HTTP smoke `GET http://127.0.0.1:1498/` 返回 200，并已停止临时 dev server；端口 1498 无残留监听。

未覆盖和后续边界：

- 尚未新增 hook 专属 `useSftpTransferActions.clipboard.test.ts` 和真实 `SftpTransferWorkbench.clipboard.test.tsx` 集成测试；本轮为了不继续扩大超大测试文件，先用模型、组件和 SFTP 目录回归覆盖。
- P6 仍剩 local -> local copy/drop、统一 cannot-drop reason model 和 drag/drop 视觉状态；P7-P10 仍未完成。
- 本轮未运行 `npm run tauri:dev`；只修改 React/TypeScript 前端、前端测试和计划文档，未修改 Rust、Tauri command、窗口、权限或 capability。

### 2026-06-22T10:53:35+08:00 P6 本机到本机 copy/drop 边界切片

本轮继续采用两个只读 subagent 并行复核 local -> local 能力边界。结论一致：当前仓库没有可复用的本机 copy/move/delete 后端，local -> local 复制属于 P7 本机写操作，不应在 P6 误接 SFTP 上传/下载队列。因此本轮把 P6 的本机到本机语义收成“可识别但不可执行”的前端边界。

已落地代码切片：

- `src/features/sftp/sftpTransferClipboardModel.ts` 对 `local clipboard + local target` 返回专门的 unsupported 状态：`本机到本机复制暂未支持，请先使用系统文件管理器，或等待本机复制后端接入。`；保留 resolver 中的 `localCopy` 解析能力供 P7 复用。
- `src/features/sftp/LocalTransferPane.tsx` 在本机 pane 内 Ctrl+V 且没有远端目标时，把目标解释为当前本机目录并展示 local -> local unsupported，不再泛泛提示“请选择目标目录”，也不会误入上传队列。
- `src/features/sftp/LocalTransferPane.tsx` 拦截本机 drag payload drop 到本机 pane，`dragOver` 设置 `dropEffect = "none"`，drop 时展示同一 unsupported 文案，不入队。
- `src/features/sftp/sftpTransferClipboardModel.test.ts` 和 `src/features/sftp/LocalTransferPane.test.tsx` 补充 local -> local paste/drop 回归。

验证结果：

- `npm run test:frontend -- src/features/sftp/sftpTransferClipboardModel.test.ts src/features/sftp/LocalTransferPane.test.tsx`：2 个测试文件、17 个测试通过。
- `npm run test:frontend -- src/features/sftp/LocalTransferPane.test.tsx`：单文件复跑 11 个测试通过；用于确认首次 SFTP 全目录回归中的右键菜单时序失败是瞬时问题。
- `npm run test:frontend -- src/features/sftp`：首次 47 个文件中 `LocalTransferPane` 右键菜单查询出现一次瞬时失败；复跑后 47 个测试文件、330 个测试通过。
- `npm run typecheck`：通过。
- `npm run check:source-size`：未通过，原因是当前工作区已有非本轮 SFTP 文件超过 1000 行：`src-tauri/tests/ai_agent_service.rs` 1009 行、`src/features/tool-panel/AiToolContent.tsx` 1001 行；本轮 touched 文件均未超限，`LocalTransferPane.tsx` 957 行、`sftpTransferClipboardModel.ts` 191 行、`LocalTransferPane.test.tsx` 441 行、`sftpTransferClipboardModel.test.ts` 199 行。
- `npm run build`：通过；仅保留既有 Vite large chunk warning。
- `npm run dev -- --host 127.0.0.1 --port 1499` 后 HTTP smoke `GET http://127.0.0.1:1499/` 返回 200，并已停止临时 dev server；端口 1499 无残留监听。

未覆盖和后续边界：

- 本轮没有实现本机 copy/move/delete 后端；它属于 P7 本机写操作，建议用独立 `local_file` 或 `file_dialog` command 边界实现，不复用 SFTP remote copy。
- P6 仍剩统一不能投放 reason model 和更完整的 drag/drop 视觉状态；P7-P10 仍未完成。
- 本轮未运行 `npm run tauri:dev`；只修改 React/TypeScript 前端、前端测试和计划文档，未修改 Rust、Tauri command、窗口、权限或 capability。

### 2026-06-22T11:01:45+08:00 P6 统一 cannot-drop reason 和拖拽拒绝视觉切片

本轮采用两个只读 subagent 并行复核：一个审计 cannot-drop reason 的模型边界，建议新建独立 `sftpDropReasonModel` 避免把业务文案塞进 DOM 工具或本地上传模型；另一个审计 drag/drop 视觉状态，建议只做最小可见反馈，不重构 workbench 或 row 级拖拽。

已落地代码切片：

- 新增 `src/features/sftp/sftp-tool-content/sftpDropReasonModel.ts` / `sftpDropReasonModel.test.ts`，集中定义本机文件拖到非 SSH 远端、本机文件拖回本机 pane 的拒绝原因和 `SftpStatus`。
- `src/features/sftp/sftp-tool-content/sftpLocalUploadDropModel.ts` 新增 `resolveSftpLocalPaneDropTarget`，把本机 pane 的 remote payload 下载 hover、local payload reject hover/drop 变成纯模型决策。
- `src/features/sftp/LocalTransferPane.tsx` 复用本机 pane drop decision；远端 payload hover 继续使用 sky ring，local payload 拖回本机 pane 时显示 rose ring，drop 后展示统一 cannot-drop reason。
- `src/features/sftp/sftp-tool-content/useSftpTransferActions.ts` 复用 `sftpCannotDropStatus("localFileRequiresSshRemoteTarget")`，去掉非 SSH 远端目标拒绝原因的散落硬编码。
- `src/features/sftp/sftpTransferClipboardModel.ts` 复用同一 local -> local unsupported 文案常量，P7 接本机 copy 后端时只需要替换统一语义源。
- `src/features/sftp/sftp-tool-content/sftpLocalUploadDropModel.test.ts` 和 `LocalTransferPane.test.tsx` 补充本机 pane drop decision、reject hover rose ring 回归。

验证结果：

- `npm run test:frontend -- src/features/sftp/sftp-tool-content/sftpDropReasonModel.test.ts src/features/sftp/sftp-tool-content/sftpLocalUploadDropModel.test.ts src/features/sftp/LocalTransferPane.test.tsx`：3 个测试文件、18 个测试通过。
- `npm run typecheck`：通过。
- `npm run test:frontend -- src/features/sftp`：48 个测试文件、332 个测试通过。
- `npm run check:source-size`：通过；672 个文件，0 个超过 1000 行硬限制，47 个 warning；`LocalTransferPane.tsx` 当前 996 行，后续必须先抽取再继续加逻辑。
- `npm run build`：通过；仅保留既有 Vite large chunk warning。
- `npm run dev -- --host 127.0.0.1 --port 1500` 后 HTTP smoke `GET http://127.0.0.1:1500/` 返回 200，并已停止临时 dev server；端口 1500 无残留监听。

未覆盖和后续边界：

- 本轮只完成本机 pane 的拒绝 hover 视觉；远端 row dragging 视觉、本地 row dragging 视觉未做，原因是它们不影响 P6 的不能投放解释闭环，且 `LocalTransferPane.tsx` 已接近 1000 行。
- 本轮未运行 `npm run tauri:dev`；只修改 React/TypeScript 前端、前端测试和计划文档，未修改 Rust、Tauri command、窗口、权限或 capability。

### 2026-06-22T11:12:16+08:00 P7 前置 LocalTransferPane 行组件抽取

本轮按“继续采用 subagent 并行完成 SFTP 传输工作台生产级完整实现计划”推进，但不直接进入 P7 本机写操作。原因是 `LocalTransferPane.tsx` 已接近 1000 行硬限制，继续加本机写操作会先撞 source-size 门禁。本轮先完成一个前置结构切片，为 P7 留出可维护空间。

协作方式：

- 只读 explorer `Sartre` 复核 `LocalTransferPane.tsx` 抽取边界，结论是将 `LocalDirectoryEntryRow` 与行级 helper 抽到同级 `LocalDirectoryEntryRow.tsx`，并导出 `isTransferableLocalEntry` 给父组件复用。
- 只读 explorer `Cicero` 复核 P7 后端入口，结论是后续本机新建、重命名、删除和 local -> local copy 更适合新增独立 `local_files` command 域，不应混入远端 `SftpService`；Rust 层需要 path/name 校验、拒绝 symlink/root/self-copy，并按项目规则补 Tauri smoke。

已落地代码切片：

- 新增 `src/features/sftp/LocalDirectoryEntryRow.tsx`，承接本机目录行渲染、图标/类型/大小/修改时间 helper 和本机文件拖拽 payload 构建。
- `src/features/sftp/LocalTransferPane.tsx` 改为导入 `LocalDirectoryEntryRow` 与 `isTransferableLocalEntry`，父组件只保留 pane 级状态、菜单、传输、剪贴板和 drag/drop 决策；文件行数从 996 降到 870。
- `src/features/sftp/LocalTransferPane.test.tsx` 新增目录行双击进入目录、symlink 行不可拖拽两条回归，锁住抽取后的行为边界。

验证结果：

- `npm run test:frontend -- src/features/sftp/LocalTransferPane.test.tsx src/features/sftp/sftp-tool-content/sftpLocalUploadDropModel.test.ts`：2 个测试文件、19 个测试通过。
- `npm run test:frontend -- src/features/sftp`：48 个测试文件、334 个测试通过。
- `npm run typecheck`：通过。
- `npm run check:source-size`：通过；673 个文件，0 个超过 1000 行硬限制，47 个 warning。
- `npm run build`：通过；仅保留既有 Vite large chunk warning。
- `npm run dev -- --host 127.0.0.1 --port 1501 --strictPort` 后 HTTP smoke `GET http://127.0.0.1:1501/` 返回 200，并已停止临时 dev server；端口 1501 无残留监听。

未覆盖和后续边界：

- 本轮只改 React/TypeScript 前端和测试，没有修改 Rust、Tauri command、窗口、权限或 capability，因此未运行 `npm run tauri:dev`。
- P7 仍未实现；下一步应新增本机写操作后端契约和前端接入，优先避免把本机文件写操作混入 SFTP remote service。
- P8/P9/P10 仍需继续推进队列生产化、冲突预检/生产保护、持久化、真实 SSH 和主题最终验收。

### 2026-06-22T11:26:36+08:00 P7 本机到本机复制最小闭环

本轮继续按 subagent 并行推进 P7，但只收一个低风险子切片：把 P6 中“本机到本机复制暂未支持”的 clipboard/drop 边界替换为实际本机 copy 后端。新建、重命名、删除仍属于 P7 后续子切片，因为它们需要更完整的 root scope、确认和破坏性操作保护。

协作方式：

- 只读 explorer `Bernoulli` 复核 Rust 本机写操作安全边界，强调后续 rename/delete 必须补 rootPath、root/canonical/symlink/Windows 保留名边界；本轮据此保持 local copy fail-if-exists，不做覆盖或删除。
- 只读 explorer `Dirac` 复核前端接线，确认 local -> local 当前卡在 `buildSftpWorkbenchClipboardPastePlan` unsupported 分支和 `resolveSftpLocalPaneDropTarget` reject 分支；本轮只在 `LocalTransferPane` 小分支接入本机 copy，避免继续膨胀其它大文件。

已落地代码切片：

- 新增 `src-tauri/src/commands/local_files.rs`，提供 `local_files_create_directory` 和 `local_files_copy_path` 两个 Tauri command；copy 默认不覆盖目标，拒绝 symlink、类型不匹配、目录复制到自身或子目录，并返回目标目录 `LocalDirectoryListing`。
- `src-tauri/src/commands/file_dialog.rs` 将 `read_local_directory` 暴露为 `pub(crate)` 供 local files command 复用；`src-tauri/src/commands/mod.rs` 和 `src-tauri/src/commands/registry.rs` 只做最小 module/handler 注册。`commands/mod.rs`/`registry.rs` 是共享热点，本轮没有重排 registry。
- 新增 `src/lib/localFilesApi.ts` / `localFilesApi.test.ts`，封装 `copyLocalPath` 和 `createLocalDirectory`，非 Tauri 环境明确报错。
- `src/features/sftp/sftp-tool-content/sftpLocalUploadDropModel.ts` 将本机 payload 拖回本机 pane 的决策从 reject 改成 `copy-hover` / `copy`。
- `src/features/sftp/LocalTransferPane.tsx` 在无远端目标的本机 Ctrl+V 和本机 payload drop 场景调用 `copyLocalPath`，复制后刷新当前本机目录，不再进入 SFTP transfer 队列。
- `LocalTransferPane.test.tsx`、`sftpLocalUploadDropModel.test.ts` 补齐 local -> local paste/drop 成功路径。

验证结果：

- `cargo test local_files --lib`：5 个 Rust 单测通过。
- `cargo check`：通过，覆盖非 test command 注册路径。
- `rustfmt --edition 2021 --check src/commands/local_files.rs src/commands/mod.rs src/commands/registry.rs src/commands/file_dialog.rs`：通过；全 crate `cargo fmt --check` 未作为完成口径，因为其它 active lane 的 Rust 文件当前存在未归因格式化差异。
- `npm run test:frontend -- src/lib/localFilesApi.test.ts src/features/sftp/LocalTransferPane.test.tsx src/features/sftp/sftp-tool-content/sftpLocalUploadDropModel.test.ts`：3 个测试文件、22 个测试通过。
- `npm run test:frontend -- src/features/sftp src/lib/localFilesApi.test.ts`：49 个测试文件、337 个测试通过。
- `npm run typecheck`：通过。
- `npm run check:source-size`：通过；679 个文件，0 个超过 1000 行硬限制，47 个 warning。
- `npm run build`：通过；仅保留既有 Vite large chunk warning。
- `npm run dev -- --host 127.0.0.1 --port 1502 --strictPort` 后 HTTP smoke 返回 200，并已停止临时 dev server；端口 1502 无残留监听。
- `npm run tauri:dev` 首次被既有 1425 Vite 进程占用阻断；确认该进程是同项目已有 `vite` 后，改用 `cargo run --no-default-features --color always --` 复用现有 devUrl，Tauri debug 壳成功编译并启动到 `target\debug\kerminal.exe`。本轮新启动的 11:25 后两个 debug app 进程已停止，保留 1425 既有 Vite 和 11:21 既有 debug app 进程。

未覆盖和后续边界：

- P7 仍未整体完成：本机新建目录 UI、重命名、删除、危险确认、rootPath scope、Windows 保留名和后续 AI/MCP 审计策略仍待做。
- 本轮 local copy 是 fail-if-exists，未做覆盖、自动重命名、冲突对话框或队列进度；这些应进入 P8/P9。
- 大目录复制仍是 `spawn_blocking` 无进度/取消；生产化队列展示和取消能力仍归 P8。

### 2026-06-22T11:40:30+08:00 P7 本机新建目录 UI 最小闭环

本轮继续按 subagent 并行推进 P7，只收“当前本机目录下新建单层文件夹”的 UI 接线。后端 `local_files_create_directory` 和前端 `createLocalDirectory` 已在上一切片落地，本轮不扩大到重命名、删除、rootPath scope 或危险确认。

协作方式：

- 只读 explorer `Turing` 复核前端接入口，建议把新建目录作为当前目录级动作放到本机面板工具栏和空白菜单，不放入文件/目录行菜单，避免引入“在某个目录行内新建子目录”的目标语义。
- 只读 explorer `Ampere` 复核本机写操作安全边界，确认单层 `create_dir` UI 接线足够收窄；同时明确 rename/delete/rootPath/Windows 保留名/危险确认仍不能算完成。

已落地代码切片：

- `src/features/sftp/LocalTransferPane.tsx` 导入 `FolderPlus` 和 `createLocalDirectory`，新增 `createDirectoryInCurrentDirectory`，通过 prompt 收集名称、trim 后调用 `createLocalDirectory({ parentPath: listing.path, name })`，成功后使用返回的 `LocalDirectoryListing` 更新当前本机面板。
- 本机面板工具栏新增 `新建` 图标按钮；空白/当前目录右键菜单新增 `新建文件夹`；文件/目录行菜单不显示该项，保持本轮只针对当前目录。
- `src/features/sftp/LocalTransferPane.test.tsx` 补充工具栏新建、空白菜单新建、行菜单不出现新建、取消/空名称不调用 API、创建失败显示错误等回归。
- `src/lib/localFilesApi.test.ts` 扩展非 Tauri 环境拒绝断言，覆盖 `createLocalDirectory` 和 `copyLocalPath` 两个本机写 API。

验证结果：

- `cargo test local_files --lib`：5 个 Rust 单测通过。
- `cargo check`：通过。
- `npm run test:frontend -- src/lib/localFilesApi.test.ts src/features/sftp/LocalTransferPane.test.tsx`：2 个测试文件、21 个测试通过；首次空白菜单测试等待点不足失败，已修正为先等待目录 listing 完成后复跑通过。
- `npm run test:frontend -- src/features/sftp src/lib/localFilesApi.test.ts`：49 个测试文件、342 个测试通过。
- `npm run typecheck`：通过。
- `npm run check:source-size`：通过；679 个文件，0 个超过 1000 行硬限制，47 个 warning；`LocalTransferPane.tsx` 当前 969 行，后续 P7 不能继续在该文件堆大逻辑。
- `npm run build`：通过；仅保留既有 Vite chunk size warning。
- `npm run dev -- --host 127.0.0.1 --port 1503 --strictPort` 后 HTTP smoke `GET http://127.0.0.1:1503/` 返回 200，并已按监听端口停止临时 dev server。
- `npm run tauri:dev`：Tauri debug 壳成功启动到 `target\debug\kerminal.exe`，本轮启动的 npm/cargo/app 进程已清理。

未覆盖和后续边界：

- P7 仍未整体完成：本机重命名、删除、rootPath scope、Windows 保留名、危险确认和后续 AI/MCP 审计策略仍待做。
- 本轮继续使用系统 prompt 作为最小 UI 输入；后续若要做完整生产体验，应在拆出本地菜单/动作模型后替换为项目内主题化弹框，并补浅色、深色、跟随系统截图。
- 新建目录没有进入队列，也不做覆盖/自动重命名；目标已存在和非法名称由 Rust command 返回错误，P8/P9 再统一冲突和队列生产化。

### 2026-06-22T11:53:33+08:00 P7 本机重命名最小闭环

本轮继续按 subagent 并行推进 P7，完成本机文件/目录同父目录重命名。该切片只做 rename，不引入 delete，不把 rename 放入传输队列，也不改远端 SFTP rename/chmod/delete 菜单模型。

协作方式：

- 只读 explorer `Mill` 复核 Rust rename 安全契约，建议 `local_files_rename_path` 只允许同父目录改名，默认 fail-if-exists，拒绝 symlink、kind mismatch、路径分隔符、Windows 保留名和 rootPath 越界。
- 只读 explorer `Copernicus` 复核前端接线和 source-size 风险，建议先抽 `LocalTransferPaneContextMenu.tsx`，将 rename 放入 entry 菜单，不放 toolbar 或空白菜单。

已落地代码切片：

- `src-tauri/src/commands/local_files.rs` 新增 `LocalRenamePathRequest` 和 `local_files_rename_path`；重命名只接受 `file` / `directory`，只允许同父目录改名，目标存在直接拒绝，成功后返回父目录 `LocalDirectoryListing`。
- 本机写操作路径校验收紧为 canonicalize 前拒绝 symlink；文件名校验新增 Windows 非法字符、保留名、尾随点/空格拒绝。
- `src-tauri/src/commands/registry.rs` 注册 `local_files_rename_path`，保持共享 registry 最小追加。
- `src/lib/localFilesApi.ts` 新增 `renameLocalPath`；`localFilesApi.test.ts` 覆盖 command 参数和非 Tauri 拒绝。
- 新增 `src/features/sftp/LocalTransferPaneContextMenu.tsx`，抽出本机右键菜单、菜单项和分隔线，让 `LocalTransferPane.tsx` 远离 1000 行硬限制。
- `src/features/sftp/LocalTransferPane.tsx` 新增 `renameLocalEntry`，文件/目录行右键菜单显示 `重命名`，通过 prompt 收集新名称，调用 `renameLocalPath({ path, name, kind, rootPath: listing.path })` 后刷新当前 listing；空白菜单和 symlink 不暴露该动作。
- `LocalTransferPane.test.tsx` 补充文件重命名、目录重命名、空白菜单不显示重命名、取消/空名称不调用 API、失败显示错误等回归。

验证结果：

- `cargo test local_files --lib`：14 个 Rust 单测通过。
- `rustfmt --edition 2021 --check src/commands/local_files.rs src/commands/registry.rs`：首次发现 touched 文件格式差异；已对这两个文件运行 rustfmt 后复查通过。
- `cargo check`：通过。
- `npm run test:frontend -- src/lib/localFilesApi.test.ts src/features/sftp/LocalTransferPane.test.tsx`：2 个测试文件、27 个测试通过。
- `npm run test:frontend -- src/features/sftp src/lib/localFilesApi.test.ts`：49 个测试文件、348 个测试通过。
- `npm run typecheck`：通过。
- `npm run check:source-size`：通过；680 个文件，0 个超过 1000 行硬限制，48 个 warning。
- `npm run build`：通过；仅保留既有 Vite chunk size warning。
- `npm run dev -- --host 127.0.0.1 --port 1504 --strictPort` 后 HTTP smoke `GET http://127.0.0.1:1504/` 返回 200，并已按监听端口停止临时 dev server。
- `npm run tauri:dev`：Tauri debug 壳成功启动到 `target\debug\kerminal.exe`，本轮启动的 npm/cargo/app 进程已清理。

未覆盖和后续边界：

- P7 仍未整体完成：删除审计、更完整 AI/MCP 受控写操作策略、create/copy root scope 统一和完整主题截图仍待做。
- 本轮 rootPath 只接入 rename，并用当前本机 pane 路径限制同目录 entry；create/copy 的 root scope 仍需后续统一收口。
- 本轮 rename 仍使用系统 prompt；完整生产 UI 应在后续替换为主题化弹框，并补浅色、深色、跟随系统截图。
- 覆盖、自动重命名、队列进度、取消和冲突对话框仍归 P8/P9。

### 2026-06-22T12:08:42+08:00 P7 本机删除和危险确认闭环

本轮继续采用 subagent 并行推进 P7，完成本机文件/目录删除的生产级最小闭环。该切片只做本机删除，不接远端 SFTP delete，不把删除放入传输队列；删除作为破坏性本机写操作，前后端都要求明确确认。

协作方式：

- 只读 explorer `Nash` 复核 Rust 删除契约，建议新增独立 `local_files_delete_path`，复用 `existing_path` 的 canonicalize 前 symlink 拒绝，限制 `file` / `directory`，拒绝 root/rootPath 本身、kind mismatch、rootPath 越界，目录删除必须显式 recursive。
- 只读 explorer `Ramanujan` 复核前端交互和测试边界，建议删除入口只出现在 file/directory entry 菜单，空白菜单和 symlink 不显示，危险操作使用主题化确认弹框而不是静默执行。

已落地代码切片：

- `src-tauri/src/commands/local_files.rs` 新增 `LocalDeletePathRequest` 和 `local_files_delete_path`；删除要求 `confirmName` 精确等于源条目名，目录要求 `recursive=true`，拒绝 symlink、kind mismatch、rootPath 本身、rootPath 外部路径和文件系统根路径，成功后返回父目录 `LocalDirectoryListing`。
- `src-tauri/src/commands/registry.rs` 注册 `local_files_delete_path`，保持 Tauri command 单点 registry 最小追加。
- `src/lib/localFilesApi.ts` 新增 `deleteLocalPath`；`localFilesApi.test.ts` 覆盖 command 参数和非 Tauri 拒绝。
- 新增 `src/features/sftp/LocalDeleteConfirmDialog.tsx`，复用 `ModalShell` 和 danger 按钮，要求输入条目名后才允许 `确认删除`；目录删除展示递归删除提示，弹层使用项目主题变量和 dark 样式。
- `src/features/sftp/LocalTransferPaneContextMenu.tsx` 在 file/directory entry 菜单加入 `删除`，空白菜单和 symlink 不暴露该动作。
- `src/features/sftp/LocalTransferPane.tsx` 接入 `deleteLocalPath({ path, kind, rootPath: listing.path, confirmName, recursive })`，删除成功后刷新本机 listing 并清空选择。
- `LocalTransferPane.test.tsx` 补充文件删除、目录递归删除、取消不调用 API、确认名不匹配禁用、空白菜单/symlink 不显示删除、失败显示错误等回归。

验证结果：

- `cargo test local_files --lib`：21 个 Rust 单测通过。
- `rustfmt --edition 2021 src/commands/local_files.rs src/commands/registry.rs`：已格式化 touched Rust 文件。
- `rustfmt --edition 2021 --check src/commands/local_files.rs src/commands/registry.rs`：通过。
- `cargo check`：通过。
- `npm run test:frontend -- src/lib/localFilesApi.test.ts src/features/sftp/LocalTransferPane.test.tsx`：2 个测试文件、34 个测试通过。
- `npm run test:frontend -- src/features/sftp src/lib/localFilesApi.test.ts`：49 个测试文件、355 个测试通过。
- `npm run typecheck`：通过。
- `npm run check:source-size`：通过；681 个文件，0 个超过 1000 行硬限制，49 个 warning；`LocalTransferPane.test.tsx` 已从首轮 1024 行压回 989 行。
- `npm run build`：通过；仅保留既有 Vite chunk size warning。
- `npm run dev -- --host 127.0.0.1 --port 1506 --strictPort` 后 HTTP smoke `GET http://127.0.0.1:1506/` 返回 200，并已按监听端口停止临时 dev server。
- `npm run tauri:dev`：Tauri debug 壳成功启动到 `target\debug\kerminal.exe`，本轮启动的 npm/cargo/app 进程已清理；复查无 `kerminal.exe`、1425 或 1506 监听残留。

未覆盖和后续边界：

- P7 仍未完全归档：本机删除审计、更完整 AI/MCP 受控写操作策略、create/copy root scope 统一和浅色/深色/跟随系统截图仍需后续收口。
- 本轮删除不进入传输队列，不提供撤销；覆盖、自动重命名、队列进度、取消和冲突对话框仍归 P8/P9。
- 本轮只做单 entry 删除；多选批量本机删除、删除审计事件和 AI/MCP 可控删除需要后续单独切片。

### 2026-06-22T12:27:58+08:00 P7 create/copy rootPath scope 统一

本轮接续被重启打断的 P7 子切片，收口本机新建目录和本机复制的 root scope 语义。目标是让所有已落地的本机写操作都具备清晰的受控根目录边界，同时保留“从其它本机目录复制到当前 pane”的传输工作台语义。

协作方式：

- 复用前序只读 subagent `Huygens` 的 Rust 契约审计：`create` 应约束 parent/target 都在 root 内；`copy` 至少约束 target side，source 是否约束由产品语义决定。
- 复用前序只读 subagent `Goodall` 的前端契约审计：`createLocalDirectory` 和 `copyLocalPath` 的 TS request 都应带 `rootPath?: string`；前端调用应使用当前目标 pane/listing 路径作为 root scope，而不是 clipboard source path。
- 本轮继续请求 `Goodall` 只读复核右键菜单测试 flake；由于 subagent 并发额度已满，复用已有 agent。结论是保留 async helper 等待 `role=menu`，避免裸 `fireEvent.contextMenu` 在全量回归中偶发找不到 portal menu。

已落地代码切片：

- `src-tauri/src/commands/local_files.rs` 为 `LocalCreateDirectoryRequest` 和 `LocalCopyPathRequest` 增加 `root_path: Option<String>`；新建目录约束 `parent` 和 `target` 均在 root 内；复制约束 `target_directory` 和最终 `target` 在 root 内。
- 明确 copy 语义：source 不受当前 pane rootPath 限制，允许把其它本机目录中的文件复制/导入到当前本机 pane；target side 仍受 rootPath 限制，防止写出当前受控根。
- Rust 单测补充 `create_directory_rejects_parent_outside_root_path`、`copy_path_allows_source_outside_root_when_target_is_inside_root` 和 `copy_path_rejects_target_outside_root_path`。
- `src/lib/localFilesApi.ts` 为 `LocalCreateDirectoryRequest` / `LocalCopyPathRequest` 暴露 `rootPath?: string`，`localFilesApi.test.ts` 覆盖 invoke 参数透传和非 Tauri 拒绝路径。
- `src/features/sftp/LocalTransferPane.tsx` 在新建目录和本机 copy 调用中传入当前目标 listing 路径作为 `rootPath`。
- `src/features/sftp/LocalTransferPane.test.tsx` 更新 create/copy 断言，并将右键菜单测试统一收敛到 `openLocalContextMenu` helper；helper 使用 `waitFor` 触发并等待 `role="menu" name="本地文件操作菜单"`，修复组合回归中偶发找不到 `重命名` / `删除` menuitem 的 flake，同时保持文件在 source-size 硬限制以下。

验证结果：

- `cargo test local_files --lib`：24 个 Rust 单测通过。
- `rustfmt --edition 2021 --check src/commands/local_files.rs src/commands/registry.rs`：通过。
- `cargo check`：通过。
- `npm run test:frontend -- src/features/sftp/LocalTransferPane.test.tsx`：29 个测试通过。
- `npm run test:frontend -- src/lib/localFilesApi.test.ts`：5 个测试通过。
- `npm run test:frontend -- src/lib/localFilesApi.test.ts src/features/sftp/LocalTransferPane.test.tsx`：2 个测试文件、34 个测试通过；首次组合复跑暴露右键菜单 flake，已通过 helper 重试等待修复后复跑通过。
- `npm run test:frontend -- src/features/sftp src/lib/localFilesApi.test.ts`：49 个测试文件、355 个测试通过。
- `npm run typecheck`：通过。
- `npm run check:source-size`：通过；681 个文件，0 个超过 1000 行硬限制，49 个 warning；`LocalTransferPane.test.tsx` 当前 998 行，后续必须拆分测试文件或继续抽 helper，不能再直接堆行。
- `npm run build`：通过；仅保留既有 Vite large chunk warning。
- `npm run dev -- --host 127.0.0.1 --port 1507 --strictPort` 后 HTTP smoke `GET http://127.0.0.1:1507/` 返回 200；首次 `Start-Process npm` 因 Windows 不能直接执行 shim 报 `%1 不是有效的 Win32 应用程序`，已改用 `npm.cmd` 并清理 1507 监听。
- `npm run tauri:dev`：首次 smoke 脚本因 PowerShell 函数参数 `$pid` 与只读变量冲突导致清理逻辑报错，日志显示已编译并执行 `target\debug\kerminal.exe` 但进程很快退出；修正参数名后复跑，观察到新 `kerminal.exe` 存活超过 3 秒，并已清理本轮新增进程。

未覆盖和后续边界：

- P7 仍未完全归档：更完整 AI/MCP 受控写操作策略和浅色/深色/跟随系统主题截图仍需后续收口。
- `LocalTransferPane.test.tsx` 仍非常接近 1000 行；后续菜单、主题或本机批量操作测试应拆到新的专门测试文件，不能继续在该文件上追加大段用例。
- 覆盖、自动重命名、队列进度、取消、冲突对话框和生产保护仍归 P8/P9/P10。

### 2026-06-22T12:53:30+08:00 P7 本机删除审计持久化

本轮接续被重启打断的 P7 子切片，收口本机删除操作的最小持久化审计。结论是本机 UI 删除不写入 `ai_tool_audits`，避免污染 AI/MCP 工具审计语义；改为独立的 `local_file_operation_audits` 表，当前先记录 `delete` 操作。

协作方式：

- 复用只读 subagent `Huygens` 的审计边界建议：不要把普通 UI 删除写进 AI/MCP audit；后端应尽量记录 success/failed/rejected。
- 复用只读 subagent `Goodall` 的前端边界建议：不新增删除确认 UI 字段，不改 `LocalDeleteConfirmDialog` 和 TS request；审计作为后端 side effect。

已落地代码切片：

- 新增 `src-tauri/src/storage/local_file_operations.rs`，提供 `LocalFileOperationAuditWrite` / `LocalFileOperationAuditRecord` 以及插入、查询接口。
- SQLite schema 升级到 v26，新增 `local_file_operation_audits` 表和 created/status 相关索引。
- `local_files_delete_path` 接入 `AppState` storage：删除完成或失败后写入 operation/path/kind/rootPath/parentPath/recursive/confirmationMatched/status/error/createdAt。
- 审计写入失败时不静默吞掉：删除成功但审计失败会返回“删除已完成但审计写入失败”，删除失败且审计也失败时返回原始删除错误并附带审计失败原因。
- 补充 Rust 单测和 storage foundation 测试，覆盖失败确认 helper 与删除审计记录插入/查询。

验证结果：

- `cargo test local_files --lib`：25 个 Rust 单测通过。
- `cargo test local_file_operation_audit_records_delete_success --test storage_foundation`：通过。
- `cargo test --test storage_foundation`：20 个测试通过。
- `rustfmt --edition 2021` touched Rust files：通过。
- `cargo check`：通过。
- `npm run check:source-size`：通过；683 个文件，0 个超过 1000 行硬限制。
- `npm run test:frontend -- src/lib/localFilesApi.test.ts src/features/sftp/LocalTransferPane.test.tsx`：2 个测试文件、34 个测试通过。
- `npm run test:frontend -- src/features/sftp src/lib/localFilesApi.test.ts`：49 个测试文件、355 个测试通过。
- `npm run typecheck`：通过。
- `npm run build`：通过；仅保留既有 Vite large chunk warning。
- `npm run dev -- --host 127.0.0.1 --port 1508 --strictPort` 后 HTTP smoke 返回 200，并已清理临时 dev server。
- `npm run tauri:dev`：Tauri debug 壳成功启动，新 `kerminal.exe` 存活超过 3 秒，并已清理本轮新增进程。

未覆盖和后续边界：

- SFTP 总计划仍未完成；P7 仍剩更完整 AI/MCP 受控写操作策略和浅色/深色/跟随系统主题截图。
- P8/P9/P10 的冲突预检、队列生产化、生产保护和真实 SSH/主题最终验收仍未整体落地。
- `src-tauri/src/commands/local_files.rs` 与 `src-tauri/src/storage/migrations.rs` 已接近 1000 行，后续继续做本机写操作时应优先拆分模块。

### 2026-06-22T13:00:00+08:00 subagent 并行复核和剩余实施矩阵

本轮响应“采用 subagent 并行完成 SFTP 传输工作台生产级完整实现计划”，只做计划复核和分派，不改生产代码。

协作方式：

- 主线程先读取 Updeng 工作流、开发治理、issue planning、lane 台账、active 计划、CodeGraph SFTP 上下文和当前 git 状态；刷新 `.updeng/docs/coordination/status.md`。
- 只读 explorer `Ptolemy` 负责前端工作台缺口，确认 P7 本机能力已基本落地，剩余主题化输入、队列面板、冲突 UI、生产保护 UI、持久化和最终验收。
- 只读 explorer `Halley` 负责 Rust 后端缺口，确认 SFTP 后端已有真实 backend、managed transfer、remote copy 和取消能力，但 P8/P9/P10 仍缺 retry/history、local copy managed queue、统一 preflight、安全写策略、production guard 和 transfer audit。
- 只读 explorer `Hooke` 负责 AI/MCP 策略，确认 SFTP AI 工具已覆盖远端操作和 transfer queue，但本机写 command 当前被 Tool Registry/MCP 契约禁止暴露；开放本机写属于 HITL/ADR，不应作为普通 worker 直接实现。

已更新计划：

- 更新 `下一轮优先级`：P7 主体能力已完成，后续主线切到 P8 队列生产化、P9 冲突/生产保护、P10 持久化和最终验收。
- 新增 `Subagent 并行执行矩阵`，拆出 W1-W9：主题化输入、队列前端、队列后端、冲突预检、安全写策略、冲突/生产保护 UI、transfer history/audit、工作台持久化验收、AI/MCP 本机写策略 ADR。
- 标记 W9 为 HITL：继续保持现有“local file 不暴露给 Tool Registry/MCP”的安全契约，除非后续明确确认 scope、审计和外部 MCP 风险。

未执行验证：

- 本轮只修改 SFTP 计划文档（现已归档到 `.updeng/docs/plan/done/2026-06-20-cross-host-sftp-transfer-workbench.md`），没有修改代码；未运行前端/Rust 测试或启动 smoke。

下一步建议：

- 若继续实现，应优先派 worker 执行 W1/W2/W3/W4；W5 必须等待 W4 的 `conflictPolicy` 契约稳定；W8 必须等待 P8/P9 完成；W9 需要用户确认后再进入实现。

### 2026-06-22T13:45:00+08:00 W1 主题化重命名弹框和 P8/P9 并行侦察

本轮按用户要求采用 subagent 并行推进。由于当前 main 工作区已有大量未归因改动，本轮只让一个 worker 写入小范围前端切片，其余 subagent 做只读侦察，主线程负责复核、修正和验证。

协作方式：

- worker `Bernoulli` 负责 W1：把本机重命名从系统 `prompt` 替换为主题化弹框，写入范围限定在 `src/features/sftp/LocalRenameDialog.tsx`、`src/features/sftp/LocalTransferPane.tsx` 和相关测试。
- explorer `Chandrasekhar` 负责 P8 队列生产化侦察：确认当前已有 scoped list/cancel/clear、poll + Tauri event merge、内存队列和进度事件；缺口是 speed/ETA、retry、durable history/audit、local copy managed queue 和独立队列面板。
- explorer `Hilbert` 负责 P9 冲突预检/生产保护契约：确认远端已有 `sftp_stat_path` 可做 preflight，本机缺 `local_files_stat_path`；当前 backend 文件写入默认可能覆盖，`conflictPolicy` 必须进入 API/Rust request 并在执行层 race-safe enforcement。

已落地代码切片：

- 新增 `src/features/sftp/LocalRenameDialog.tsx`，复用 `ModalShell` 和项目按钮样式，显示本机路径、默认填入当前名称、空名称或未变更名称禁用确认，确认时返回 trim 后的新名称。
- `src/features/sftp/LocalTransferPane.tsx` 删除重命名系统 prompt 路径，行菜单 `重命名` 改为打开 `LocalRenameDialog`，成功后仍复用原 `renameLocalPath({ path, name, kind, rootPath })` 契约并刷新 listing。
- 新增 `src/features/sftp/LocalRenameDialog.test.tsx` 覆盖弹框渲染、取消、空/未变更名称禁用、trim 后确认。
- 调整 `src/features/sftp/LocalTransferPane.test.tsx`，保留 pane 集成测试中的文件/目录重命名、空白菜单不出现重命名、失败展示错误；将纯弹框行为迁出，避免该文件重新超过 1000 行硬限制。

验证结果：

- `npm run test:frontend -- src/features/sftp/LocalTransferPane.test.tsx src/features/sftp/LocalRenameDialog.test.tsx`：2 个测试文件、32 个测试通过。
- `npm run build`：通过；仅保留既有 Vite large chunk warning。
- `npm run dev -- --host 127.0.0.1 --port 1526 --strictPort` 后 HTTP smoke `GET http://127.0.0.1:1526/` 返回 200，并已清理临时 dev server。
- `npm run check:source-size`：仍失败，但本轮 touched 的 `LocalTransferPane.test.tsx` 已降到 988 行；失败来自既有超限文件 `src-tauri/tests/ai_agent_service.rs` 1039 行和 `src/features/terminal/TerminalWorkspace.test.tsx` 1037 行。

未覆盖和后续边界：

- 本轮没有运行 `npm run tauri:dev`，因为只修改前端弹框和测试；真实桌面启动仍需在后续 P8/P9 代码切片或收尾验收中执行。
- P8 下一步建议先新增 `SftpTransferQueuePanel.tsx` / `SftpTransferQueuePanel.test.tsx` / `sftpTransferQueuePanelModel.ts`，再最小替换 `SftpTransferWorkbench.tsx` 内联 `TransferQueue`，避免继续推高 993 行主文件。
- P9 下一步建议先补本机 stat/preflight 和 `conflictPolicy` API/Rust request 透传，再改 `transfer_io.rs` 的覆盖行为；不能只依赖前端冲突弹窗。

### 2026-06-22T13:55:00+08:00 P8 队列面板组件抽取

本轮接续 P8 的低风险前端第一刀：不改后端队列契约，不新增 retry/speed/ETA，只把 `SftpTransferWorkbench.tsx` 内联的底部队列 UI 抽成独立组件，为后续队列生产化留出独立演进面。

已落地代码切片：

- 新增 `src/features/sftp/SftpTransferQueuePanel.tsx`，承载原 `TransferQueue`、`TransferQueueRow`、`QueueIcon` 逻辑，保留 scoped transfers、活动/失败 badge、进度条、历史展开、取消按钮和主题样式。
- `src/features/sftp/SftpTransferWorkbench.tsx` 改为调用 `<SftpTransferQueuePanel />`，删除队列专属图标、`SftpTransferSummary` 类型和内联队列实现。
- 文件体量改善：`SftpTransferWorkbench.tsx` 从 993 行降到 757 行；`SftpTransferQueuePanel.tsx` 为 245 行；`LocalTransferPane.test.tsx` 当前 987 行。

验证结果：

- `npm run test:frontend -- src/features/sftp/SftpTransferWorkbench.test.tsx`：1 个测试文件、20 个测试通过。
- `npm run typecheck`：通过。
- `npm run build`：通过；仅保留既有 Vite large chunk warning。
- `npm run dev -- --host 127.0.0.1 --port 1527 --strictPort` 后 HTTP smoke `GET http://127.0.0.1:1527/` 返回 200，并已清理临时 dev server。
- `npm run check:source-size`：仍失败，但 SFTP touched files 均低于 1000 行；当前失败来自既有 `src/features/terminal/TerminalWorkspace.test.tsx` 1037 行，输出中还出现 `src-tauri/tests/ai_conversation_service.rs` 的历史/边界显示异常，需由对应 lane 单独处理。

未覆盖和后续边界：

- 本轮只是组件边界切分，尚未实现 speed/ETA、retry、durable history/audit 或 local copy managed queue。
- 后续 P8 可在 `SftpTransferQueuePanel.tsx` 或独立 model 中继续演进，不应再把队列细节塞回 `SftpTransferWorkbench.tsx`。

### 2026-06-22T14:16:43+08:00 P8 队列模型抽取、P9 本机 stat 预检基础和启动门禁收口

本轮继续按 subagent 并行方式推进。主线程整合 worker/explorer 结果并负责最终验证；同时处理了两处非 SFTP 的启动门禁阻断，避免把 SFTP 切片交付在不可启动状态上。

协作方式：

- worker `Feynman` 负责 P8 队列面板 model 抽取，将队列展示状态和 action disabled/reason 计算从 React 组件中移出。
- explorer `Planck` 负责 P9 本机 stat/Rust 模块边界复核，建议把 `local_files.rs` 继续拆分，避免后续本机写操作把单文件推回 1000 行附近。
- 主线程实现 P9 本机 stat command、TS API、测试与 command registry 接入，并修复 AI 工具面板类型缺口和 source-size 门禁遗留。

已落地代码切片：

- 新增 `src/features/sftp/sftpTransferQueuePanelModel.ts` 和测试，集中计算队列行状态、取消可用性、进度标签、清理完成任务按钮状态和历史/空态信息。
- `src/features/sftp/SftpTransferQueuePanel.tsx` 改为消费 model 输出，保留 UI 表现和现有 scoped queue 契约，为后续 speed/ETA/retry/history 留出稳定演进点。
- 新增 `src-tauri/src/commands/local_files/stat.rs`，提供 `local_files_stat_path`；返回本机路径是否存在、kind、size、modifiedMs，缺失目标返回 `exists=false`，并通过 root scope 阻止越界探测。
- `src-tauri/src/commands/local_files.rs` 继续瘦身：导出 stat command，并将原内联写操作测试迁到 `src-tauri/src/commands/local_files/local_files_write_tests.rs`。
- `src-tauri/src/commands/registry.rs` 注册 `local_files_stat_path`；`src/lib/localFilesApi.ts` 增加 `statLocalPath` 和 request/response 类型。
- `src/lib/localFilesApi.test.ts` 覆盖 stat invoke 透传和非 Tauri 拒绝路径；本机文件 API 非 Tauri 错误文案从“写操作”调整为更准确的“本机文件操作”。
- 为通过启动门禁，修复 `src/features/tool-panel/AiToolContent.tsx` 对 `AiToolContentHeader` / `AiToolContentComposer` 的缺失 prop，并新增 `src/features/tool-panel/ai-tool-content/AiThreadViewport.tsx` 抽出消息 viewport，使主文件降到 933 行。
- 拆分 `src/features/terminal/TerminalWorkspace.test.tsx` 的批量发送用例到 `src/features/terminal/TerminalWorkspace.broadcast.test.tsx`，并将 `src/features/tool-panel/AiToolContent.test.tsx` 压回 1000 行硬限制内；`npm run check:source-size` 已恢复通过。

验证结果：

- `rustfmt --edition 2021 --check src/commands/local_files.rs src/commands/local_files/stat.rs src/commands/local_files/local_files_write_tests.rs src/commands/registry.rs`：通过。
- `cargo test local_files --lib`：28 个 Rust 单测通过。
- `npm run test:frontend -- src/lib/localFilesApi.test.ts src/features/sftp/sftpTransferQueuePanelModel.test.ts src/features/sftp/SftpTransferWorkbench.test.tsx`：3 个测试文件、30 个测试通过。
- `npm run test:frontend -- src/features/terminal/TerminalWorkspace.test.tsx src/features/terminal/TerminalWorkspace.broadcast.test.tsx src/features/tool-panel/AiToolContent.test.tsx`：3 个测试文件、47 个测试通过。
- `npm run typecheck`：通过。
- `npm run check:source-size`：通过；694 个文件，0 个超过 1000 行硬限制，46 个 warning。
- `npm run build`：通过；仅保留既有 Vite large chunk warning。
- `npm run dev -- --host 127.0.0.1 --port 1528` 后 HTTP smoke `GET http://127.0.0.1:1528/` 返回 200；首次 smoke 脚本因 stdout/stderr 使用同一路径失败，改用独立日志后通过，并清理本轮 Vite 残留。
- `npm run tauri:dev`：首次被本轮残留 Vite 进程占用 1425 端口拦截；确认占用者为当前工作区 `vite` 后清理重跑，观察到新 `kerminal` 进程存活超过 3 秒，并已清理本轮新增进程。

未覆盖和后续边界：

- P8 仍未完成 retry、speed/ETA、durable history/audit 和 local copy managed queue。
- P9 目前只补齐本机 stat/preflight 基础；`conflictPolicy` 还未贯穿前端 API、Rust request 和实际写入/传输执行层，不能把当前 UI 当作“不会覆盖”的最终生产保护。
- `cargo fmt --check` 全仓仍会被其它 lane 的既有 Rust 格式差异阻断；本轮只对触碰的 Rust 文件运行定点 `rustfmt --check`，没有格式化共享脏文件。

### 2026-06-22T14:32:43+08:00 P9 conflictPolicy 契约贯通和文件写入原子保护

本轮继续采用 subagent 并行推进 P9。目标是把“冲突处理策略”从前端类型贯通到 Rust 传输执行层，并先在所有普通文件写入点落实原子保护，避免只做 UI 预检而底层仍静默覆盖。

协作方式：

- worker `Euler` 负责 TS 契约第一刀：新增 `SftpTransferConflictPolicy = "overwrite" | "skip" | "rename"`，把 `conflictPolicy?: SftpTransferConflictPolicy` 加到 `SftpTransferRequest`，并补 `sftp_enqueue_transfer` invoke 透传测试。
- explorer `Bacon` 负责只读审计 Rust 执行层：确认上传文件、下载文件、远端复制文件都会静默覆盖；建议远端用 `OpenFlags::EXCLUDE`、本地用 `create_new(true)` 实现 skip/rename 的 race-safe 文件写入。
- 主线程负责 Rust 模型、后端执行层和验证收口。

已落地代码切片：

- `src/lib/sftpApiTypes.ts` 增加 `SftpTransferConflictPolicy` 和 `SftpTransferRequest.conflictPolicy`；`src/lib/sftpApi.ts` re-export 该类型。
- `src/lib/sftpApi.test.ts` 增加 `sftp_enqueue_transfer` 透传 `conflictPolicy` 的契约测试；`sftpApi.tauriTransport.ts` 原本按 `{ request }` 透传，无需改动。
- `src-tauri/src/models/sftp.rs` 增加 `SftpTransferConflictPolicy` enum，默认 `Overwrite`；`SftpTransferRequest` 和 `SftpManagedTransferRequest` 均带 `conflict_policy`，serde 缺省兼容旧调用。
- `src-tauri/src/services/sftp_service.rs` 将 legacy upload/download request 的策略透传到 managed transfer；`transfer_paths.rs` 归一化时保留策略。
- `src-tauri/src/services/sftp_service/backend.rs` 将策略传入 upload/download 执行；remote copy 本轮保持旧 `Overwrite`，避免扩大到跨主机复制策略。
- `src-tauri/src/services/sftp_service/transfer_io.rs` 在文件写入点实现策略：
  - `overwrite` 保持旧行为。
  - `skip`：远端文件用 `CREATE | EXCLUDE | WRITE`，本地文件用 `create_new(true)`；目标已存在则跳过并推进已处理字节。
  - `rename`：循环抢占 `name (1).ext`、`name (2).ext` 候选名；远端和本地都用 exclusive create，避免先 stat 后写的 TOCTOU。
- 目录传输本轮先保持目录合并语义，但目录内每个文件写入遵守 `conflictPolicy`；整目录 skip/rename 仍留给后续 UI/队列语义切片。
- AI SFTP 工具构造 `SftpTransferRequest` 时保持 `Overwrite`，不在本轮改变 AI/MCP 安全策略。
- 修正 `scoped_transfer_registry_keeps_view_histories_isolated` 测试数据：用 queued transfer 验证 scoped cancel/clear，避免把 running cancel 误当成立即完成任务。

验证结果：

- `cargo check --lib`：通过。
- `cargo check --tests`：通过。
- `cargo test transfer_io --lib`：3 个测试通过，覆盖命名规则、本地 skip 不覆盖、本地 rename 生成候选文件。
- `cargo test scoped_transfer_registry_keeps_view_histories_isolated --lib`：通过。
- `cargo test --lib`：170 个通过，仍有 1 个非本轮 SFTP 相关失败：`services::ai_agent_service::tests::approval_tool_call_creates_pending_invocation_for_original_tool_id`，当前实际值为 `auto_approved`，期望为 `pending_approval`。
- 定点 `rustfmt --edition 2021 --check` touched Rust files：通过。
- `npm run test:frontend -- src/lib/sftpApi.test.ts`：17 个测试通过。
- `npm run typecheck`：通过。
- `npm run check:source-size`：通过；696 个文件，0 个超过 1000 行硬限制，46 个 warning。
- `npm run build`：通过；仅保留既有 Vite large chunk warning。
- `npm run dev -- --host 127.0.0.1 --port 1529` 后 HTTP smoke 返回 200；本轮 Vite 子进程残留已识别并清理。
- `npm run tauri:dev`：Tauri debug 壳成功启动，新 `kerminal` 进程存活超过 3 秒，并已清理本轮新增进程。

未覆盖和后续边界：

- P9 仍缺前端冲突预检/选择 UI，以及把 `statLocalPath` / `sftp_stat_path` 接进真实传输发起流程。
- 目录级 skip/rename 当前只保护目录内文件，不会把整棵目录自动改名或整体跳过；这需要结合 UI 文案和队列结果展示一起做。
- remote copy / archive / clipboard 传输仍保持旧覆盖语义；应作为后续 P9/P10 子切片单独处理，避免和跨主机传输队列语义混在一起。
- 全量 `cargo test --lib` 的唯一剩余失败来自 AI approval 测试，不属于本轮 SFTP conflictPolicy 改动；后续启动/交付门槛如要求全量 Rust lib 绿，需要对应 lane 修复该 AI 行为或测试期望。

### 2026-06-22T14:51:00+08:00 P9 本机到远端冲突预检 UI 第一刀

本轮继续采用 subagent 并行落地，目标是把上一轮已经贯通到底层写入的 `conflictPolicy` 暴露到首个真实传输入口：SFTP 工作台本机面板向远端面板上传。范围刻意收窄，不把远端复制、下载、归档和剪贴板跨域路径混进同一刀。

协作方式：

- worker `Mill` 负责纯 model/test 切片，为 `sftpTransferActionPlan` 的上传、下载、批量上传、批量下载和本机剪贴板上传 plan builder 增加可选 `conflictPolicy` 透传测试。
- explorer `Godel` 负责只读梳理传输发起链路，确认本机到远端工作台上传走 `LocalTransferPane -> resolveTransferIntent -> enqueueUploadPlan -> enqueueSftpTransfer`，第一刀应在 `LocalTransferPane` 做远端 `statSftpPath` 预检和策略弹框。
- 主线程整合 UI、helper 抽取、验证和启动门禁，并关闭两个 subagent。

已落地代码切片：

- 新增 `src/features/sftp/SftpTransferConflictDialog.tsx`，使用项目现有 `ModalShell` 和主题按钮，提供 `overwrite`、`rename`、`skip` 三种策略选择。
- `src/features/sftp/LocalTransferPane.tsx` 在本机到远端上传 enqueue 前，对 `ResolvedTransferPlan.tasks[].targetEntryPath` 调 `statSftpPath({ hostId, path })` 做远端存在性预检；发现冲突时暂存 plan 并弹出策略选择，确认后把策略写入每个 `SftpManagedTransferRequest.conflictPolicy`。
- 新增 `src/features/sftp/LocalTransferPaneTransfer.ts`，承载 `countRemoteUploadConflicts` 和 managed transfer kind 映射，避免继续膨胀主组件。
- 新增 `src/features/sftp/LocalTransferPaneKeyboard.ts` 和 `src/features/sftp/LocalPaneButton.tsx`，把本机面板键盘/按钮小工具抽出，维持 source-size 硬限制。
- `src/features/sftp/sftp-tool-content/sftpTransferActionPlan.ts` 支持可选 `conflictPolicy`，对应测试覆盖 upload/download/batch/clipboard plan 的策略透传。
- 为通过启动门禁，最小修正 `src/lib/paneSessionTraceApi.ts` 中 `registerTerminalSessionBinding` 的返回收窄，把内部 `null` 稳定归一为公开 API 的 `undefined`。

验证结果：

- `npm run typecheck`：通过。
- `npm run test:frontend -- src/features/sftp/LocalTransferPane.test.tsx src/features/sftp/sftp-tool-content/sftpTransferActionPlan.test.ts src/lib/sftpApi.test.ts`：3 个测试文件、56 个测试通过。
- `npm run check:source-size`：通过；703 个文件，0 个超过 1000 行硬限制，46 个 warning。
- `npm run build`：通过；仅保留既有 Vite large chunk warning。
- `npm run dev -- --host 127.0.0.1`：Vite dev server 在 `http://127.0.0.1:1425/` 启动，HTTP smoke 返回 200 且 root 节点存在；本轮临时 dev server 已清理。
- `npm run tauri:dev`：Vite beforeDevCommand、Rust dev build 和 `target\debug\kerminal.exe` 启动成功，观察 15 秒无启动阻断输出；本轮烟测进程已清理。
- `cargo check --tests`：通过。
- `cargo test transfer_io --lib`：3 个测试通过。
- `cargo test scoped_transfer_registry_keeps_view_histories_isolated --lib`：通过。

未覆盖和后续边界：

- 本轮只覆盖工作台左侧本机面板向右侧远端面板上传；`useSftpTransferActions` 下的普通上传、下载、拖拽下载、系统文件剪贴板上传等入口尚未接入预检/策略弹框。
- 远端复制、跨主机复制、归档和 SFTP 剪贴板远端复制仍保持旧覆盖语义，后续需要先扩展 `SftpRemoteCopyRequest` 或独立 task runner 契约。
- 当前预检把 `statSftpPath` 失败按“无冲突”处理，避免网络/权限抖动阻塞入口；真正写入仍由 backend 的 exclusive create/rename/skip 兜底。后续可区分 not found 与连接错误，给出更强的失败前置提示。
- 目录级 `skip`/`rename` 仍只保护目录内文件写入，不会整棵目录跳过或改名；需要结合队列结果、目录语义和 UI 文案单独完善。

### 2026-06-22T15:10:00+08:00 P9 普通 SFTP 上传/下载入口冲突预检接入

本轮继续采用 subagent 并行落地，目标是把上一轮只覆盖工作台本机面板上传的冲突策略，扩展到 `useSftpTransferActions` 下的普通 SFTP 传输入口。范围仍不扩展到 remote copy / archive，因为这些请求类型和执行层契约不同。

协作方式：

- explorer `Banach` 只读梳理普通传输 hook：确认 `buildFileUploadTransferPlan`、`buildDirectoryUploadTransferPlan`、`buildLocalPathBatchUploadPlan`、`buildDownloadTransferPlan`、`buildDirectoryDownloadTransferPlan`、`buildBatchDownloadTransferPlan`、`buildSftpLocalClipboardUploadPlan` 都已支持可选 `conflictPolicy`；只有 workbench 本地剪贴板上传分支需要手写 request 补策略。
- worker `Hubble` 负责纯 helper/test 切片，新增传输冲突预检 helper，不触碰主 hook。
- 主线程负责将 helper 接入 hook、渲染统一冲突弹框、补集成测试和启动门禁。

已落地代码切片：

- 新增 `src/features/sftp/sftp-tool-content/sftpTransferConflictPreflight.ts` 和测试，支持对单个 transfer request/action item、数组和 batch plan 统计冲突；上传查 `statSftpPath({ hostId, path: remotePath })`，下载查 `statLocalPath({ path: localPath, rootPath })`；stat 抛错暂按无冲突处理。
- 新增 `src/features/sftp/sftp-tool-content/useSftpTransferConflictPrompt.ts`，集中管理 pending conflict、确认策略和确认后错误回传，避免把状态机塞进主 hook。
- 新增 `src/features/sftp/sftp-tool-content/sftpTransferActionRunner.ts`，抽出批量 action runner 和 workbench 本地剪贴板上传 item 构造，使 `useSftpTransferActions.ts` 保持在 1000 行硬限制内。
- `src/features/sftp/sftp-tool-content/useSftpTransferActions.ts` 接入冲突预检：
  - 普通上传文件/目录。
  - 本地文件拖拽上传。
  - 单文件/单目录下载。
  - 批量下载和“传输到本机目标”。
  - workbench 本地剪贴板上传。
  - 系统 localFileClipboard 上传。
- `src/features/sftp/SftpToolContent.tsx` 渲染复用的 `SftpTransferConflictDialog`，不扩大 `SftpBrowserView` props 面。
- 测试支持层补充 `statSftpPath` / `statLocalPath` 默认 mock；新增集成测试覆盖“上传目标冲突 -> 弹框 -> 选择自动重命名 -> enqueue request 带 `conflictPolicy: "rename"`”。

验证结果：

- `npm run test:frontend -- src/features/sftp/sftp-tool-content/sftpTransferConflictPreflight.test.ts src/features/sftp/sftp-tool-content/useSftpTransferActions.test.ts src/features/sftp/SftpToolContent.dialogs.test.tsx src/features/sftp/SftpToolContent.transfers.test.tsx`：4 个测试文件、39 个测试通过。
- `npm run typecheck`：通过。
- `npm run check:source-size`：通过；707 个文件，0 个超过 1000 行硬限制，46 个 warning；`useSftpTransferActions.ts` 当前 997 行，`useSftpTransferActions.test.ts` 当前 1000 行。
- `npm run build`：通过；仅保留既有 Vite large chunk warning。
- `npm run dev -- --host 127.0.0.1`：Vite dev server 在 `http://127.0.0.1:1425/` 启动，HTTP smoke 返回 200 且 root 节点存在；本轮临时 dev server 已清理。
- `npm run tauri:dev`：Vite beforeDevCommand、Rust dev build 和 `target\debug\kerminal.exe` 首次启动成功；随后 watcher 被其它并行会话写入的 Rust 文件持续触发重编译，未观察到本轮前端改动导致的启动阻断；本轮烟测进程和 1425 端口已清理。
- Hubble 子任务额外验证过 `npm run build` 和 Vite dev smoke；主线程最终验证以本节上方命令为准。

未覆盖和后续边界：

- remote copy / 跨主机复制 / SFTP 剪贴板远端复制仍未支持 `conflictPolicy`；需要先扩展 `SftpRemoteCopyRequest`、Rust 模型和执行层策略，不能只在前端硬塞字段。
- ZIP archive 上传/下载仍走 archive 专属请求，未接入本轮普通 transfer conflict dialog。
- 目录级 `skip`/`rename` 仍是文件写入级保护，不是整棵目录跳过或整目录改名。
- 当前 stat 失败仍按“无冲突”直通，底层 exclusive create 继续兜底；后续可把 not-found 与连接/权限错误区分开，给用户更准确的前置提示。
- `useSftpTransferActions.test.ts` 已到 1000 行硬边界，后续再加 hook 用例应先拆测试文件或抽 test support。

### 2026-06-22T15:24:00+08:00 P9 remote copy / 跨主机复制 conflictPolicy 贯通

本轮继续采用 subagent 并行落地，目标是补齐上轮明确剩余的 remote copy / 跨主机复制覆盖语义：前端预检和弹框选择策略，后端 request 与执行层真正遵守策略。archive 仍保持独立范围，不和普通 remote copy 混做。

协作方式：

- explorer `Erdos` 只读确认前端接入点：`buildSftpClipboardPastePlan`、`buildSftpTargetTransferPlan` 需要可选 `conflictPolicy`；remote copy 预检应对 `targetHostId + targetRemotePath` 调 `statSftpPath`；最小接入点仍在 `useSftpTransferActions`，不是纯 executor `useSftpRemoteCopyTaskRunner`。
- worker `Noether` 负责 Rust 后端切片：`SftpRemoteCopyRequest` 增加 serde 兼容的 `conflict_policy`，并把策略传到 streamed/staged remote copy 的最终文件写入点。
- 主线程负责前端 model、preflight、hook 整合、统一验证和计划收口。

已落地代码切片：

- `src/lib/sftpApiTypes.ts` 的 `SftpRemoteCopyRequest` 增加可选 `conflictPolicy?: SftpTransferConflictPolicy`。
- `src/features/sftp/sftp-tool-content/sftpRemoteTransferModel.ts` 为 `buildSftpClipboardPastePlan` 和 `buildSftpTargetTransferPlan` 增加可选 `conflictPolicy`，只在传入时写入每个 remote copy request。
- `src/features/sftp/sftp-tool-content/sftpTransferConflictPreflight.ts` 支持 `SftpRemoteCopyRequest` 和 `SftpRemoteCopyPlan`；remote copy 冲突检查使用 `statSftpPath({ hostId: targetHostId, path: targetRemotePath })`。
- 新增 `src/features/sftp/sftp-tool-content/sftpRemoteCopyConflictActions.ts`，把 remote copy plan 的预检、pending 策略选择后重放、已有 plan 加策略封装出去，避免 `useSftpTransferActions.ts` 超过 1000 行。
- `src/features/sftp/sftp-tool-content/useSftpTransferActions.ts` 的三条 remote copy 入口接入统一冲突弹框：
  - 远端拖拽到远端目录。
  - SFTP 剪贴板远端复制/跨主机粘贴。
  - “传输到远端目标”。
- Rust 后端：
  - `src-tauri/src/models/sftp.rs`：`SftpRemoteCopyRequest.conflict_policy` 默认 `Overwrite`。
  - `src-tauri/src/services/sftp_service/transfer_paths.rs`：normalize 后保留策略。
  - `src-tauri/src/services/sftp_service/backend.rs` / `transfer_io.rs`：streamed remote copy 传入策略，目录继续合并，文件写入复用 overwrite/skip/rename exclusive create 逻辑。
  - `src-tauri/src/services/sftp_service/runtime_tasks.rs`：staged remote copy 最终上传目标遵守策略。
- 测试补充：
  - remote transfer model 覆盖 clipboard paste / target transfer 的 `conflictPolicy` 透传。
  - preflight 覆盖 remote copy 目标 host/path 冲突统计。
  - Rust validation / native backend / transfer queue 覆盖默认反序列化和 remote copy 策略执行链路。

验证结果：

- `npm run test:frontend -- src/features/sftp/sftp-tool-content/sftpTransferConflictPreflight.test.ts src/features/sftp/sftp-tool-content/sftpRemoteTransferModel.test.ts src/features/sftp/sftp-tool-content/useSftpRemoteCopyTaskRunner.test.ts src/features/sftp/SftpToolContent.transfers.test.tsx`：4 个测试文件、44 个测试通过。
- `npm run typecheck`：通过。
- `npm run check:source-size`：通过；708 个文件，0 个超过 1000 行硬限制，47 个 warning；`useSftpTransferActions.ts` 当前 998 行，`useSftpTransferActions.test.ts` 当前 1000 行。
- `cargo test --manifest-path src-tauri/Cargo.toml services::sftp_service::transfer_io::tests --no-default-features`：通过。
- `cargo test --manifest-path src-tauri/Cargo.toml services::sftp_service::tests::validation --no-default-features`：12 个测试通过。
- `cargo test --manifest-path src-tauri/Cargo.toml services::sftp_service::tests::native_backend::native_sftp_backend_streams_remote_copy_between_hosts --no-default-features`：通过。
- `cargo test --manifest-path src-tauri/Cargo.toml services::sftp_service::tests::transfer_queue::remote_copy_task_uses_source_and_target_hosts --no-default-features`：通过。
- `cargo check --manifest-path src-tauri/Cargo.toml --tests --no-default-features`：通过。
- 定点 `rustfmt --edition 2021 --check` touched Rust files：通过。
- `npm run build`：通过；仅保留既有 Vite large chunk warning。
- `npm run dev -- --host 127.0.0.1`：首次被当前工作区残留 Vite 占用 1425 拦截；识别并清理残留后重跑成功，HTTP smoke 返回 200 且 root 节点存在。
- `npm run tauri:dev`：Vite beforeDevCommand、Rust dev build 和 `target\debug\kerminal.exe` 启动成功，观察 15 秒无新增错误；本轮烟测进程和 1425 端口已清理。

未覆盖和后续边界：

- ZIP archive 上传/下载仍未接入 conflictPolicy；它们使用 archive 专属请求和执行链路，需要单独切片。
- 目录级 `skip`/`rename` 仍是目录合并 + 子文件写入策略，不是整棵目录跳过或整目录重命名。
- stat 失败仍按“无冲突”直通，底层 exclusive create 兜底；后续可区分 not-found 与连接/权限错误。
- `useSftpTransferActions.ts` 和 `useSftpTransferActions.test.ts` 都接近硬边界，后续继续扩展前应先拆 hook/test 支持层。

### 2026-06-22T15:42:00+08:00 P10 ZIP archive 上传/下载 conflictPolicy 贯通

本轮继续采用 subagent 并行实施，目标是补齐 P9 明确剩余的 ZIP archive 专属请求和执行链路，让“下载为 ZIP”和“上传为 ZIP”也能复用同一套冲突弹框与 overwrite / skip / rename 策略。

协作方式：

- worker `Lorentz` 负责前端切片：archive request TS 类型、plan builder、preflight 扩展、hook 接线和 helper/test 拆分；保持 `useSftpTransferActions.ts` 不突破 1000 行硬限制。
- worker `Pascal` 负责 Rust 后端切片：archive request 模型、normalize、archive zip 写入和上传执行链路；不触碰前端文件。
- 主线程负责 CodeGraph 定位、合并审计、格式修复、统一验证、启动烟测和计划收口。

已落地代码切片：

- `src/lib/sftpApiTypes.ts`：`SftpArchiveDownloadRequest` / `SftpArchiveUploadRequest` 增加可选 `conflictPolicy?: SftpTransferConflictPolicy`。
- `src/features/sftp/sftp-tool-content/sftpTransferActionPlan.ts`：`buildSftpArchiveDownloadPlan` / `buildSftpArchiveUploadPlan` 接受可选 `conflictPolicy` 并只在传入时写入 request。
- `src/features/sftp/sftp-tool-content/sftpTransferConflictPreflight.ts`：支持 archive download/upload request；download archive 对 `targetLocalPath` 调 `statLocalPath`，upload archive 对 `hostId + targetRemotePath` 调 `statSftpPath`。
- `src/features/sftp/sftp-tool-content/useSftpTransferActions.helpers.ts`：新增 archive plan preflight + pending policy 重放 helper，复用 `withSftpTransferViewScope`、enqueue 和 transfer snapshot merge。
- `src/features/sftp/sftp-tool-content/useSftpTransferActions.ts`：`downloadEntryAsArchive` / `uploadLocalArchive` 接入冲突弹框，确认后以用户选择的 overwrite / skip / rename 重建计划并入队。
- Rust 后端：
  - `src-tauri/src/models/sftp.rs`：`SftpArchiveDownloadRequest` / `SftpArchiveUploadRequest` 增加 serde 默认 `conflict_policy: Overwrite`。
  - `src-tauri/src/services/sftp_service/transfer_paths.rs`：archive normalize 保留 `conflict_policy`。
  - `src-tauri/src/services/sftp_service/archive.rs`：本地 ZIP 写入支持 overwrite / skip / rename。
  - `src-tauri/src/services/sftp_service/runtime_tasks.rs`：archive download 写本地 ZIP 时使用请求策略；archive upload 上传远程 ZIP 时把策略传入普通上传链路。
- 测试补充：
  - front-end action plan / conflict preflight / archive helper 覆盖 request 透传、目标 stat 和策略重放。
  - Rust archive clipboard / validation / native backend 覆盖默认反序列化和 archive download skip 冲突行为。

验证结果：

- `npm run test:frontend -- src/features/sftp/sftp-tool-content/sftpTransferActionPlan.test.ts src/features/sftp/sftp-tool-content/sftpTransferConflictPreflight.test.ts src/features/sftp/sftp-tool-content/useSftpTransferActions.helpers.test.ts src/features/sftp/sftp-tool-content/sftpRemoteTransferModel.test.ts src/features/sftp/sftp-tool-content/useSftpRemoteCopyTaskRunner.test.ts src/features/sftp/SftpToolContent.transfers.test.tsx`：6 个测试文件、59 个测试通过。
- `cargo test --manifest-path src-tauri/Cargo.toml services::sftp_service::tests::archive_clipboard --no-default-features`：8 个测试通过。
- `rustfmt --edition 2021 --check` touched SFTP Rust files：通过；首次检查发现 import 排序差异，已限定在 SFTP service 相关文件内格式化后复跑通过。
- `npm run typecheck`：通过。
- `npm run check:source-size`：通过；710 个文件，0 个超过 1000 行硬限制，47 个 warning；`useSftpTransferActions.ts` 当前 987 行，`useSftpTransferActions.test.ts` 当前 1000 行。
- `cargo check --manifest-path src-tauri/Cargo.toml --tests --no-default-features`：通过。
- `npm run build`：通过；仅保留既有 Vite large chunk warning。
- `npm run dev -- --host 127.0.0.1 --port 1450`：Vite dev server 启动成功，HTTP smoke 返回 200 且 root 节点存在；本轮临时 dev server 已清理。
- `npm run tauri:dev`：首次被当前仓库残留 Vite PID 29796 占用 1425 阻断；确认命令来自 `C:\dev\rust\kerminal\node_modules\...\vite.js` 后仅清理该进程。重跑后 Vite beforeDevCommand、Rust dev build 和 `target\debug\kerminal.exe` 启动成功，观察约 15 秒无新增错误，进程以 0 退出；1425 端口最终无监听。

未覆盖和后续边界：

- 目录级 `skip`/`rename` 仍是目录合并 + 子文件/最终 ZIP 文件写入策略，不是整棵目录跳过或整目录改名。
- stat 失败仍按“无冲突”直通，底层 exclusive create 兜底；后续可区分 not-found 与连接/权限错误。
- `useSftpTransferActions.test.ts` 已在 1000 行硬边界，后续新增 hook 级用例必须先拆测试文件或继续放到 helper/model 测试。

### 2026-06-22T16:02:00+08:00 P11 目录级策略与 stat 错误边界收口

本轮继续采用 subagent 并行实施，目标是收掉 P10 剩余的两个生产级边界：目录级 `skip`/`rename` 不再只是子文件写入策略，以及冲突预检 stat 失败不再误当作“无冲突”。

协作方式：

- worker `Huygens` 负责 Rust SFTP I/O 切片：目录上传、下载、远程复制在根目标目录处先应用 `conflictPolicy`。
- worker `Heisenberg` 负责前端 preflight 切片：区分 not-found 与权限/连接/后端错误。
- 主线程负责 CodeGraph 定位、集成审计、统一验证和启动烟测。

已落地代码切片：

- `src-tauri/src/services/sftp_service/transfer_io.rs`
  - directory upload / download / remote copy 进入递归前先 resolve 根目标目录。
  - `skip`：根目标目录已存在时整棵目录跳过，不再合并子文件。
  - `rename`：根目标目录已存在时生成 `name (1)` 这类不冲突目录名，再写入整棵树。
  - `overwrite`：保留现有合并/覆盖语义。
  - 文件级 overwrite / skip / rename 逻辑保持不变；staged remote copy 的最终上传目录路径也受益于同一逻辑。
- `src-tauri/src/services/sftp_service/tests/native_backend.rs`
  - 覆盖下载目录 `skip` 不合并既有本地目录。
  - 覆盖上传目录 `rename` 创建新的远程根目录。
- `src/features/sftp/sftp-tool-content/sftpTransferConflictPreflight.ts`
  - stat 异常只在 message 判定为 not-found / no-such / 不存在 时按“无冲突”处理。
  - 权限、连接、后端错误会继续抛出，由现有 `runWithConflictPreflight` 错误路径展示。
- `src/features/sftp/sftp-tool-content/sftpTransferConflictPreflight.test.ts`
  - 覆盖远端 not-found 无冲突。
  - 覆盖本地 not-found reject 无冲突。
  - 覆盖本地/远端非 not-found stat 错误 reject。

验证结果：

- `npm run test:frontend -- src/features/sftp/sftp-tool-content/sftpTransferConflictPreflight.test.ts src/features/sftp/sftp-tool-content/sftpTransferActionPlan.test.ts src/features/sftp/sftp-tool-content/useSftpTransferActions.helpers.test.ts src/features/sftp/sftp-tool-content/sftpRemoteTransferModel.test.ts src/features/sftp/SftpToolContent.transfers.test.tsx`：5 个测试文件、57 个测试通过。
- `cargo test --manifest-path src-tauri/Cargo.toml services::sftp_service::transfer_io::tests --no-default-features`：5 个测试通过。
- `cargo test --manifest-path src-tauri/Cargo.toml native_sftp_backend_ --no-default-features`：8 个 native backend 测试通过，包含目录 skip / rename 和 remote copy。
- `rustfmt --edition 2021 --check` touched SFTP Rust files：通过。
- `npm run typecheck`：通过。
- `npm run check:source-size`：通过；710 个文件，0 个超过 1000 行硬限制，47 个 warning；`useSftpTransferActions.ts` 当前 987 行，`useSftpTransferActions.test.ts` 当前 1000 行，`native_backend.rs` 当前 987 行。
- `cargo check --manifest-path src-tauri/Cargo.toml --tests --no-default-features`：通过。
- `npm run build`：通过；仅保留既有 Vite large chunk warning。
- `npm run dev -- --host 127.0.0.1 --port 1450`：Vite dev server 启动成功，HTTP smoke 返回 200 且 root 节点存在；临时 server 已清理。
- `npm run tauri:dev`：首次仍被当前仓库残留 Vite PID 36196 占用 1425 阻断；清理后重跑时 Vite/Cargo 启动，`target\debug\kerminal.exe` 瞬时以 `0xffffffff` 退出。为排除代码启动崩溃，随后手动启动 `npm run dev -- --host 127.0.0.1 --port 1425`，再运行 `RUST_BACKTRACE=1 cargo run --manifest-path src-tauri/Cargo.toml --no-default-features --color always --`，`src-tauri\target\debug\kerminal.exe` 成功启动并稳定运行超过 20 秒，无 backtrace 或启动错误；本轮手动启动的 Kerminal 进程和 1425 端口均已清理。

剩余注意事项：

- `useSftpTransferActions.test.ts` 和 `native_backend.rs` 都接近 1000 行硬边界，后续新增测试应继续拆到 helper/model/更小的专用测试文件。
- `tauri dev` wrapper 在本机仍可能受残留 Vite/窗口生命周期影响；手动 Vite + cargo run 已验证应用本体可启动。

## 结论

Kerminal 的 SFTP 传输台不应该只是“一个本地预览栏 + 一个远端文件栏 + 隐藏的跨主机复制能力”。生产版应该是：

- 本机和远端都是一等文件面板。
- 左右两侧都能打开本机或多个 SSH 主机 tab。
- 文件面板右键菜单、主机资产右键菜单和 pane tab 菜单清晰分域。
- 传输可以通过右键、工具栏、拖拽和复制/粘贴触发。
- 队列、冲突、失败、重试和生产保护足够可见。

这个方向学习了成熟 SFTP 工具的交互密度和任务模型，但保留 Kerminal 自己的终端上下文、主机资产和安全边界。
