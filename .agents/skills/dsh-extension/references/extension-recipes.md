# 扩展 recipe（R1–R10）

每个 recipe 给出：适用判据 → 最小形态 → 必守约定 → 验证。细节以链接的官方页为准，这里只保留「写代码时必须照着做」的部分。

---

## R1 加一个面向模型的工具

**判据**：模型需要主动调用它拿到数据或产生副作用。

```ts
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'my-tool'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'read_file',
    description: 'Read a file from disk.',        // 模型看到的就是这句
    parameters: {
      path: { type: 'string', required: true, description: 'Absolute path' },
      limit: { type: 'number' },                   // 默认可选
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      return readFile(args.path, { encoding: 'utf8', signal: exec.signal })
    },
  }))
}
```

必守约定：

- **参数已被校验**（类型/必填/字面量/联合/嵌套）。schema 表达不了的（非空串、正数、跨字段）自己用 `ToolArgsError` 拒。
- **定义注册后被借用且只读**：不要事后改 schema 或换回调；要换就 dispose 再注册。
- **执行身份受保护**：`callId`/`name`/`arguments`/`agent`/`token`/`signal`/`parent` 不可变；`args` 当只读。
- **只返回规范 JSON 值**（`output.schema` 的根可以是对象/数组/标量/null），不要返回内容块；人类可读解释放 `output.render`。
- **抛异常 = `isError`**：预期失败抛带稳定 `code` 的 `HarnessError` 子类；成功但状态不理想也要写进规范值（如退出码非零）。
- **尊重 `exec.signal`**：取消时让 `AbortError` 或 signal.reason 原样传播，不要换成普通 `Error`。
- **长任务**：`ctx.jobs.start({ kind, label, owner: exec.agent, run })`，返回 `{ kind: 'background', jobId }`；发布 id 之后用 job 自己的取消信号，不是 `exec.signal`。
- **UI 卡片另算**：`presentCall` / `presentResult` 必须是 `args`(+result) 的**纯函数**，不得 I/O、读会话、用时钟；需要结果期事实时用 `output.presentationMeta` 投影进持久 `result.meta`。
- **PTC**：`output.schema` 同时是程序化 API（`await tools.<name>(args)`），所以返回句柄与字段，别把 id 塞进自然语言。

验证：单测覆盖拒/接受路径；面向模型的文本变更要有 keyless 快照。参考 `packages/shell/tool-bash`（terminal 卡片）、`packages/fs/tool-fs`（diff/read 卡片）。

文档：`…/reference/cookbook/adding-a-tool`、`…/reference/subsystems/tools`、`…/reference/tool-catalog`

---

## R2 拦截 / 策略 / 观测

**判据**：不想改工具实现，只想改变「能不能执行、怎么执行、结果长什么样」。

执行流水线顺序：`tool/call`（先落日志）→ `tools/pre-execute`（waterfall）→ 单调 guards → `tools/execute`（waterfall，环绕分发）→ 工具体 → `projectContent` → `tools/post-execute`（waterfall）→ `finalizeContent` → `tools/result`（同步通知，不可变）→ `tool/result`（会话事件）。

| 需求 | 用 | 要点 |
|---|---|---|
| 允许 / 拒绝 / 询问 | `tools/pre-execute` 返回类型化决策 | 不拥有决策时必须 `next()`；`ask` 经 `ctx.approval` 一次性应答，缺失或无法应答 = deny |
| 不可撤销的最终拒绝 | `ctx.tools.guard()` | 单调：后注册的监听器不能撤销 |
| 超时 / 重试 / 指标 | `tools/execute` 包裹 | 可替换并恢复 `exec.signal`，但不能移除 |
| 替换展示内容、阻止结果、附加模型可见上下文 | `tools/post-execute` | 替换内容不阻止程序化访问 `value`；保密要屏蔽值本身 |
| 审计 / 遥测（只读） | `tools/result` | 结果已冻结，必须无损 JSON |

```ts
export const name = 'permission-gate'
export function apply(ctx: Context) {
  ctx.on('tools/pre-execute', async (exec, next) => {
    if (!(await isAllowed(exec))) return { kind: 'deny', reason: 'Denied by policy.' }
    return next()
  })
}
```

决策联合的精确形状以 `packages/core/tools/README.zh.md` 的 extension points 段为准（项目里以包 README / `dsh-tools` 类型为准，不要凭记忆写字段）。

---

## R3 加一个服务

**判据**：别的插件需要主动调用你的能力（而不是被动被拦截）。

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context { metrics: MetricsService }
}

