<!-- @author kongweiguang -->

# React / TypeScript 规范来源

## 读取时机

- 当团队需要把 React/TypeScript 规范解释成“开发手册”时读取。
- 当项目约定、官方规则和第三方风格指南出现冲突时读取。
- 普通页面开发只按 `SKILL.md` 执行，不需要加载本文件。

## 一手来源

- React 官方 `Components and Hooks must be pure`：组件和 Hook 要保持幂等，渲染阶段不能有非本地副作用，props/state 不可直接修改。
- React 官方 `Rules of Hooks`：Hook 只能在函数组件或自定义 Hook 顶层调用，不能放进条件、循环、事件处理器、嵌套函数、`try/catch/finally` 或早返回之后。
- React 官方 `eslint-plugin-react-hooks`：用 lint 在构建期捕获 Rules of React、`rules-of-hooks`、`exhaustive-deps` 和 React Compiler 相关诊断。
- React 官方状态结构指南：合并总是一起变化的状态，避免矛盾、冗余、重复和深层嵌套状态。
- React 官方 Effect 指南：Effect 是同步外部系统的逃生口；派生数据和用户事件不要放进 Effect。
- TypeScript TSConfig `strict`：默认作为新代码目标，提供更强的正确性保证；迁移旧代码时可以逐项收紧。
- Google TypeScript Style Guide：作为 TypeScript 可读性和团队一致性参考，尤其关注简单类型表达、少用 `any`、对象迭代和长期可维护性。
- typescript-eslint：优先使用项目既有配置或推荐配置，类型专用导入用 `consistent-type-imports` 等自动化规则承接。
- Vitest 官方指南：默认识别包含 `.test.` 或 `.spec.` 的测试文件名，具体位置按项目测试配置执行。
- Create React App 测试文档：React 生态常见做法是把测试文件或 `__tests__` 目录放在被测代码旁边，便于导入和查找；本项目把该做法作为默认测试位置规则。

## 本项目取舍

- React 官方正确性规则属于 P0，不被第三方风格指南覆盖。
- TypeScript 严格类型属于 P0/P1 之间：新长期协议和公共类型必须严格，旧代码迁移按影响范围渐进。
- Google TypeScript Style Guide 属于 P2 风格参考，不强行覆盖项目 lint、格式化或既有目录结构。
- `eslint-disable`、`@ts-ignore`、`as any` 和空依赖数组都需要说明不变量；能重构消除时优先重构。

## 参考链接

- https://react.dev/reference/rules/components-and-hooks-must-be-pure
- https://react.dev/reference/rules/rules-of-hooks
- https://react.dev/reference/eslint-plugin-react-hooks
- https://react.dev/learn/choosing-the-state-structure
- https://react.dev/learn/you-might-not-need-an-effect
- https://www.typescriptlang.org/tsconfig/#strict
- https://google.github.io/styleguide/tsguide.html
- https://typescript-eslint.io/rules/
- https://vitest.dev/guide/
- https://create-react-app.dev/docs/running-tests/
