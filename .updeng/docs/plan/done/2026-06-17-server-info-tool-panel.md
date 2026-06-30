---
id: PLAN-20260617-000024-server-info-tool-panel
status: done
created_at: 2026-06-17T00:00:24+08:00
started_at: 2026-06-17T00:00:24+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# 服务器信息工具面板

## 目标
- 在右侧“系统”工具中展示当前选中 SSH 主机的系统、CPU、内存、磁盘、网络和运行时间信息。
- 提供刷新按钮、加载态、错误态和未选择 SSH 主机时的空状态。
- 后端通过受控 OpenSSH 只读命令采集信息，为后续 AI Server info tools 复用。

## 非目标
- 本切片不做本机系统监控。
- 本切片不做进程列表、GPU、服务管理或告警。
- 本切片不保存历史监控数据，不做周期性后台轮询。

## 影响范围
- Rust：`models`、`services`、`commands`、`state`、`lib`。
- React：`src/lib/*Api.ts`、`src/features/tool-panel/*`。
- 测试：Rust service/parser 测试、前端 API 和 ToolPanel 测试。
- 文档：主计划 slice 10 状态与当前进行中事项。

## 执行步骤
- [x] 定义服务器信息请求/响应模型和解析逻辑。
- [x] 新增 `ServerInfoService`，按 host id 查找 SQLite 主机并执行受控 SSH 采集命令。
- [x] 注册 Tauri command 和前端 `serverInfoApi`。
- [x] 将右侧“系统”工具替换为真实 SSH 主机信息面板。
- [x] 为 parser/API/UI 补充测试，确保左侧选中主机和右侧系统工具联动不回归。
- [x] 运行 `npm run check` 和旧品牌残留扫描。

## 验证
- `npm run typecheck`：通过。
- `npm run test:frontend`：13 个测试文件、62 个测试通过。
- `cargo test`：通过，包含 `server_info_service.rs` 的 3 个集成测试。
- `npm run check`：通过，包含前端测试、Rust fmt/clippy/test 和生产构建；Vite 仍有 chunk 大于 500KB 的既有警告。
- 旧品牌残留扫描：无命中。
- `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:1420/ -TimeoutSec 5`：HTTP 200。
- Codex in-app browser 检查 `http://127.0.0.1:1420/`：标题为 `Kerminal`，可见文本无旧品牌残留。

## 风险
- 远程主机可能不是 Linux，采集字段需要全部可选并降级显示。
- CPU 百分比需要采样，远程命令会有短暂延迟。
- 真实 SSH 主机不可在自动化测试中依赖；测试覆盖参数、解析、未知 host 拒绝和前端状态。


