# 二开代码自检清单

评审自己或别人的 DSH 插件时逐条过。任何一条打不上勾，都应在交付前说明理由。

## A. 清单与装配

- [ ] `package.json`：`type: module`、`main`/`exports` 指向真实产物、`files` 覆盖所有运行时 import 与资源
- [ ] 声明了 `dsh.bundle.patch`（要作为层被装载时）；要进 Web GUI 时声明 `dsh.client` 且导出 `./client`
- [ ] 有 `engines.dsh`（而不是只写 `engines.node`）
- [ ] 运行时真正 import 的 `@deepseek-ai/*` 写在 `peerDependencies`，且**不标 `optional`**，并在 `devDependencies` 同范围镜像
- [ ] `dsh.client.inject` 只列真实存在且本插件确实依赖的包（它只是信息边，不负责时序）
- [ ] `cordis.patch.yml` 的行 `id` 唯一；行级 `inject` 与插件导出 `inject` 不重复表达同一件事
- [ ] 包名/描述没有让人误以为官方出品；`repository` 与本包真实归属一致
- [ ] 需要展示元信息时提供 `locale/en.json` + `./locale/*.json` 导出，图标用 `icon` 导出（不是自建路由）

## B. 配置与凭据

- [ ] **导出了 `Config` schema**，默认值只在 schema 里出现一次
- [ ] 代码里没有第二份默认值兜底（`normalizeConfig` 式的重复实现）
- [ ] 部署可能改的值都是 Config 字段（「不改代码能在 cordis.yml 里改吗」）
- [ ] 字段语义与范围写进 schema（`min`/`step`/`default`/`check`），非法配置在加载期失败
- [ ] 密钥/令牌**不在** Config，走凭据引用；UI 从不回显明文
- [ ] 凭据 ref 名符合 `^[A-Za-z_][A-Za-z0-9_]*$`；读取面用 `resolve`，展示面用 `describe`
- [ ] 改配置后插件能热替换（注册都挂在 effect 上，不留旧实例残留）

## C. 宿主侧行为

- [ ] 所有注册都在 `ctx.effect()` / `ctx.on()` / 注册返回值里，dispose 后确实移除
- [ ] 自建 HTTP 路由：先 `ctx.connection.requestRejection({ headers })`（或 `admit()`），**没有**硬编码 host/port 白名单
- [ ] 绑定来源取 `ctx.webServer.getOrigin()` / `ctx.connection` 的判定，不猜端口
- [ ] 路由 `(kind, path)` 唯一；返回私有数据或执行操作的路由保持 `handler`
- [ ] 仅做观察的事件监听器调了 `next()`；短路是有意的（拥有决策权）
- [ ] 新增模型可见输入 ⇒ 新增/扩展了 SessionEvent，且 `deriveMessages()` 能重建
- [ ] 改了 `SessionEventMap`：考虑 required-on-read / `ignorable` / 版本与迁移；已提交 generation 未被动过
- [ ] 长任务走 `ctx.jobs`，发布后用自己的取消信号；不要用 `exec.signal` 杀已发布的工作
- [ ] 工具：返回规范 JSON、抛带 code 的 `HarnessError`、尊重 `exec.signal`、展示方法是纯函数
- [ ] 错误面：校验错误 4xx、内部/上游 5xx、结构化 code；不存在「一律 200 + ok:false」
- [ ] 没有为假想的旧版本保留兼容分支（`ctx.get('x') ?? legacy`）——只保留当前真实存在的服务
- [ ] 可选依赖用 `ctx.get()`，必需依赖写进 `inject`

## D. 客户端（浏览器半）

- [ ] bundle 是 `window.__ModuleLoader__.load({ id: <包名>, factory })` 形态，`id` 与清单名一致
- [ ] 只 require 基座模块；基座外的第三方**打进自己的 bundle**（未滥用 `dsh.client.external`）
- [ ] 跨包 slot 用 `ctx.slots.inject(key, () => ctx.slots.register(...))`，没有直接注册到未声明 slot
- [ ] 同一 slot 不存在两个同 `id`/同 `priority` 的注册路径
- [ ] 组件是模块作用域稳定函数；组件不接 `ctx`、不自建订阅、不读 React context
- [ ] 面板 `main.key` 与 `sidebar.panellist.id` 对齐；`label` 用 thunk 或已本地化文案
- [ ] 所有产品文案进 locale 字典（含设置页、按钮、空状态、aria/title/placeholder）；`t` 的占位符用参数
- [ ] 样式用 CSS Module + `--dsw-alias-*`；无颜色字面量、无组件库、无 Tailwind；菜单用 `Menu`/`MenuSurface`
- [ ] 图片走 `./assets/*` + `/plugins/<pkg>/assets/...`，未自建 icon 路由
- [ ] 异步请求有取消与超时，且超时预算不小于宿主侧（不要让浏览器先放弃）
- [ ] 第三方 iframe 有 `sandbox` / `referrerpolicy`，并说明为何必须内嵌
- [ ] 改完 bundle 已重建（registry 提供 `lib/client.js`）

## E. 文档与可维护性

- [ ] README 描述的能力 = 实际能做（没有「多选」写成单选这类漂移）
- [ ] 不可达分支（UI 到不了的组合问答、没有入口的配置项）已删除或补上入口
- [ ] 有限制项写在 README，不在代码里留 TODO 假装已实现
- [ ] 注释解释契约与原因，不复述代码；语言与仓库现状一致（仓库默认英文注释）
- [ ] 覆盖 `files` 的每个资源都真的会被用到；预构建产物与源码有同步机制且能发现漂移

## F. 测试

- [ ] 纯函数（解析、限流、校验、参数归一）有单测
- [ ] 有过一条真实组合冒烟：Loader + profile 启动后能观测到效果
- [ ] 失败路径有覆盖：拒绝、超时、取消、上游错误、畸形输入
- [ ] 注册类贡献证明了 dispose 后移除
- [ ] 面向模型/用户可见输出变更时更新了快照
