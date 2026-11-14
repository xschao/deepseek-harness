# DSH 架构：读这一页就够用了

权威原文：`https://deepseek-harness.github.io/deepseek-harness/reference/`（本地镜像 `docs/architecture.zh.md`）。

## 1. 组装：profile、组合包、层序

运行中的 `dsh` 是一棵**按层叠加**出来的插件树：

1. profile 的 `dsh.profile.bundles` 列表，按顺序——`@deepseek-ai/dsh-base` 在前，然后是每个已安装组合包（按加入顺序）
2. profile 自己的 `cordis.patch.yml`
3. `$DSH_HOME/cordis.patch.yml`（跨 profile 的机器本地偏好）
4. 每个 `--patch <path>` overlay，按 argv 顺序

- **profile**：`$DSH_HOME/profiles/<name>`，manifest 声明 `dsh.profile`。随附模板 `web` / `headless` / `sdk` / `sdk-minimal` / `acp`。
- **组合包（bundle）**：npm 包，manifest 声明 `dsh.bundle.patch`，回答「这个包贡献什么」。
- **同一件事不会既是 profile 又是 bundle。**
- 一条 patch 按 `id` 定位行、**替换该行整个 `config`**（不深合并）；因此覆盖别人的行必须重述它需要的每个键。`preset` patch 在目标行的 `config.plugins` 内应用同样规则。
- `!!js` 只在插件行的 `config` 和条目的 `disabled` 下生效；其他元数据保持字面值；按环境选插件用 overlay。

查看真实树：`dsh --profile web --dump-config`。它打印出的任何条目都可以被自己的 patch 替换。

## 2. 包分组（`packages/<group>/<pkg>/`）

| 组 | 职责 |
|---|---|
| `core/` | agent / session / system-prompt / tools / scope / agent-loop |
| `api/` | 远程 BFF 与 Remote controller（Typert） |
| `typert/` | 类型图与远程调用描述符 |
| `llm/` | 模型提供方（`llm` 是 seam 定义，`llm-<vendor>` 是实现） |
| `shell/` `subprocess/` `ssh/` `terminal/` `sandbox/` `ptc-runtime/` | 执行世界 |
| `fs/` `lsp/` `computer-use/` `browser-use/` | 文件、导航、桌机与浏览器操作 |
| `web/` `skill/` `workflow/` `subagent/` `team/` `jobs/` `todo/` `plan/` `goal/` `schedule/` `preset/` `guard/` `extensions/` | 面向模型的能力与编排 |
| `session/` `session-query/` `attachment/` `spill/` `storage/` `workspace/` `feedback/` `identity/` | 持久化与数据 |
| `settings/` `credentials/` `approval/` `interaction/` `user-questions/` | 策略、设置、人工交互 |
| `boot/` `sdk/` `host/` `client/` `acp/` `mcp/` | 启动、载体、GUI、协议 |
| `bundle/` | profile 的层（`base` / `web-app` / `headless` / `sdk-app` / `acp-app`） |
| `util/` `test-support/` `experimental/` | 零依赖工具、测试基建、无产品承诺的评估能力 |

## 3. 轮次流程（turn / step）

一个 **step** = 一次模型请求 + 它调用的工具；一个 **turn** = 零或多个 step（领取首条输入时开，欠债清零时关）。

```text
turn/start
  claim next-step input + one queued message
  assemble prompt sections + step-admitted tool schemas
  -> agent/pre-step (waterfall; reject | enter(messages, startsRequestSeries?))
  step/start
  agent/request (waterfall; 已废弃，只调控制参数)
  -> 绑定 prepareCall，提交 system/message 与 user/message
  -> 记录 request/header、request/context，冻结模型历史
  stream -> llm/stream -> agent/assistant-stream (start / chunk* / end)
  assistant/message | assistant/attempt
  tool/call* -> tools/pre-execute -> guards -> tools/execute -> tools/post-execute -> tool/result*
  step/end
  （欠另一次请求，或新输入到达）-> 下一个 step
-> agent/turn-stopping（serial，可通过 steering 触发下一步）
turn/end
```

持久事件：`turn/*`、`step/*`、`system/message`、`user/message`、`assistant/message`、`assistant/attempt`、`tool/*`。其余是实时扩展点。

## 4. 事件三域

| 域 | 例子 | 何时用 |
|---|---|---|
| 会话事件（持久，`session/event` 广播） | `turn/start`、`assistant/message`、`tool/result`、`todo/write`、`fs/observed` | 事实必须跨 reload 存活 |
| Agent 事件（`agent/*`，携带活跃 `Agent`） | `agent/created`、`agent/pre-step`、`agent/request`、`agent/assistant-stream`、`agent/turn-stopping` | 观察或拦截进行中的工作 |
| 能力事件（`fs/*`、`tools/*`、`telemetry/*`、`webserver/*`、`connection/*`） | 见各子系统页 | 给某条 seam 挂策略或适配器，避免循环依赖 |

