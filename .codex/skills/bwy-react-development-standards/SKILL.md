---
name: bwy-react-development-standards
description: |-
  React 前端开发规范技能，融合 React 官方规则、eslint-plugin-react-hooks、TypeScript 严格类型、Google TypeScript Style Guide、typescript-eslint、通用前端代码规范与 Java 后端多模块脚手架接口契约。适用于 React、TypeScript、TSX、JSX、Vite、React Router、Shadcn UI、Tailwind CSS、Lucide、组件、Hooks、状态、Effects、前端服务封装、Mock/API 切换、分页日期范围、权限标识、导入导出、后台管理系统页面、原型还原、截图对照和前后端契约对齐。

  触发场景：
  - 新增或修改 React 页面、组件、自定义 Hook、状态管理、Effect、服务封装、领域类型或样式
  - 需要检查 Hooks 调用顺序、渲染纯净性、状态结构、Effect 边界、稳定 key 或用户交互模式
  - 需要按项目规范处理前端注释、主题适配、错误展示、公开类型建模和前端测试
  - 需要把前端页面对齐 Java 后端脚手架的 Controller、VO、BO、PageQuery、TableDataInfo、R、权限标识、导出和日期范围契约
  - 需要把 React 页面或组件对齐原型、设计图、参考 HTML、旧页面或截图

  触发词：React、TypeScript、TSX、JSX、Hook、useEffect、组件、前端规范、状态管理、Vite、React Router、Shadcn、Tailwind、Lucide、Mock、API 切换、分页、权限、导出、TableDataInfo、PageQuery、原型、截图、像素、视觉还原、Vitest、Jest、RTL、Playwright
---

# React 与脚手架前端规范

## 适用边界

- 只处理前端工程规范、页面实现、组件组织、路由、服务层、类型、Mock/API 切换、UI 状态、React 规则和浏览器验证。
- 不处理后端实现、数据库迁移、Redis 或部署运维；只把 Java 后端脚手架的接口契约转成前端对接约束。
- 目标项目不是 React + TypeScript + Vite 时，先抽象为原则，再按目标项目已有技术栈落地，不强行迁移依赖。
- 已有项目存在成熟设计系统、请求封装或目录规范时，优先遵循目标项目现状，只迁移本技能中的结构化思想。
- 需要解释规范来源、统一团队规则或处理“官方规则 vs 项目惯例”争议时，先读 `references/standards-sources.md`。

## 规范来源与执行等级

- 优先级：用户最新要求 > `AGENTS.md` 和当前目录规则 > 当前项目既有实现 > 本技能 > React/TypeScript 官方与一手资料 > 第三方风格建议。
- P0 正确性规则必须满足：组件和 Hook 渲染纯净、Hook 调用顺序合法、Effect 依赖完整、TypeScript 编译通过、项目构建通过、用户可见错误不泄露敏感信息。
- P1 长期维护规则默认满足：状态结构最小化、Effect 只同步外部系统、服务层隔离协议、公开 props/领域类型显式建模、页面补齐 loading/empty/error/disabled 权限态。
- P2 风格规则按项目统一执行：导入顺序、type-only import、命名、文件组织、组件拆分、样式写法和 lint 自动修复。
- 如果 P0 与项目旧代码冲突，新代码按 P0 修正；旧代码只在本次影响范围内最小修复，不顺手大规模重写。
- 如果 Google TypeScript Style Guide、typescript-eslint 或项目约定冲突，以项目 lint/tsconfig 和本技能 P0 为准，把外部风格指南当作参考，不机械照搬。

## 开发手册化检查

