---
name: dsh-extension
description: 理解 DeepSeek Harness（DSH）的架构与扩展点，并按官方规范做二次开发：判断一个功能该落在哪个扩展点与哪个包，新增工具 / 服务 / LLM 适配器 / Remote API / 设置页 / 客户端 slot / 组合包 / profile patch，或评审既有插件是否合规。用户提到 DSH、deepseek-harness、Cordis 插件、扩展点、capability seam、cordis.patch.yml、dsh.client、dsh plugin add、reference/subsystems 文档时使用。
---

# DSH 架构理解与二开扩展

DSH 是「无特权内核」的 Cordis 插件树：模型适配器、工具注册表、会话日志、agent loop 本身都是插件，每一项都能从组合里替换。因此**二开的正确姿势永远是「把新插件挂到既有扩展点旁边」，而不是改循环本身**。

## 何时用 / 何时不用

- 用：判断「这个功能该落在哪个包 / 哪个扩展点」；新增或修改插件、工具、服务、模型提供方、设置页、客户端面板、组合包、profile patch；评审二开代码是否符合规范；排查「插件装了但没生效」。
- 不用：DSH 的日常使用问题（去 `/guide`）；只是读某个业务仓库的普通前后端代码。

## 第 0 步：先定位权威页，再回答

| 你要回答的问题 | 权威页 | URL |
|---|---|---|
| 整体结构、扩展点归属、轮次流程 | 架构 | `https://deepseek-harness.github.io/deepseek-harness/reference/` |
| Cordis 五概念、waterfall 语义、`!!js` 配置 | Cordis 入门 | `…/reference/cordis-primer` |
| 「X 该用什么机制」总表 | 扩展实操手册 | `…/reference/cookbook/extension-cookbook` |
| 功能 ↔ 能力 ↔ 包 的完整对照 | 能力 seams | `…/reference/capability-seams` |
| 新增包/工具的逐文件清单 | cookbook | `…/reference/cookbook/adding-a-package`、`adding-a-tool`、`adding-an-llm-adapter`、`adding-a-settings-card` |
| 新增浏览器 → 宿主 API | cookbook | `…/reference/cookbook/adding-a-remote-api` |
| 本体（非 API）教程：写第一个插件 / 配置 / 打包 | 开发 | `…/develop/basic/{index,config,tool,publish}` |
| 生命周期状态机、服务与依赖、事件分发 | 开发 | `…/develop/framework/{index,service,events}` |
| 某个 `ctx.*` 的精确签名与事件 | 子系统页（每页底部有生成的 Cordis API 段） | `…/reference/subsystems/<name>` |
| 配置字段 / 工具 schema / 会话事件全量 | 生成参考 | `…/reference/{config-catalog,tool-catalog,persistence-catalog}` |

网站是 `deepseek-harness-master/docs/` 的投影（英文主文件 + `.zh.md` 对侧）。**在仓库里 grep 本地 docs 比抓网页快**，抓网页只在需要确认线上最新版时用。

## 骨架四句（先建立这个心智模型）

1. **一切皆插件**：插件 = 导出 `apply(ctx, config)` 的对象，可带 `name` / `inject` / `Config`。`inject` 里的服务就绪后 `apply` 才跑；服务消失则插件自动 dispose，恢复后自动重载。
2. **注册即副作用**：`ctx.tools.register()`、`ctx.on()`、`ctx.effect()`、`ctx.slots.register()` 都挂在当前 fiber 上，卸载 / HMR 时自动撤销。**没有手动 removeListener**。
3. **只有三类扩展点**：服务方法（直接能力调用）、类型化事件（拦截与策略，waterfall 必须 `next()`）、能力 seam 的提供方/消费方（替换一件能力）。新行为一律挂在文档化的点上。
4. **组装是分层的**：`profile` 列出有序 `bundles` → 每个 bundle 的 `cordis.patch.yml` → profile 自己的 `cordis.patch.yml` → `$DSH_HOME/cordis.patch.yml` → 每个 `--patch`。后层按行 `id` 覆盖，**patch 替换整行 `config`，不深合并**。

## `ctx` 表面速查

