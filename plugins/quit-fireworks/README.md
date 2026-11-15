# @local/dsh-quit-fireworks · 下班烟花

说一句「下班 / 放烟花」，DSH Web GUI 上放一场全屏烟花。

## 组成

| 半边 | 文件 | 内容 |
|---|---|---|
| Host | `index.js` | 注册工具 `quit_fireworks`（无副作用的纯前端动画开关，`parameters` 只有一个可选 `note`） |
| Client | `client.js` | `shell.overlay` 里的全屏 canvas 烟花层 + 右下角浮动 🎆 按钮 + `tool.call.toolview` 工具卡片 |
| 组合 | `cordis.patch.yml` | 往 profile 插一行 `quit-fireworks` |
| 清单 | `package.json` | `dsh.bundle.patch` + `dsh.client`（`platform: web`） |

挂载方式：`my_config/web/package.json` 的 `dependencies` 用 `file:../../plugins/quit-fireworks` 引用，
并在 `dsh.profile.bundles` 末尾追加 `@local/dsh-quit-fireworks`（后层按 `id` 覆盖，整份 config 替换）。

## 四条触发通道

1. **右下角浮动按钮**：常驻 44px 圆形 🎆，点击即放（hover 放大、按下回弹）。
2. **输入框口令**：在输入框里打「放烟花 / 下班 / 收工 / 下播」后按回车，按下瞬间点燃（`isComposing` 组字回车不触发）。
3. **URL**：页面地址带 `#fireworks`（或 `?fireworks=1`）加载即放；同页内改 hash 也可（`hashchange`）。放完自动清标记，刷新不重放。
4. **工具**：`quit_fireworks` 供 Agent 调用；其调用行渲染时点燃，按 `callId` 在 `sessionStorage` 去重。

## 动画

`client.js` 里的 `createEngine(canvas)`：8 枚火箭错峰升空（150ms 间隔）→ 到点炸开 110–190 颗粒子
（`lighter` 叠加、每帧阻尼 1.55×dt、重力 165 px/s²、寿命 0.9–2.5s）＋ 冲击波环 ＋ 0.7s 后浮出祝福语（跟随界面语言）。
无粒子后自行停帧清屏，不留后台动画。

`devicePixelRatio` 上限 2；监听 `resize` 重设画布；`dispose()` 统一回收定时器/事件/RAF。

## 注意

- 宿主端刻意不 import 任何包（树外插件裸模块解析不可靠），直接用工具注册表接受的普通对象形状。
- `output.schema` 用的是 DSH 的 schema 方言：布尔字段**不能**带 `required: true`，否则加载期 `JsonSchemaError`。
- 客户端 bundle 由 Host 启动时读入内存，改完 `client.js` 必须重启 DSH + 刷新页面才生效。