- 组件：组件函数只计算 JSX；不要在渲染阶段写 DOM、发请求、改全局变量、改 props/state 或触发非本地副作用。
- Hooks：所有 Hook 只能在函数组件或自定义 Hook 顶层调用，不能放在条件、循环、事件处理器、`try/catch/finally`、嵌套函数或早返回之后。
- Effects：没有外部系统就不要写 Effect；纯派生数据在渲染阶段计算，用户动作放事件处理器，订阅、计时器、网络和第三方库同步必须有清理或过期响应保护。
- 状态：相关状态一起变化就合并；能从 props/state 派生就不进 state；列表选择保存稳定 ID；嵌套状态过深时扁平化或拆 reducer。
- TypeScript：长期协议禁用 `any`；不确定值先用 `unknown` 并收窄；可空字段显式建模；复杂条件类型只在能显著减少重复且不损害可读性时使用。
- 导入：类型专用导入优先使用 `import type`；不要让纯类型依赖残留为运行时依赖。
- 自动化：优先启用 `eslint-plugin-react-hooks` recommended、项目既有 ESLint/TypeScript 配置和 `@typescript-eslint` 推荐配置；不要用注释压制 lint，除非写清不变量并缩小范围。

## 脚手架适配

- 后端通常是 Java 多模块脚手架；启动模块、业务模块和前端目录以目标项目现有结构为准。
- 前端项目可以独立仓库或独立目录存在，但接口、权限、分页、日期范围、错误口径必须跟后端契约一致。
- 后端标准分层是 `controller -> service -> mapper -> domain/po/bo/vo`；前端类型应优先对齐 `VO` 返回字段、`BO` 查询和写入字段。
- 新增管理页面前，先找后端最近似 Controller，确认路径、权限、日志、导出、删除校验、数据权限、字典翻译和日期范围。
- 后端普通响应通常是 `R<T>`，分页响应通常是 `TableDataInfo<T>`；前端客户端要统一解包，不让页面组件直接处理后端 envelope。
- 后端分页查询使用 `PageQuery`，查询条件进入业务 `Bo`，日期范围保留 `params` 结构；前端查询对象不要改造成另一套协议。
- 权限格式统一是 `${module}:${business}:${action}`，前端按钮权限、菜单权限和路由权限必须复用同一标识。
- 标准 CRUD 路径默认对齐后端生成器风格：`GET /list`、`POST /export`、`GET /{id}`、`POST`、`PUT`、`DELETE /{ids}`。

## 技术栈约定

- 默认技术栈：React、TypeScript、Vite、React Router、Shadcn UI/Radix UI、Tailwind CSS、Lucide React。
- 状态管理优先使用 React 本地状态和组合式 Hooks；没有明确跨页面共享需求时，不引入全局状态库。
- HTTP 客户端优先使用项目统一 `fetch` 或既有请求封装；禁止在页面组件中散落直接请求。
- 图标统一使用 Lucide React 或目标项目既有图标库；按钮、菜单、表格操作和空状态优先复用现有 UI 组件。

## 推荐结构

- 页面组合优先放在业务领域目录，例如 `src/pages/<module>/`、`src/features/<domain>/` 或项目既有页面目录。
- 跨领域复用组件放在公共组件目录，例如 `src/components/` 或项目既有组件库目录。
- 访问后端接口、本机能力、浏览器存储或第三方 SDK 时，优先通过 `src/services/`、`src/api/` 或项目既有语义化服务封装。
- 领域类型统一维护在 `src/types/`、`src/services/types/`、领域目录内的 `types.ts`，或项目既有类型目录。
- 页面组件优先负责组合和交互，不直接堆大量协议映射、状态机和副作用逻辑。

推荐目录：

```text
src/
├── main.tsx
├── App.tsx
├── layouts/
│   └── DashboardLayout.tsx
├── pages/
│   └── <module>/
│       ├── List.tsx
│       ├── Create.tsx
│       ├── Detail.tsx
│       └── index.ts
├── components/
│   └── ui/
├── services/
│   ├── config.ts
│   ├── <module>.ts
│   ├── api/
│   │   ├── client.ts
│   │   └── <module>.ts
│   ├── mock/
│   │   ├── <module>.ts
│   │   └── data/
│   └── types/
│       ├── common.ts
│       └── <module>.ts
└── hooks/
```

- 页面按业务模块分目录，`index.ts` 统一导出页面组件。
- 公共 UI 组件放 `components/ui/`，业务组件优先放在对应页面或模块目录内。
- 服务、Mock、API、类型按同一 `<module>` 命名，避免页面直接依赖 Mock 数据文件。
- 路径别名使用 `@/` 指向 `src/`，或跟随目标项目既有别名。

