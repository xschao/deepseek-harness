# @deepseek-ai/dsh-ima-kb

腾讯 IMA 知识库的 DeepSeek Harness 侧边栏插件：在左侧菜单新增「IMA 知识库」入口，
点击即在主面板打开知识库界面——单选知识库提问，并按目录浏览 / 上传 / 改名 / 删除文档。

## 功能

- **左侧菜单入口**：注册 `main` 面板 + `sidebar.panellist` 图标两个 slot，打开即进知识库。
- **知识库单选**：以下拉面板列出知识库（名称 + id；名称自动从 IMA 接口发现，也支持用
  凭据 `IMA_KNOWLEDGE_BASES` 以 `名称:id` 形式自定义）。面板通过 portal 挂到页面顶层并用
  fixed 定位，不会被卡片裁剪或被下方内容遮挡；一次只能选中一个，选中后自动收起。
- **问答**：向选中的知识库提问，答案与引用直接展示；提问中按钮转为「取消」，可中断请求，
  输入框在等待期间仍可编辑。
- **文档目录**：选中知识库后自动列出该库根目录，展示文件夹与文档，可点文件夹逐层进入，
  面包屑可回退；「刷新」按当前目录重新拉取。上传落到当前目录
  （md/txt/pdf/html/docx/pptx/xlsx/epub/图片），并支持重命名、删除。
- **下载**：仅当 IMA 返回绝对 http 地址（`raw_file_url` / `parsed_file_url` / `jump_url`）时，
  文档行右侧显示「下载」链接。多数文档是私有 COS 对象，IMA 不在 Web 接口里返回签名地址
  （`file_manager/get_media` 对这些 media 回 `请前往客户端查看内容`），因此这类文档没有下载链接。
- **左侧菜单两个入口**：「IMA 知识库」为工具页；「IMA 网页」点击左侧标签即加载
  https://ima.qq.com/（与当前浏览器共享登录态）：首次点击就创建内嵌 iframe，离开
  面板或点「卸载」即销毁，避免网页版在后台常驻轮询；卸载后可在面板内点「加载
  IMA 网页」按需重建。
  注意：跨域 iframe 内页面的链接仍会在新标签页打开（浏览器安全模型所限）。
- **凭据复用**：与 `dsh-ima-copilot` 共用 `IMA_X_IMA_COOKIE` / `IMA_X_IMA_BKN` /
  `IMA_KNOWLEDGE_BASE_IDS`，不向浏览器回显任何明文。
- **返回会话**：两个面板顶部都有「返回会话」，调用 `layout.selectPanel(null)` 切回会话；
  只切换主面板，不改变当前选中的会话，会话历史与草稿都保留。

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
| `POST /api/ima/list` | 按目录列文档（`knowledgeBaseId` + 可选 `folderId`，返回 `path` 面包屑；失败自动退化为问答式列举） |
| `POST /api/ima/ask` | 知识库问答（`knowledgeBaseIds` 为单元素时直接问该库） |
| `POST /api/ima/upload` | 上传文档（base64 文件体，可带 `folderId`） |
| `POST /api/ima/rename` | 重命名文档 |
| `POST /api/ima/delete` | 删除文档（按 media_id 列表） |

> 文档列表必须走 `knowledge_tab_reader/get_knowledge_list`；`..._nl` 版本对个人知识库返回
> `80100 暂无权限`。该接口 `limit` 上限为 50，传更大值会返回 `51 参数错误`。

## 说明

IMA Web API 并非公开稳定 API，上游字段、鉴权或响应格式变化时本插件可能需要同步更新。
本插件为社区插件，与腾讯 IMA 或 DeepSeek 官方均无隶属或背书关系。