export default class MetricsService extends Service {
  static inject = ['llm']                 // 服务也可以依赖服务
  constructor(ctx: Context) {
    super(ctx, 'metrics')                 // 这就是 ctx.metrics 的 key
  }
  record(event: string, value: number) { /* … */ }
}
```

- **命名**：engine/runtime/policy/controller/resolver/store 等用单数 key；registry/拥有多个具名成员的服务用复数。类名与 key 的单复数必须一致。不要用首个实现、未来扩展或 Cordis 基类命名。
- **可选依赖**用 `ctx.get('name')`，不要写进 `inject`；声明在 `inject` 里的用 `ctx.<name>`。
- **服务消失**：依赖方自动 dispose，服务恢复后自动重载——不要自己写重连轮询。
- **隔离**：`cordis.yml` 的 `isolate:` 可以让不同插件组看到同一 key 的不同实例（会话级能力集常用）。
- 一个服务如果只有内部一个调用方，改成私有闭包，别公开服务面。

文档：`…/develop/framework/service`、`…/reference/capability-seams`、`…/reference/cordis-api/service`

---

## R4 接一个模型提供方

**判据**：`llm` seam 要换/加实现。

```ts
class MyAdapter extends LlmAdapter {
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> { /* … */ }
}

export const name = 'llm-myprovider'
export const inject = ['llm']
export const Config = z.object({ apiKey: z.string(), /* … */ })

export function apply(ctx: Context, config: Config) {
  ctx.llm.registerAdapter(['my-provider'], new MyAdapter(/* … */))
}
```

协议义务（两个参考实现都验证过）：

- `usage` 必须在 `finish` **之前**发；`finish` 之后不再发任何东西。稳健做法是缓冲到提供方流结束再统一 flush。
- 工具调用 `arguments` 全程是**原始 JSON 字符串**，流式增量用 `argumentsDelta`；提供方给已解析对象就在 `block-end` 重新 stringify。
- 块 `index` 按首次出现顺序分配，同一块每次 delta 复用。
- 错误只有两条合法路径：从 `stream()` 抛 `LlmError`（传输/协议故障），或以 `finish { kind: 'error' | 'aborted' }` 结束（带内故障）。
- 尊重 `options.signal`；不支持的选项抛 `LlmError(..., 'UNSUPPORTED_OPTION')`，不要静默丢弃。
- 需要原样回放的原生元数据走 `finish.replayState`（最小无损 JSON 投影），缺失时不要按 provider/model 名字猜。
- 能力元数据用 `resolveModel()`（身份 + 可选 `context`/`reasoning`），`defaultEffort` 只在有配置默认值时声明；reasoning 强度是由适配器映射的不透明 ID，保留 `off`（支持时）。

注册是副作用：同路由重复注册抛错，多路由注册要么全成要么全败。密钥走 schemastery Config + 环境变量回退（`!!js process.env.MY_KEY`），不要读自约定密钥文件。

文档：`…/reference/cookbook/adding-an-llm-adapter`、`…/develop/practice/llm-adapter`、`…/reference/subsystems/llm-streaming`

---

## R5 浏览器 ↔ 宿主 API（Remote）

**判据**：浏览器要读宿主数据或触发宿主动作。**首选这条路，不要自己开 `/api` 路由**——`ctx.remote` 自带鉴权与类型 codec。

宿主侧（`packages/api/<domain>-controller`）：

```ts
export class NotesController extends TypertRemoteService {
  constructor(ctx: Context) { super(ctx, 'notesController', { namespace: 'notes' }) }

  @Remote('list')
  async remoteExportList(agent: Agent, signal: AbortSignal): Promise<NoteRow[]> {
    return await this.list(agent, signal)
  }
}
```

- 业务方法签名已符合 wire 约定就直接标注；只有形态要调整（补 `signal`、换参数顺序/导出名）才写 `remoteExport*` 适配器。
- lookup 对象（`Agent`/`Session`）只能占顶层参数位；支持取消的方法把 `signal` 放最后一位。
- 失败只有一个类 `RemoteError(code, message, details)`，域码经 `declare module` 并入 `RemoteErrorDetailsMap`，码名 `<域>/<理由>`；不要造异常类家族。
- 改了签名/码表/namespace/导出名要重跑 `pnpm run build:lib`。

浏览器侧：

```ts
export const inject = ['remote', 'remote.notes']
const result = await ctx.remote.notes.list()
if (!result.ok) { if (result.error.code === 'note/not-found') return []; throw result.error }
return result.value.map(row => row.title)
```

- 结果永远是 `RemoteResult<T>`，判 `code` 而不是 `instanceof`（code 分支会自动窄化 details）；不要写防御性 catch，Remote 调用不 reject。
- 不要 `Pick<ClientRemote, …>` 窄化、不要手写方法签名、不要造 wire 中转对象。

文档：`…/reference/cookbook/adding-a-remote-api`、`…/reference/api-gateway`、`…/reference/subsystems/typert`

**如果你确实必须自己注册 HTTP 路由**：`ctx.webServer.register({ kind: 'exact' | 'prefix', path, handler | resource })` 只是载体，**不做认证**。每条路由在处理前先 `ctx.connection.requestRejection({ headers: req.headers })`（返回 401/403/undefined），需要 Peer 时用 `admit()`；绑定地址从 `ctx.webServer.getOrigin()` 取，绝不硬编码端口。返回 owner 私有数据或会执行操作的路由即使应答 GET 也要保持 handler，不要做成 resource。

---

## R6 配置、热更新与密钥

**判据**：部署可能变的值、或用户要编辑的值。

```ts
export interface Config {
  endpoint: Volatile<string | undefined>
  retries: Volatile<number>
}