分发模式（写错就是 bug）：`emit`（不 await、无返回）、`waterfall`（环绕中间件，返回决策）、`parallel`（await、扇出）、`serial`（await、顺序、有返回）、`bail`（停在首个 bail 值）。waterfall 监听器**必须** `next()` 才委托；不调用即短路。

## 5. 能力 seam 一览

一个 seam = **Service Definition**（接口）+ **Service Provider**（实现）+ **Consumer**（通常是面向模型的工具）。换一个提供方就能整体改变产品行为——例如把 `fs` + `subprocess` 指向远程沙箱，bash / PTY / LSP 会一起搬过去。

| seam (`ctx` key) | 说明 |
|---|---|
| `tools` | 工具注册表 + 受保护执行流水线 |
| `llm` | 消息词汇表、流式 chunk 协议、adapter seam |
| `agents` / `agentLoop` / `sessions` | Agent 接口与注册表 / 默认驱动器 / 只追加会话日志 |
| `fs` / `shell` / `subprocess` / `terminals` / `sandbox` | 文件与执行 |
| `webServer` / `connection` | 浏览器 HTTP 载体 / 鉴权、Peer、`/api` 桥 |
| `clientModules` / `modules` | 浏览器插件表（宿主半 / 浏览器半） |
| `subagents` / `workflowEngine` / `jobs` | 编排 |
| `approval` / `userQuestion` / `commands` | 一次性审批 / 人工提问 / 人类命令 |
| `settings` / `credentials` / `sessionPersistence` / `storage` | 用户设置 / 凭据 / 会话持久化 / 非会话存储 |
| `skills` / `goals` / `schedule` | 技能 / 目标 / 定时 |

## 6. 会话日志（最容易被破坏的不变量）

- 会话日志是模型所见上下文的**唯一来源**；`deriveMessages()` 从日志投影模型历史。
- 每个 `assistant/message` 内嵌产生它的紧凑 stream；`assistant/attempt` 保留失败/重试/取消的 settlement，不增加模型历史。
- **模型可见即已记录**：为模型新增输入 = 新增会话事件。修改已有消息内容要注册**纯消息投影**（`ctx.sessionProjections`），独立读取器显式传入同样的处理器。
- 工具变更不依赖能力；Session 工具历史由提供方声明。
- fork / 恢复 / transcript / 遥测 / 持久化都从持久 settlement 派生；实时 UI 增量来自 `agent/assistant-stream`。
- 格式：JSONL v0 `session.jsonl[.zstd]`，v1+ `session.vN.jsonl[.zstd]`。**已提交 generation 绝不重命名、替换、删除**；迁移只能是相邻 `vN -> vN+1`，写 open 时在旁边排他发布后继。

## 7. 客户端（浏览器）栈

三层，单向依赖：

1. **数据对象层**（React-free）：`client/connection` 管传输代际，`api/session-controller/client` 管 `ClientSessions`，`api/workspace-controller/client` 管 Workspace，`client/store` 是快照 store 引擎。
2. **渲染机制**：`ui-renderer` + 动态插件——slot 渲染、`SessionProvider`、uSES 适配。**业务代码不得产生对它的值依赖。**
3. **展示组件**：各插件的 `src/client/`，纯 props，可整体重写。

浏览器插件如何到达页面：

- 包在自己的 `package.json` 声明 `dsh.client`（`platform: 'web'`、可选 `inject` 包名边、可选 `immediately`）并导出 `./client`。
- 宿主扫描已启用的 Loader 条目 → 组合出 `window.__DSH_BOOT__` → 在 `/plugins` 下提供带 revision 的 combo 脚本。
- 构建产物必须是 **lazy-CJS factory**：`window.__ModuleLoader__.load({ id: <包名>, factory: (require) => … })`；执行 bundle 只注册 factory，模块副作用在物化时才跑。
- 只允许基座模块（`PLATFORM_MODULES`）：`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、`zod`、`@tanstack/react-virtual`、`@deepseek-ai/dsh-client-{store,ui-slots,ui-primitives,ui-dockkit}`。基座外的第三方库**默认打进自己的 bundle**；`dsh.client.external` 只给基础设施/传输/生成装配用。
- slot 幂等：`ctx.slots.inject(key, () => ctx.slots.register(...))` 等待声明出现、随声明消失而移除、重新声明后再跑。向未声明的 slot 注册 = 加载期失败。
- 包资源（图片）：`"./assets/*": "./lib/assets/*"` + `/plugins/<pkg>/assets/<path>`（immutable + etag + nosniff）；插件卡片图标走清单顶层 `icon`。

## 8. 客户端与宿主的边界

- 浏览器不能直接拿宿主对象：要么走 `@Remote` 生成的 `ctx.remote.<ns>.*`（带鉴权），要么用 `ctx.webServer` 注册路由——**后者必须自己接 `ctx.connection` 的 Host/Origin 校验与会话认证**，服务器本身不提供认证。
- 平台默认 `Content-Type: application/json` 的 `/api` 前缀由 Connection 拥有；`kind:'exact'` 的具名路由优先于前缀匹配。
- 路由注册冲突（同 `kind + path`）直接抛异常；一个 `(kind, path)` 只能有一个所有者。