| key | 能力 | 典型扩展 |
|---|---|---|
| `ctx.tools` | 工具注册表 + 受保护执行流水线 | 加工具、加策略钩子（R1/R2） |
| `ctx.llm` | 模型词汇表与 adapter seam | 接新模型提供方（R4） |
| `ctx.agents` / `ctx.sessions` | 活跃 Agent 注册表 / 只追加会话日志 | UI、协议驱动、历史读取 |
| `ctx.systemPrompt` | 提示词分段与工具 schema 组装 | 让模型看到新上下文 |
| `ctx.compaction` / `ctx.subagents` / `ctx.jobs` / `ctx.workflowEngine` | 压缩 / 子智能体 / 后台任务 / 工作流 | 编排类扩展 |
| `ctx.fs` / `ctx.shell` / `ctx.subprocess` / `ctx.sandbox` / `ctx.terminals` | 执行世界 | 换执行后端（会同时搬走 bash/PTY/LSP） |
| `ctx.webServer` / `ctx.connection` | 浏览器 HTTP 载体 / 鉴权与 Peer | 自定义路由（**必须接 `connection` 校验**，见反模式） |
| `ctx.settings` / `ctx.credentials` | 用户设置 / 凭据引用（值不出宿主） | 设置页与密钥（R6） |
| `ctx.skills` / `ctx.commands` / `ctx.goals` / `ctx.schedule` | 技能 / 人类命令 / 目标 / 定时 | 能力封装 |
| `ctx.slots` / `ctx.locale` / `ctx.layout`（浏览器侧） | UI 组合 / 文案字典 / 面板选择 | 客户端面板（R7） |

## 决策表：我要加 X

| 目标 | 机制 | 落在哪 | recipe |
|---|---|---|---|
| 面向模型的新能力 | `ctx.tools.register(defineTool(...))` | 新工具包 `packages/<组>/tool-<name>` | R1 |
| 允许/拒绝/询问一次工具调用 | `tools/pre-execute` waterfall 返回类型化决策 | 钩子插件 | R2 |
| 不可撤销的最终拒绝 | `ctx.tools.guard()` | 钩子插件 | R2 |
| 超时/重试/指标（环绕分发） | `tools/execute` waterfall | 包装插件 | R2 |
| 结果变换 / 附加模型可见上下文 | `tools/post-execute` | 包装插件 | R2 |
| 只观察最终结果（审计/遥测） | `tools/result`（不可变） | 观察插件 | R2 |
| 新服务给别的插件用 | 继承 `Service`，`super(ctx, '<key>')`，声明合并补 `ctx` 类型 | 服务提供方包 | R3 |
| 接新模型提供方 | `ctx.llm.registerAdapter([...], adapter)` | `packages/llm/llm-<vendor>` | R4 |
| 浏览器需要宿主数据/动作 | Typert `TypertRemoteService` + `@Remote` | `packages/api/<domain>-controller` | R5 |
| 用户可编辑的配置 | 导出 `Config` schema（可 `volatile()` 热更） | 任何插件 | R6 |
| 密钥 | 凭据引用 `CredentialRef`，绝不进配置/schema | 任何插件 | R6 |
| 设置页 | `settings.section`（整页）/ `settings.general.item`（单行） | 客户端包 | R7 |
| 左侧栏入口 + 主面板 | `main`（keyed）+ `sidebar.panellist`（list，id = 面板 key） | 客户端包 | R7 |
| 工具结果的自定义卡片 | keyed slot `tool.call.toolview` + 持久 `presentationMeta` | 客户端包 | R7 |
| 对话里的新消息类型 | `ConversationNodeDefinition` + `conversation.chat.node` renderer | 客户端包 | R7 |
| 把一套能力交付给别人 | 组合包（`dsh.bundle`）+ `dsh plugin add` | 树外包 | R8 |
| 只改现成组合的值 | `cordis.patch.yml` 按 `id` 覆盖（重述整份 config） | profile / overlay | R8 |
| 接外部工具协议 | `@deepseek-ai/dsh-mcp-client` 一行 YAML | profile patch | R9 |
| 想让 agent 按需装载一套指令 | 新建 skill（`<root>/skills/<name>/SKILL.md`） | skill 目录 | R10 |

## 三条二开路径