export const Config: Schema<Config> = Schema.object({
  endpoint: Schema.string().volatile(),
  retries: Schema.number().step(1).min(0).default(3).volatile(),
})

export function apply(ctx: Context, config: Config): void {
  ctx.on('loader/volatile-update', () => ctx.logger.info('retry %d', config.retries.get()))
}
```

- **必须导出 `Config`**：Cordis 只在导出 schema 时校验配置并填默认值。不导出 = 不校验、不填默认、设置页没有表单，代码里再兜一份默认值就是两处真相。
- 在**操作开始时**读 `.get()`；需要一致快照的请求一次性捕获。
- 跨字段约束用 `.check()`（Host 在持久化前执行，不进序列化的表单 schema）。
- **密钥不进配置**：用凭据引用。`role('secret')` 阻止值进入表单响应。
- 凭据宿主面：`ctx.credentials.resolve(ref)` → `{ value, source } | undefined`；`describe(ref)` 只给 `{ configured, source?, writable, masked? }`。
- 凭据浏览器面：`ctx.remote.credentials.describe(refs)` / `.set(ref, value)` / `.unset(ref)`；ref 必须匹配 `^[A-Za-z_][A-Za-z0-9_]*$`，且一批最多 64 个。
- **没有硬编码可调参数**：自检「不改代码能在 cordis.yml 里改吗」。
- 改 `cordis.yml` 的 config 会触发插件热替换（卸载旧实例 + 加载新实例），注册靠 effect 自动清理。

文档：`…/develop/basic/config`、`…/reference/cookbook/adding-a-settings-card`、`…/reference/subsystems/{settings,credentials}`

---

## R7 客户端：面板、设置页、工具卡片

**判据**：要往 Web GUI 加可见内容。宿主半 `apply` 可以为空，浏览器半在 `./client`。

清单（树外包）：

1. `package.json`：`dsh.bundle.patch` + `dsh.client: { platform: 'web', inject: [...] }` + 导出 `./client`；`files` 覆盖所有运行时产物。
2. 构建产物必须是 `window.__ModuleLoader__.load({ id: '<包名>', factory: (require) => module.exports })`；执行时只注册 factory，副作用在物化时跑。
3. 只 `require` 基座模块（见 architecture.md §7）。
4. 组件必须是**模块作用域的稳定函数**；渲染期创建组件会重挂载子树、丢焦点与滚动。
5. 组件**永远拿不到 `ctx`**：数据与回调经注册项的 `inject` 面、声明的 store、框架 hook 到达。

注册示例：

```js
const inject = ['slots', 'locale', 'layout']
function apply(ctx) {
  ctx.effect(() => ctx.locale.register('acme', { zh, en }), 'acme: dictionaries')
  const t = ctx.locale.bind('acme')                       // t(key, { count })

  // 主面板（keyed）：key = 面板 id，同时也是左侧栏行 id
  ctx.slots.inject('main', () => ctx.slots.register(
    { name: 'main', key: 'acme', locale: 'acme', inject: () => ({ back }) }, AcmePage))

  // 左侧栏图标（list）：id 必须等于主面板 key，label 用 thunk 以跟随语言切换
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
    { name: 'sidebar.panellist', id: 'acme', order: 30, locale: 'acme', label: () => t('panel') }, AcmeIcon))

  // 设置页（list）：id/order/label；owner 会传 { close }
  ctx.slots.inject('settings.section', () => ctx.slots.register(
    { name: 'settings.section', id: 'acme', order: 20, label: () => t('settings'), locale: 'acme' }, AcmeSettings))
}
```

- 切回会话：`ctx.layout.selectPanel(null)`（`MainPanelId | null`）。
- `slot` 的关键规则：向未声明的 slot 注册 = 加载期失败；`children` 声明才算拥有渲染权；同 `id` + 同 `priority` 重复注册会抛错（所以不要留「两条路径都注册」的兜底）。
- 工具结果卡片：keyed slot `tool.call.toolview`，按 wire 工具名注册，props 从 `ToolCallBlock` 的参数/内容/错误/`metadata`/`parentCallId` 派生；格式错误一律回退 generic 行。**不要在 metadata 里存 React props。**
- 文案：所有产品字符串进 typed locale 字典，经 `t` 或已本地化的 prop；英文用 sentence case；`t` 的占位符用参数（`t('docs.count', { count })`），不要 `.replace('{count}', …)`。
- 样式：CSS Module + `--dsw-alias-*` 语义 token；禁止颜色字面量、组件库、Tailwind；`style` 只放运行期计算值。菜单/下拉用共享 `Menu`/`MenuSurface`。
- 图片：`"./assets/*": "./lib/assets/*"`，浏览器侧经 `/plugins/<pkg>/assets/...`；插件卡片图标用清单顶层 `icon`。
- 改完 bundle 必须重建再刷页面（registry 提供的是 `lib/client.js`）。

文档：`…/reference/subsystems/{slots,client-modules,web-client,client-resources}`、`…/reference/cookbook/adding-a-settings-card`、`packages/client/AGENTS.md`、`docs/web-styling.zh.md`

---

## R8 打包成组合包 / 覆盖 profile

**判据**：要交付给别人用，或只想改某个现成组合的值。

组合包：`package.json` 声明 `dsh.bundle.patch`（可给有序文件列表），`cordis.patch.yml` 是 patch 条目数组：

```yaml
- insert:
    - id: acme
      name: '@acme/dsh-acme'
      inject: [webServer, credentials]     # 行级 inject（插件自己也可导出 inject，二选一，别两处都写）
      config:
        timeoutMs: 30000
