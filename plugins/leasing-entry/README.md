# dsh-leasing-entry

左侧栏底部入口：一键用 `leasing`（融资租赁专家）preset 新建会话。

## 结构

| 文件 | 作用 |
|---|---|
| `lib/client.js` | 浏览器 bundle。注册 `sidebar.footer.action`，点击调用 `ctx.uiWorkspace.startSession(undefined, { agentPreset: 'leasing' })` |
| `lib/index.js` | 宿主侧空占位插件，让插件页能看到并启停本包 |
| `cordis.patch.yml` | insert 一行 `leasing-entry` |

客户端 bundle 用 `window.__ModuleLoader__.load({ id, factory })` 包装，`id` 必须等于包名（`@local/dsh-leasing-entry`）。

## 为什么是手工接线，不是 `dsh plugin add`

`dsh plugin --profile web add` 在这台机器上会失败：

```
ERR_PNPM_UNEXPECTED_STORE
  node_modules 由 pnpm v10 装于 C:\Users\19227\AppData\Local\pnpm\store\v10
  当前 pnpm v11 想用 F:\.pnpm-store\v11
```

这是既存的环境问题。修复方式（二选一）：把 pnpm 退回 v10，或 `pnpm config set store-dir` 统一到一个目录后重装 profile 依赖。修好之后可以改回 `dsh plugin add`，那时要删掉手工加的 junction。

## 手工接线（当前生效方式）

1. junction：`C:\Users\19227\.dsh\profiles\web\node_modules\@local\dsh-leasing-entry` → `F:\AITools\deepseek\plugins\leasing-entry`
2. profile `package.json`：
   - `dependencies` 加 `"@local/dsh-leasing-entry": "file:../../../plugins/leasing-entry"`
   - `dsh.profile.bundles` 末尾加 `"@local/dsh-leasing-entry"`
3. 重启 DSH 生效（profile 组合只在启动时读一次）。

## 回滚

```powershell
Remove-Item 'C:\Users\19227\.dsh\profiles\web\node_modules\@local' -Recurse -Force
# 再从 profile package.json 删掉 dependencies 与 bundles 里那两条
dsh-restart
```

profile `package.json` 的备份在 `F:\AITools\deepseek\.work\profile-web-*.json.bak`。

## 注意

- `engines.dsh` 必须写 `>=0.2.2-rc.1 <0.3.0`：运行时是预发布版 `0.2.2-rc.1`，普通范围 `>=0.2.2` 不含预发布，会被安装器拒绝。
- 改这个插件后要 `dsh-restart`。树外插件的客户端 bundle 不走 `dev:web` 的 HMR。
- 这个插件只管"怎么唤出来"；"是什么智能体"由 profile 里的 `preset-leasing` 声明决定，两者独立。