## 路由和布局

- `/login` 等认证页独立于主布局。
- 后台主应用使用 `DashboardLayout` 或项目既有布局包裹，布局负责侧边栏、面包屑、用户菜单和 `<Outlet />`。
- 路由定义集中在 `App.tsx` 或目标项目既有路由入口。
- 新增页面时同步处理：页面文件、模块导出、路由注册、侧边栏菜单项、鉴权包裹。
- 编辑页优先复用创建页，例如 `/items/create` 和 `/items/:id/edit` 复用同一组件，通过路由参数区分模式。

## 服务层规范

- 每个业务模块保持 `types -> mock/api -> switch export -> page` 的调用链。
- `services/config.ts` 提供环境开关：

```ts
export const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false'
export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8006/api'
```

- `services/<module>.ts` 只负责按环境导出服务：

```ts
import { USE_MOCK } from './config'
import { apiModuleService } from './api/module'
import { mockModuleService } from './mock/module'

export const moduleService = USE_MOCK ? mockModuleService : apiModuleService
```

- 页面只引用 `@/services/<module>` 或项目统一 API 入口，不关心当前是 Mock 还是真实 API。
- Mock 实现要模拟真实异步行为、分页、搜索、筛选、创建、编辑、删除和错误场景。
- API 实现只处理协议适配，不塞页面状态和展示文案。
- 对接当前 Java 脚手架时，建议按后端业务名创建 `services/api/<business>.ts`，方法名直接映射 Controller 行为，例如 `listXxx`、`getXxx`、`addXxx`、`updateXxx`、`delXxx`、`exportXxx`。
- API 方法入参按后端 `Bo`/`PageQuery` 建模，返回值按后端 `Vo`/`TableDataInfo<Vo>` 建模。

## API Client

- 统一封装 `get`、`post`、`put`、`delete`。
- GET 自动拼接 query params，忽略 `undefined` 和空字符串等无效查询值。
- 请求默认携带 `Content-Type: application/json`。
- 登录后从统一 `tokenStorage` 读取 token，并注入 `Authorization: Bearer <token>`。
- `401` 统一清理 token 并跳转登录页。
- 后端通用响应形如 `{ code, message, data }` 时，客户端返回 `data` 部分；业务错误码统一抛出 `Error`。
- 不在页面组件中重复解析响应 envelope。
- 适配当前 Java 脚手架时，同时支持普通 `R<T>` 和分页 `TableDataInfo<T>`：
  - 普通接口成功后返回 `data`。
  - 分页接口保留 `rows`、`total` 等后端分页字段，或在客户端统一转换为项目约定的 `items`、`total`，但只能选一种并全项目一致。
- 导出接口按后端 `POST /export` 返回文件流处理，服务层负责 blob、文件名和下载逻辑，页面只触发命令和展示 loading。
- 批量删除接口按 `DELETE /{ids}` 传递逗号分隔或后端既有格式，删除前页面必须二次确认。
- 不用前端猜测后端错误码；错误提示优先展示后端 `msg/message` 的业务文本，缺失时再使用前端兜底文案。

## 常用例子

公共响应类型：

```ts
export interface ApiResponse<T> {
  code: number
  msg?: string
  message?: string
  data: T
}

export interface PageQuery {
  pageNum: number
  pageSize: number
  orderByColumn?: string
  isAsc?: 'asc' | 'desc'
}

export interface TableDataInfo<T> {
  rows?: T[]
  data?: T[]
  total: number
  code: number
  msg?: string
}
```

模块 API：

```ts
export function listItem(query: ItemQuery & PageQuery) {
  return request<TableDataInfo<ItemVo>>({
    url: '/biz/item/list',
    method: 'get',
    params: query,
  })
}

export function exportItem(query: ItemQuery) {
  return requestBlob({
    url: '/biz/item/export',
    method: 'post',
    data: query,
  })
}
```

