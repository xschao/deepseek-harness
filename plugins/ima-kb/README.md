# @deepseek-ai/dsh-ima-kb

腾讯 IMA 知识库的 DeepSeek Harness 侧边栏插件：在左侧菜单新增「IMA 知识库」入口，
点击即在主面板打开知识库界面——知识库（名称 + id）勾选多选、组合问答，以及文档的
列表 / 上传 / 改名 / 删除。

## 功能

- **左侧菜单入口**：注册 `main` 面板 + `sidebar.panellist` 图标两个 slot，打开即进知识库。
- **知识库多选**：以「名称 + id」勾选框列出知识库（名称自动从 IMA 接口发现，
  也支持用凭据 `IMA_KNOWLEDGE_BASES` 以 `名称:id` 形式自定义），可勾选一个或多个。
- **组合问答**：IMA 一次会话只绑定一个知识库，因此对每个勾选的知识库各问一次（扇出），
  面板按知识库分组合并展示回答与引用。
- **文档管理**：文档列表（结构化接口对个人库常返回权限错误，自动退化为问答式列举）、
  上传（md/txt/pdf/html/docx/pptx/xlsx/epub/图片）、重命名、删除。
- **凭据复用**：与 `dsh-ima-copilot` 共用 `IMA_X_IMA_COOKIE` / `IMA_X_IMA_BKN` /
  `IMA_KNOWLEDGE_BASE_IDS`，不向浏览器回显任何明文。

## 依赖

- DSH ≥ 0.2.2-rc.1（使用 `webServer` 路由注册与 `credentials.resolve` 接口）；
  本包按 `dsh-v0.2.2-rc.3` 基线开发与验证。
- IMA 凭证：在「设置 → 插件 → IMA Copilot」中填写（同 `dsh-ima-copilot`）。

## 一键本地集成

在任意 DSH 环境中，从本仓库拉取代码后执行（`<repo>` 为本仓库目录）：

```sh
dsh plugin --profile web add <repo>/plugins/ima-kb
dsh web
```

- `dsh plugin` 会把本包以 pnpm 依赖形式装入 profile（`lib/` 为提交的预构建产物，
  **无需编译**）；本包的 `dsh.bundle.patch` 与 `dsh.client` 元数据会被 profile 自动装配。
- 重启后浏览器刷新，左侧菜单即出现「IMA 知识库」。
- 验证：`dsh --profile web --dump-config` 输出中应包含 `ima-kb`。

## 目录结构

```
plugins/ima-kb/
├── package.json        # 包清单：dsh.bundle.patch + dsh.client 元数据、exports
├── cordis.patch.yml    # 宿主装配：注入 webServer + credentials，robotType=5
├── src/
│   ├── index.js        # 宿主插件（IMA HTTP 客户端 + /api/ima/* 路由）
│   └── client.js       # 浏览器插件（侧边栏图标 + 主面板）
├── lib/                # 预构建产物（已提交，一键集成直接使用）
├── scripts/sync.mjs    # src -> lib 同步（npm run build）
└── README.md
```

## 宿主路由

| 路由 | 说明 |
| --- | --- |
| `POST /api/ima/status` | 凭证状态 + 知识库列表（名称/id） |
| `POST /api/ima/list` | 文档列表（结构化，失败自动退化为问答式列举） |
| `POST /api/ima/ask` | 知识库问答（单个或多个 `knowledgeBaseIds` 扇出） |
| `POST /api/ima/upload` | 上传文档（base64 文件体） |
| `POST /api/ima/rename` | 重命名文档 |
| `POST /api/ima/delete` | 删除文档（按 media_id 列表） |

## 说明

IMA Web API 并非公开稳定 API，上游字段、鉴权或响应格式变化时本插件可能需要同步更新。
本插件为社区插件，与腾讯 IMA 或 DeepSeek 官方均无隶属或背书关系。