**A. 仓库内新包**（要进产品、要跑门禁）——逐文件清单见 `adding-a-package`。要点：`packages/<组>/<pkg>/` 下 `package.json`（`private:true`、`type:module`、`main:lib/index.js`、`types`、`files`）+ `tsconfig.json`（extends `tsconfig.base.json`，client 包 extends `tsconfig.base.client.json`）+ `src/index.ts` + `README.md`（含 Model Experience 段）；再在 `tsconfig.host.json` 或 `tsconfig.client.json` 的 `references` 加一行；client 包还要在 `packages/bundle/web-app/cordis.patch.yml` 加 `dsh.client` 行并在该 bundle 的 `package.json` 加依赖。

**B. 树外组合包**（自己的插件，不要 fork）——最小 `package.json`：

```json
{
  "name": "my-plugin", "version": "0.1.0", "type": "module", "main": "lib/index.js",
  "exports": { ".": "./lib/index.js", "./client": "./lib/client.js", "./cordis.patch.yml": "./cordis.patch.yml", "./package.json": "./package.json" },
  "files": ["lib/", "cordis.patch.yml"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" }, "client": { "platform": "web", "inject": ["@deepseek-ai/dsh-client-ui-layout"] } },
  "peerDependencies": { "@deepseek-ai/cordis": "^4.1.0", "@deepseek-ai/schemastery": "^3.19.0", "react": "^18.2.0" },
  "devDependencies": { "@deepseek-ai/cordis": "^4.1.0", "@deepseek-ai/schemastery": "^3.19.0" },
  "engines": { "dsh": ">=0.2.2 <0.3.0" }
}
```

`dsh plugin --profile web add ./my-plugin` → `dsh --profile web --dump-config` 看到自己的层 → 重启 + 刷新。**`engines.dsh` 不是可选项**：没有它，安装时退化为检查 `@deepseek-ai/dsh*` peer 范围，而你通常一个都没声明，等于任何版本都放行。git 安装拉的是源码，需要 `prepare` 脚本自包含构建；库文件用预构建 + npm/tarball 分发则不需要。

**C. 只改配置**：写 `cordis.patch.yml`，按 `id` 定位行、重述整份 `config`；`!!js` 只能用在该行 `config` 与 `disabled` 下。想换环境组合用 overlay，不要改发布出来的 bundle。

## 12 条硬规则（违反会在 review 或运行期炸）