日期范围查询：

```ts
const query = {
  ...queryParams,
  params: {
    ...queryParams.params,
    beginTime: dateRange?.[0],
    endTime: dateRange?.[1],
  },
}
```

## 后端契约映射

- 后端 `VO` -> 前端详情/列表返回类型。
- 后端 `BO` -> 前端新增、编辑、查询请求类型。
- 后端 `PageQuery` -> 前端分页字段，默认保留 `pageNum`、`pageSize` 或当前项目已有字段。
- 后端 `TableDataInfo<T>` -> 前端分页响应，默认包含 `rows`、`total`。
- 后端 `R<T>` -> 前端普通响应，默认包含 `code`、`msg/message`、`data`。
- 后端 `params` -> 前端扩展查询参数，日期范围必须继续放入 `params`，不要平铺成临时字段。
- 后端字典、枚举、状态码 -> 前端集中维护映射表，不在多个页面散落硬编码。
- 后端数据权限影响列表可见性时，前端只展示接口返回结果，不自行绕过或补全不可见数据。

## 类型建模

- `services/types/common.ts` 或项目公共类型目录维护 `ApiResponse`、分页响应、分页查询、通用状态枚举。
- 每个领域显式定义列表项、详情、创建入参、更新入参、筛选条件和统计类型。
- 长期协议禁止使用 `any`；不确定字段使用联合类型、可选字段或 `unknown` 后再收窄。
- 前端字段命名必须和 API 契约一致；当前 Java 脚手架通常使用 `camelCase`，不要套用非本项目的 `snake_case` 习惯。
- 查询类型保留 `params?: Record<string, unknown>`，用于日期范围和后端扩展查询条件。
- 写入类型按新增和编辑分开建模；编辑对象必须包含后端主键字段，新增对象不传后端自动生成字段。
- 枚举值集中建模，页面用映射表生成文案、颜色和图标。
- 公开组件 props、领域类型、服务入参和返回值需要显式建模，避免用 `any` 承接长期协议。

## 页面模式

- 列表页默认包含：`loading`、搜索条件、筛选条件、分页、总数、空状态、错误提示和操作按钮状态。
- 常见后台列表状态可统一命名为 `loading`、`buttonLoading`、`showSearch`、`ids`、`single`、`multiple`、`total`。
- 搜索条件变化后重置到第 1 页。
- 脚手架列表页优先保留 `queryParams`、`dateRange`、`handleQuery`、`resetQuery`、`getList`、`handleAdd`、`handleUpdate`、`handleDelete`、`handleExport` 等常见命名。
- 日期范围查询通过工具写入 `queryParams.params`，不要另造 `startTime/endTime` 顶层字段，除非后端 BO 明确这样定义。
- 多选状态由 `ids`、`single`、`multiple` 驱动，批量按钮禁用状态必须跟选中数量一致。
- 创建/编辑页需要支持初始数据回填、提交 loading、失败提示、成功后跳转或刷新。
- 详情页需要展示基础信息、统计信息、操作区、删除确认和相关子资源入口。
- 删除、回滚、禁用、发布等破坏性或重要操作必须使用项目对话框二次确认，不直接调用浏览器 `confirm`。
- 用户可见错误不要暴露 token、堆栈、内部路径或底层协议细节。

## UI 与交互

- 后台管理界面应保持信息密度、清晰层级和稳定布局，避免营销式 hero、过度装饰和大面积单色渐变。
- 优先使用 Shadcn UI 的 Button、Card、Table、Badge、Dialog、Sheet、Tabs、Select、Input、Textarea、DropdownMenu，或目标项目既有等价组件。
- 图标按钮使用 Lucide 图标，必要时补充 tooltip。
- 状态用 Badge 或明确文本表示，例如 active、inactive、draft、error、processing。
- 表格操作列保持固定语义：查看、编辑、删除、启用/禁用、测试、版本、监控。
- 空状态要告诉用户当前没有什么数据和下一步可执行动作。
- 加载、错误、空数据、无权限、表单校验失败都必须有可见反馈。
- 文案保持业务化，避免出现 Mock、API envelope、内部字段名等实现细节。
- 新增页面或面板需要适配浅色、深色和跟随系统主题，优先复用既有主题变量。
- 列表、表单、弹框、筛选、分页、上传、预览和权限状态优先复用项目已有交互模式。

