# Apple-inspired UI 统一改造完成记录

## 目标
- 统一前端基础 UI 控件的 Apple-inspired 风格，重点去除表单中原生下拉框的割裂感。
- 检查设置、工具面板、工作流、片段、远程连接、SFTP 和终端相关页面的表单控件一致性。

## 非目标
- 不改后端 API、数据模型或业务行为。
- 不引入新的大型 UI 组件库。
- 不重做信息架构或新增业务功能。

## 完成范围
- `src/App.css`
- `src/components/ui/select.tsx`
- `src/components/ui/switch.tsx`
- 设置、LLM Provider、远程连接、工作流、片段、AI 工具和运行健康卡中的表单控件
- 相关前端测试

## 执行结果
- [x] 建立共享 Apple 风格 Select 和 Switch。
- [x] 替换原生 `<select>` 为统一下拉组件。
- [x] 替换应用源码中的原生 checkbox 为统一 switch。
- [x] 调整全局 theme token 和基础 Button 主色、二级按钮质感。
- [x] 补充 Select/Switch 单元测试并更新相关交互测试。
- [x] 通过 Chrome headless 预览设置页、下拉浮层和 switch。

## 验证
- `npm run typecheck`
- `npm run test:frontend -- --run`
- `npm run build`
- Chrome headless 访问 `http://127.0.0.1:5178/`，打开设置弹窗并展开“界面语言”下拉，无 console/page errors。

## 风险
- 自定义下拉目前使用组件内绝对定位，极端窄容器或靠近滚动容器底部时仍需后续实机检查浮层裁切。
- Vite 生产构建仍提示 mermaid chunk 超过 500 kB，此为既有体积提示，不属于本次 UI 改造引入的问题。
