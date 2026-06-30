---
name: bwy-frontend-development
description: |
  用于前端开发任务，例如页面、组件、路由、表单、弹窗、表格、样式、接口调用、界面状态、原型还原、截图对照或浏览器验证。
---

# 前端开发能力

## 工作流程

1. 修改前先读项目文档，以及最近似页面、组件、API 模块。
2. 追踪真实数据路径：UI 事件 -> 接口客户端 -> 后端契约 -> UI 状态/渲染。
3. 保持项目既有设计系统和组件库。
4. 实现完整用户路径：路由/页面、接口客户端、类型、加载/错误状态、表单校验、空状态/错误态。
5. 如果任务要求测试/demo UI，保留有用调试状态。
6. 目标可运行时，执行类型检查/构建和浏览器验证。
7. 涉及 UI 视觉或交互时，必须运行真实页面、截图、和原型/参考并排比对，差异未消除前不提交。
8. API 契约变化要同步关注后端开发能力和文档同步能力。

## 实现规则

- 已有应用中不要擅自创造全新视觉语言，除非任务是绿地设计。
- 请求/响应类型保持明确，避免 `any`。
- 项目有 API 层时，不要在随机组件里直接请求后端。
- 权限、加载、空数据、错误、过期数据状态要可见。
- 只有当前仓库出现重复后，再抽可复用 helper。
- 麦克风、实时、流式问题先从 UI 捕获/事件分发路径查起。
- 不因局部页面需求改全局组件行为；确需改全局组件时同步检查所有调用点。
- 前端字段、枚举、空值处理必须和后端契约一致，不靠猜测补字段。

## 后台管理系统常见约定

- API 文件优先复用当前仓库统一请求工具，接口命名和路由保持后端前缀一致。
- 类型文件按当前仓库习惯定义请求、表单、查询和响应对象；分页查询对象保留仓库已有分页字段。
- 列表页保留当前仓库已有的加载、选择、搜索、分页、提交和导出状态。
- 常见行为命名沿用最近似页面，不为单个页面发明另一套事件名。
- 后端使用权限标识时，前端按钮权限指令要与后端保持一致；权限标识统一为 `${module}:${business}:${action}`。
- 日期范围查询继续沿用当前仓库现有日期范围工具和参数结构。

## 运行态视觉验证

只要改动影响页面、组件、样式、布局、状态展示或交互态，就执行这个门禁；它和 typecheck/build 一样是完成条件。

1. **运行真实界面**：启动项目现有前端 dev server，例如 `pnpm dev`、`npm run dev` 或仓库文档指定命令；已有服务占端口时换可用端口并记录 URL。
2. **截图运行页面**：用编程浏览器或 Codex Browser 打开目标路由，等待数据和字体稳定后截图；至少覆盖桌面视口，必要时补移动/窄屏视口。
3. **打开参考源**：如果任务有原型 HTML、Figma 截图、设计图、旧页面或用户给的图片，同时打开并截图。没有参考源时，以最近似页面和项目设计系统为对照。
4. **逐项比对**：检查布局分区、主辅色和状态色、间距留白、字号字重行高、控件类型、文案、图标、表格/卡片语义、hover、active、disabled、loading、empty、error、权限态和弹窗/抽屉层级。
5. **循环修正**：发现关键差异就改，改完重新截图再比；关键差异未消除时，验证结论是 fail，不能提交或标记任务完成。
6. **记录证据**：在 `verification.md` 或 `tasks.md` Round Log 写入运行 URL、截图路径、参考源、已比对状态、剩余差异和是否接受。

Web 前端默认用浏览器截图；原生桌面或 WebView 外壳用运行窗口截图。不要只根据代码阅读判断视觉完成。

## 常用例子

列表页状态清单：

```ts
const [loading, setLoading] = useState(false)
const [rows, setRows] = useState<ItemVo[]>([])
const [total, setTotal] = useState(0)
const [queryParams, setQueryParams] = useState<ItemQuery>({
  pageNum: 1,
  pageSize: 10,
  params: {},
})
```

API 服务封装：

```ts
export function listItem(query: ItemQuery) {
  return request<TableDataInfo<ItemVo>>({
    url: '/biz/item/list',
    method: 'get',
    params: query,
  })
}

export function updateItem(data: ItemForm) {
  return request<R<void>>({
    url: '/biz/item',
    method: 'put',
    data,
  })
}
```

前后端契约核对：

```markdown
- 路径：GET /biz/item/list
- 权限：biz:item:list
- 查询：pageNum、pageSize、params.beginTime、params.endTime
- 返回：TableDataInfo<ItemVo>
- 页面状态：loading、empty、error、pagination
```

## 验证

优先使用项目本地脚本：

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

如果本地目标明确，用 Codex Browser 打开并验证变更流程。涉及 UI 时执行运行态视觉验证；无法运行或截图时，说明缺失依赖、失败命令或环境限制。