## 运行态视觉验证

React 页面、组件、样式、布局、主题、状态展示或交互态变更，必须把真实渲染结果纳入验证。

1. 启动项目现有前端 dev server，例如 `pnpm dev`、`npm run dev` 或 README/脚本指定命令；端口冲突时换端口并记录实际 URL。
2. 用编程浏览器或 Codex Browser 打开目标路由，等待数据、字体、异步状态和动画稳定后截图。
3. 同时打开原型 HTML、Figma 导出/截图、设计图、参考旧页面或用户提供图片；没有显式原型时，选最近似页面和项目设计系统作为参考。
4. 逐项比对布局分区、主辅色和状态色、间距留白、字号字重行高、控件类型、文案、图标、表格/卡片语义、hover、active、disabled、loading、empty、error、权限态、弹窗/抽屉和响应式断点。
5. 关键视觉偏差未消除时继续修改并重新截图；视觉验证失败与 typecheck/build 失败一样阻止完成和提交。
6. 在 `verification.md` 或 `tasks.md` Round Log 记录运行 URL、截图路径、参考源、已检查交互态、剩余差异和接受理由。

不要只凭代码阅读或模型记忆判断视觉完成；验收必须基于真实渲染证据。

## 组件与 Hooks

- 组件和自定义 Hook 必须保持渲染纯净：相同 props、state、context 输入应得到相同 JSX，不在渲染阶段执行副作用。
- 不直接修改 props、state、Hook 参数或已经传给 JSX 的值；更新对象或数组时创建新值，再通过 setter 或父级数据流传递。
- Hook 只能在函数组件或自定义 Hook 顶层调用，不放在条件、循环、嵌套函数、事件处理器、`try/catch/finally` 或早返回之后。
- 自定义 Hook 命名使用 `useXxx`，只封装可复用的状态逻辑或外部系统订阅逻辑，不把普通工具函数伪装成 Hook。
- 组件定义不要嵌套在另一个组件内部，避免每次渲染创建新组件类型并意外重置子树状态。
- 复杂状态流转需要拆到 helper、service 或领域组件中，避免把大量协议映射和副作用堆在页面组件里。

## 状态与 Effects

- 相关状态总是一起变化时，优先合并成一个状态对象或 reducer 状态。
- 避免互相矛盾、重复或冗余的状态；能从 props 或现有 state 计算出的值，优先在渲染阶段计算。
- 列表选中、详情引用等场景优先在 state 中保存稳定 ID 或 index，再从数据源派生对象。
- 深层嵌套状态更新困难时，优先考虑扁平化或拆分领域状态。
- Effect 主要用于同步 React 外部系统，例如浏览器 DOM、网络、订阅、计时器、第三方 UI 库或本机能力。
- 不用 Effect 做纯派生数据计算，也不把用户事件专属逻辑放进 Effect；事件导致的请求、通知或跳转优先写在对应事件处理器里。
- Effect 涉及订阅、计时器、异步请求或外部资源时，需要提供清理逻辑，避免重复订阅、竞态和组件卸载后的状态更新。
- 异步 Effect 需要取消或忽略过期响应，避免卸载后继续 setState。
- 需要主动重置某个子树状态时，优先使用稳定且语义明确的 `key` 控制重置边界。
- 复杂列表项必须使用稳定业务 key，不使用数组 index 作为会随排序、插入或删除变化的 key。

## 新增模块流程