1. **注册即 effect**：任何贡献都要能通过 `ctx.effect()` / `ctx.on()` / 注册返回值撤销；注册类要证明 dispose 后确实移除。
2. **waterfall 必须 `next()`**：`agent/pre-step`、`agent/request`、`llm/stream`、`tools/pre-execute`、`tools/execute`、`tools/post-execute` 都是环绕中间件；不调 `next()` 就是短路（只有拥有决策权时才故意这么做）。`agent/turn-stopping` 是 serial，没有 `next()`。
3. **模型可见即已记录**：任何进入模型请求的新输入都必须能从会话日志重建 → 要新增 `SessionEvent`，不能只改内存状态。`SessionEventMap` 成员默认 required-on-read，除非带 `ignorable: true`。
4. **没有硬编码可调参数**：部署可能改的值必须是 `Config` 字段；自检问题——「不改代码，能在 `cordis.yml` 里改吗？」
5. **显式优于隐式**：默认值写在 `Config` schema 里，或由一个显式的 `resolve(request): Spec` 步骤产生；不要在 `run()` 里 `?? default`。
6. **配置错误要响亮**：在 schema 里表达自洽约束，加载期失败；不要静默跳过缺失的引用对象。
7. **导出 `Config`**：Cordis 只在插件导出 schema 时校验并填默认值；不导出 = 不校验、不填默认、设置页拿不到表单，代码里再抄一份默认值就变成两处真相。
8. **seam 三角齐全**：一个能力 seam = Service Definition + Provider + Consumer；单角色不算 seam。业务分支留在业务包，不塞进 dispatch 层。
9. **跨包只走文档化通道**：别的功能插件的运行时值一律不 import、不 re-export；UI 走 slot，行为走注入的服务或事件。
10. **客户端两条铁律**：所有产品文案进 typed locale 字典、经 `t` 或已本地化的 prop 到达组件；样式只用 `--dsw-alias-*` 语义 token + CSS Module，禁止颜色字面量、组件库、Tailwind。
11. **客户端 bundle 只用基座模块**：`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、`zod`、`@tanstack/react-virtual`、`dsh-client-{store,ui-slots,ui-primitives,ui-dockkit}`。非基座的精确请求才写进 `dsh.client.external`，而它**不是**功能依赖机制。
12. **持久化格式只能前进**：不得移动/覆盖/删除已提交的 generation；改 `SessionEventMap` 同版本要保证旧 reader 安全，跨版本要走相邻迁移 + 双 SDK 投影。

## 二开高频错误（真实审查里反复出现）

| 症状 | 正确做法 |
|---|---|
| `Config` 没 export，代码里再写一份默认值 | 导出 schema，删掉手抄默认值；路由/服务只读 `config` |
| 自建 `/api/*` 路由只做 origin 白名单，还硬编码 `127.0.0.1:3080` | 每条路由先用 `ctx.connection.requestRejection({ headers })`（403/401/undefined）或 `admit()` 取 Peer；绑定地址用 `ctx.webServer.getOrigin()`，不要写端口 |
| bundle 缺 `engines.dsh`；`schemastery`/`cordis` 标 `optional:true` 却运行时 import | 声明 `engines.dsh`；运行时真正 import 的 peer 不能 optional，并镜像到 `devDependencies` |
| 设置页/卡片写死中文，注册时不带 `locale` | `ctx.locale.register(ns, { zh, en, ... })` + `ctx.locale.bind(ns)`，`t('key', { count })` 用参数占位而不是 `.replace('{count}', …)` |
| inline style + `#1769aa` / `rgba()` / `#fff` | CSS Module + `--dsw-alias-*`；`style` 只放运行期计算值 |
| 为兼容旧 API 保留 `connection.api.credentials` 之类猜测分支 | 只保留当前存在的服务；假想兼容层是负债 |
| 失败一律 `200 { ok: false }` | 校验错误 4xx、上游/内部 5xx；错误用带稳定 `code` 的 `HarnessError` / `RemoteError` |
| 自建 `/api/<x>/icon` 提供包内图片 | 走 `"./assets/*": "./lib/assets/*"` + `/plugins/<pkg>/assets/...`（immutable + etag + nosniff），插件卡片图标走 `icon` 导出 |
| README 声称的能力比实现多（如「多选/组合问答」其实是单选） | 文案跟实现对齐，或删掉不可达分支 |
| 零测试，纯函数（解析器、限流、校验）也不测 | 纯函数单测 + 一条真实组合（Loader + profile）冒烟；UI 变更再加 `test:gui` |
| 客户端 bundle 改了不重建就刷页面 | registry 提供的是 `lib/client.js`，不是源码；先 build 再刷 |
| iframe 嵌入第三方站点无 `sandbox`/`referrerpolicy` | 至少加 `sandbox`、`referrerpolicy="no-referrer"`，并说明为什么必须嵌 |

## 验证

| 场景 | 命令 / 动作 |
|---|---|
| 仓库内改包 | `pnpm run build:artifacts` → `pnpm run build:check`；`pnpm run typecheck && pnpm run lint`；改 UI 加 `pnpm run test:gui`；改可见输出加 `DSH_SNAPSHOT=replay pnpm run test:web`；改文档 `pnpm run doc-sync` |
| 树外插件 | `dsh plugin --profile web add <dir>` → `dsh --profile web --dump-config`（应出现自己的层）→ 重启 → 刷新 → 设置 → 插件页看同步失败 |
| 配置改动 | 改 `cordis.patch.yml` → HMR 重载插件（注册自动撤销） |
| 客户端改动 | 重新构建 `lib/client.js` → 刷新页面（HMR 只跟踪已发布 bundle 的变化） |
| 组合是否正确 | `dsh --profile <p> --dump-config` 里逐层核对，后层按 `id` 覆盖、整份 config 替换 |

## References

- `references/architecture.md` — 分层、包分组、轮次流程、事件三域、seam 表、会话日志与投影、客户端模块图
- `references/extension-recipes.md` — R1–R10 分步 recipe（工具 / 策略 / 服务 / LLM / Remote API / 设置与凭据 / 客户端面板 / 组合包 / MCP / skill）
- `references/review-checklist.md` — 二开代码自检清单（清单 → 配置 → 宿主 → 客户端 → 文档 → 测试）
