# my_config — DSH web profile 的项目化配置目录

本目录把 DeepSeek Harness 的 `web` profile 配置**整体收进仓库管理**：依赖声明、配置补丁、
插件锁定都随项目走，运行时产物不入库，和 Java 项目里 `pom.xml + 配置目录` 的心智模型一致。

## 关系结构

```
<本仓库>
├── my_config\
│   ├── .gitignore          # 运行时产物不入库
│   └── web\                # DSH web profile 本体
│       ├── package.json    # 依赖声明 + dsh.profile.bundles（类似 pom.xml）
│       ├── cordis.patch.yml# 配置补丁层（IMA、默认模型等，手写维护）
│       ├── pnpm-lock.yaml  # 依赖锁定（提交）
│       ├── pnpm-workspace.yaml
│       ├── cordis.yml      # 合并后的最终配置（自动生成，不入库、勿手改）
│       └── node_modules\   # 依赖本体（不入库）
│           └── @deepseek-ai\dsh-ima-kb → junction 指向仓库 plugins\ima-kb
└── plugins\
    └── ima-kb\             # IMA 知识库侧边栏插件（开发中，见其 README）

C:\Users\<用户>\.dsh\profiles\web
        ↑ junction（目录链接，无需管理员权限）
<本仓库>\my_config\web
```

DSH 按 `$DSH_HOME\profiles\web` 查找 profile；junction 让这个路径透明地指向仓库目录，
所以「改仓库里的配置/插件 = 改 DSH 实际生效的内容」。

## 各文件说明

| 文件 | 作用 | 是否提交 | 谁维护 |
| --- | --- | --- | --- |
| `package.json` | 插件依赖声明 + `dsh.profile.bundles`（加载哪些 bundle） | ✅ | 手动 / `dsh plugin` |
| `cordis.patch.yml` | 配置补丁层：覆盖/追加插件配置（IMA MCP、`agent-default-model` 等） | ✅ | 手动 |
| `pnpm-lock.yaml`、`pnpm-workspace.yaml` | pnpm 依赖锁定与布局 | ✅ | `dsh plugin` 自动 |
| `node_modules\` | 被覆盖过的有用依赖本体（如打过补丁的 `dsh-ima-copilot`）**提交**；pnpm 虚 store（`.pnpm`）、安装状态、指向 `plugins\ima-kb` 的 junction 忽略 | 部分 ✅ | pnpm / 手动 junction |
| `cordis.yml` | 各层合并后的最终配置树（启动时生成） | ❌ | 自动生成 |
| `bak\` | 变更前的备份文件（统一存放于此） | ❌ | 自动 |

## 新环境一键接入

拉取仓库后，在目标机器上执行：

```powershell
# 1. 链接 profile：让 DSH 用仓库里的配置
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.dsh\profiles" | Out-Null
New-Item -ItemType Junction `
    -Path "$env:USERPROFILE\.dsh\profiles\web" `
    -Target "<仓库路径>\my_config\web"

# 2. 补齐依赖：被覆盖过的依赖本体已随仓库提交（如 dsh-ima-copilot）；
#    只有缺失/新增的包才需要执行（dsh plugin 转发 pnpm；需 pnpm 可用，如 corepack 启用）
dsh plugin --profile web install

# 3. 把仓库内插件链接进 profile（开发模式，改仓库即生效）
New-Item -ItemType Directory -Force -Path "<仓库路径>\my_config\web\node_modules\@deepseek-ai" | Out-Null
New-Item -ItemType Junction `
    -Path "<仓库路径>\my_config\web\node_modules\@deepseek-ai\dsh-ima-kb" `
    -Target "<仓库路径>\plugins\ima-kb"

# 4. 启动（后台）并打开 http://127.0.0.1:3080
dsh web
```

> 说明：`my_config\web\node_modules` 是依赖本体（不入库），所以新环境需要第 2 步重新安装；
> 第 3 步把正在开发的插件改成链接，避免「改了仓库不生效」。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `dsh web` | 后台启动 web（隐藏窗口、幂等，已运行则跳过） |
| `dsh --profile web` | 前台启动（调试，日志直出，Ctrl+C 停止） |
| `dsh-restart` | 重启后台服务（改配置/插件后使用，约 30-40 秒） |
| `dsh plugin --profile web add <包>` | 装插件（声明进 package.json，本体落 node_modules） |
| `dsh --profile web --dump-config` | 预检/查看合并后的配置树（应包含 ima-kb、mcp-ima-kb 等） |
| `dsh headless "任务"` / `dsh-ask "问题"` | 控制台一次性问答 |

## 注意事项

1. **改完配置/插件要重启**：宿主插件启动时装入内存，客户端 bundle 启动时计算版本号；
   改 `my_config\web` 或 `plugins\ima-kb` 后执行 `dsh-restart`，再 Ctrl+F5 刷新页面。
2. **插件开发改 `lib/`**：运行加载的是 `plugins\ima-kb\lib\`（预构建产物）；
   改 `src\` 后运行 `node plugins\ima-kb\scripts\sync.mjs` 同步。
3. **不要手改 `cordis.yml`**：它是自动生成的合并结果，每次启动重写；要调整配置改 `cordis.patch.yml`。
4. **凭据不进仓库**：IMA Cookie / DeepSeek API key 存在 `~\.dsh\.credentials.yaml`（DSH_HOME），
   与本目录无关，切勿提交。
5. junction 是 Windows 目录链接，普通用户即可创建；git 会把 junction 当作普通目录内容处理，
   请确认 `my_config\.gitignore` 未误伤需要提交的声明文件。

## 变更说明

`package.json` 用顶层 `"//"` 字段承载备注（JSON 没有注释语法；DSH 读取清单是 `JSON.parse` + 取
`dsh.profile.bundles`，未知顶层字段会被忽略并在重写时保留）。`cordis.patch.yml` 的改动直接写在行内注释里。

`package.json` / 其它 JSON 里写不了的细节记在这张表；**时间取文件真实修改时间**，便于对照 git 记录。

| 时间 | 文件 | 改动 | 作用 | 依赖来源 |
| --- | --- | --- | --- | --- |
| 2026-11-15 16:15 | `web/package.json` | `dsh.profile.bundles` 增加 `@deepseek-ai/dsh-experimental-cot-translation-bundle` | 让客户端把模型的思维链按当前界面语言翻译后展示，而不是夹杂英文推理 | 来自 DSH 运行时安装 `~\.dsh\app\node_modules`，**不在** profile 的 `dependencies` 里，故 `my_config\web\node_modules` 下看不到它，属正常 |
| 2026-11-15 16:15 | `web/cordis.patch.yml` | `agent-default-model.reasoningEffort: high` | 默认 Agent 用高强度推理，复杂改造/排错时更稳 | 无新增依赖；代价是延迟与 token 上升，可回落到 `medium` |
| 2026-11-15 16:17 | `web/cordis.patch.yml` | 为 `mcp-ima-kb`（serverName/transport/command/args/cwd/超时/失败策略）与 `agent-default-model` 逐项补注释 | 说明每个字段的作用与取值原因，避免下次误改 | 无 |
| 2026-11-15 16:25 | `web/package.json`、`my_config/README.md` | 给上述改动补中文备注与时间戳 | 让 `git add` 的每条新增内容都能自我解释 | 无 |