```

profile 里覆盖某一行（**重述整份 config**）：

```yaml
- id: acme
  config:
    timeoutMs: 60000
```

要点：

- `dsh plugin --profile web add ./acme` 会把包加进 `dsh.profile.bundles`；`--dump-config` 验证层出现。
- **`engines.dsh` 必写**；没有它时安装/启动退化为检查 `@deepseek-ai/dsh*` peer 范围。
- 与宿主共享实例的 dsh 包：`peerDependencies` 与 `devDependencies` 同范围各一份。
- 第三方无状态工具包放 `dependencies`；浏览器侧第三方实现放 `devDependencies`（会被 inline 进 `lib/client.js`）。
- git 安装拉源码 → 作者要提供自包含 `prepare`；不想让用户授权构建脚本就发 npm 包或 tarball。
- 不声明 `dsh.bundle` 也能装，但只会是普通依赖并打印警告（库包用这种形态正确）。

文档：`…/develop/basic/publish`、`…/reference/`（Profile 与组合包）、`packages/boot/app-boot/README.zh.md#profiles`

---

## R9 接一个 MCP 服务器

**判据**：外部已有 MCP server，想把它变成工具。

```yaml
- insert:
    - id: mcp-acme
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: acme
        transport: stdio
        command: !!js process.execPath
        args: ['/abs/path/to/server.mjs']
        cwd: !!js process.cwd()
        toolCallTimeoutMs: 240000
        failOnStartupError: false
```

- 一个服务器一个插件实例；工具发现后由 mcp-client 调 `ctx.tools.register()`，模型看到的名字是 `mcp__<serverName>__<tool>`。
- 想写自己的 MCP server：只用 node 内建即可（stdio + JSON-RPC），别引第三方包，否则安装侧要处理依赖。
- `failOnStartupError: false` 只用于「不可用也不该阻塞启动」的可选服务器。

文档：`…/reference/subsystems/mcp`、`packages/mcp/mcp-client/README.zh.md`

---

## R10 把一套能力做成 skill

**判据**：想按需给 agent 装载一段指令（而不是常驻系统提示词）。

- 目录形态：`<root>/skills/<name>/SKILL.md`（或扁平 `<name>.md`），`name` 必须是 kebab-case `^[a-z0-9]+(?:-[a-z0-9]+)*$`；**不支持嵌套 `**/SKILL.md`**。
- 发现优先级（rank 越小越优先）：`<projectRoot>/.dsh/skills`(100) → `<projectRoot>/.agents/skills`(200) → `Config.customSkillDirs`(300) → `<dshHome>/skills`(400) → `~/.agents/skills`(500) → bundled(600)。
- `projectRoot` = 最近的含 `.git` 的祖先目录，找不到时用 cwd。
- frontmatter 至少 `name` + `description`；`description` 决定模型何时会加载它，要写「做什么 + 什么时候用」。
- 正文写可执行指令，长材料放 `references/` 按需读取，别把一切塞进 SKILL.md。

文档：`…/reference/subsystems/skills`