1. 先读后端最近似 Controller、VO、BO 和业务文档，确认路径、权限、分页、导出、删除、日期范围和字段可空性。
2. 定义领域类型，按 `VO`、`BO`、分页查询和分页响应拆分。
3. 在 Mock 数据目录准备足够覆盖列表、详情、状态和边界的中文 Mock 数据。
4. 实现 Mock 服务，行为要贴近后端分页、搜索、删除和导出限制。
5. 实现真实 API 服务，路径和方法对齐后端 Controller。
6. 做 Mock/API 切换导出，或接入目标项目既有 API 导出方式。
7. 新增 List、Create、Detail 等页面，并通过模块入口导出。
8. 在路由入口注册页面，并按需更新主布局菜单、面包屑和按钮权限标识。
9. 用目标项目既有组件和状态模式补齐加载、错误、空状态、分页、确认弹窗、权限展示和导出下载。

## 前后端对齐检查

- 路径是否与 Controller 的 `@RequestMapping` 和方法路径一致。
- 权限标识是否与后端 `@PreAuthorize` 或权限配置一致。
- 列表接口是否传递后端期望的分页字段和 `params` 日期范围。
- 新增/编辑字段是否与 `BO` 分组校验一致，必填、长度、邮箱、XSS 等校验不只放前端。
- 返回字段是否与 `VO` 一致，没有前端自造字段或遗漏后端展示字段。
- 删除前是否符合后端删除前校验和批量删除格式。
- 导出是否使用后端 `POST /export`，并带上当前筛选条件。
- 字典、状态、枚举、数据权限和空值展示是否与后端语义一致。

## 工具与检查

- 项目使用 ESLint 时必须启用 `eslint-plugin-react-hooks` 或等价规则，保护 Hooks 调用顺序和依赖边界。
- 优先运行目标项目已有命令，例如：

```powershell
npm run typecheck
npm run lint
npm run test
npm run build
```

- 如果项目使用 pnpm，则优先运行：

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

- 如果项目没有对应命令，至少运行 TypeScript 检查或生产构建。
- 涉及页面和交互时，用浏览器验证登录、路由跳转、搜索、分页、创建、编辑、删除、错误态和 Mock/API 切换，并执行运行态视觉验证。
- 无法执行验证时，最终说明缺少的依赖、命令或环境变量。

## 测试

- 新增或调整核心交互、协议映射、状态合并、历史回填、附件处理、权限控制和错误展示时，需要补充自动化测试。
- 使用项目既有测试框架，例如 Vitest、Jest、React Testing Library 或 Playwright。
- 测试名称需要表达用户可见行为或协议边界，避免只描述实现函数名称。
- 组件、Hook、服务和领域模型的单元/组件测试默认与被测文件同目录，使用 `*.test.ts` 或 `*.test.tsx`；只有项目既有结构明确使用 `__tests__` 或集中测试目录时才跟随现状。
- 跨页面流程、浏览器行为和端到端测试放在项目既有 e2e 目录，例如 `tests/e2e/`、`src/e2e/` 或 Playwright 配置指定目录，不混入组件单元测试文件。
- 测试全局 setup、mock server 和通用 render helper 放在 `src/test/` 或项目既有测试基础设施目录；只服务单一领域的 fixture、builder、assertion helper 放在该领域目录内并用 `.testSupport.ts` 等名称标明测试专用。
- 测试文件同样遵守通用规范的 1000 行硬上限；超过 800 行要按行为、协议、适配器、状态分支或 fixture 拆成多个测试文件，避免单个巨型快照或全场景测试文件。

## 官方参考

- React Components and Hooks must be pure：https://react.dev/reference/rules/components-and-hooks-must-be-pure
- React Rules of Hooks：https://react.dev/reference/rules/rules-of-hooks
- React eslint-plugin-react-hooks：https://react.dev/reference/eslint-plugin-react-hooks
- React Choosing the State Structure：https://react.dev/learn/choosing-the-state-structure
- React You Might Not Need an Effect：https://react.dev/learn/you-might-not-need-an-effect
- TypeScript strict：https://www.typescriptlang.org/tsconfig/#strict
- Google TypeScript Style Guide：https://google.github.io/styleguide/tsguide.html
- typescript-eslint Rules：https://typescript-eslint.io/rules/
- Vitest Getting Started：https://vitest.dev/guide/
- Create React App Running Tests：https://create-react-app.dev/docs/running-tests/
