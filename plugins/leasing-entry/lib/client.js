/* 浏览器端 bundle：在左侧栏底部加一个「融资租赁」入口。
   点击后调用 uiWorkspace.startSession，用一个已声明的 agentPreset（leasing）开新会话，
   省去每次在 hero 选择器里挑模式。
   注册的 slot：
     - sidebar.footer.action（list）：底部动作按钮 LeasingAction */
window.__ModuleLoader__.load({
	id: "@local/dsh-leasing-entry",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		const NS = "leasing.entry";
		/** 必须与 profile 中 preset 声明的 config.id 一致。 */
		const PRESET_ID = "leasing";
		/** 上一次打开的融资租赁会话，用来「回到上次」而不是每次新开。 */
		const LAST_SESSION_KEY = "dsh.leasingEntry.lastSession";

		/** 读取上次记录的会话 id；localStorage 被禁时返回 undefined。 */
		function readLastSession() {
			try {
				return window.localStorage.getItem(LAST_SESSION_KEY) || void 0;
			} catch {
				return void 0;
			}
		}

		/** 记录会话 id；写不进去不影响主流程。 */
		function writeLastSession(id) {
			try {
				if (id) window.localStorage.setItem(LAST_SESSION_KEY, id);
			} catch {
				/* 忽略：隐私模式下 localStorage 不可写 */
			}
		}

		/** 找出应该跳回去的那个融资租赁会话：先看记录，再按 preset 投影兜底。 */
		function latestLeasingSession(ctx) {
			const snapshot = ctx.sessions.list.getSnapshot();
			if (!snapshot || !snapshot.byId) return void 0;
			const last = readLastSession();
			if (last && snapshot.byId[last]) return last;
			const rows = (snapshot.ids || [])
				.map((id) => snapshot.byId[id])
				.filter((row) => row && !row.blank && row.origin !== "subagent")
				.filter((row) => row.projectionValues && row.projectionValues.agentPreset === PRESET_ID);
			rows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
			return rows.length > 0 ? rows[0].id : void 0;
		}

		/**
		 * 点一次入口的完整动作：有旧会话就跳回去，没有才用 preset 新建一个，
		 * 并在新会话出现后把 id 记下来，下次就能直接命中。
		 */
		function openOrStart(ctx) {
			const existing = latestLeasingSession(ctx);
			if (existing) {
				writeLastSession(existing);
				ctx.uiWorkspace.openSession(existing);
				return;
			}
			const since = Date.now();
			ctx.uiWorkspace.startSession(void 0, { agentPreset: PRESET_ID });
			window.setTimeout(() => {
				try {
					const snapshot = ctx.sessions.list.getSnapshot();
					const rows = (snapshot.ids || [])
						.map((id) => snapshot.byId[id])
						.filter((row) => row && !row.blank && (row.updatedAt || 0) >= since - 5000);
					rows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
					if (rows.length > 0) writeLastSession(rows[0].id);
				} catch {
					/* 记录失败只是下次会新开，不阻断打开 */
				}
			}, 1500);
		}

		const zh = {
			"action": "融资租赁",
			"action.hint": "回到融资租赁会话（没有则新建）"
		};
		const en = {
			"action": "Leasing",
			"action.hint": "Return to the leasing session, or start one"
		};

		/** 16px 线性图标：一栋带窗的建筑（区别于 IMA 的圆标）。 */
		const Icon = () =>
			react.createElement(
				"svg",
				{
					width: 16,
					height: 16,
					viewBox: "0 0 16 16",
					fill: "none",
					"aria-hidden": "true",
					style: { flex: "0 0 auto" }
				},
				react.createElement("path", {
					d: "M2.5 13.5V6.2L8 3l5.5 3.2v7.3",
					stroke: "currentColor",
					strokeWidth: 1.3,
					strokeLinecap: "round",
					strokeLinejoin: "round"
				}),
				react.createElement("path", {
					d: "M6 13.5v-3h4v3",
					stroke: "currentColor",
					strokeWidth: 1.3,
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})
			);

		/** 底部动作按钮：宽栏显示文字，56px 轨道只显示图标。 */
		function LeasingAction(props) {
			const wide = props && props.wide === true;
			const start = props && props.start;
			const t = props && props.t;
			const [hover, setHover] = react.useState(false);
			const label = t ? t("action") : "融资租赁";
			const hint = t ? t("action.hint") : "用「融资租赁专家」新建一个会话";
			return react.createElement(
				"button",
				{
					type: "button",
					title: hint,
					"aria-label": hint,
					onClick: () => {
						if (typeof start === "function") start();
					},
					onMouseEnter: () => setHover(true),
					onMouseLeave: () => setHover(false),
					style: {
						display: "flex",
						alignItems: "center",
						justifyContent: wide ? "flex-start" : "center",
						gap: 8,
						width: wide ? "100%" : 32,
						height: 32,
						padding: wide ? "0 8px" : 0,
						border: "none",
						borderRadius: "var(--dsw-radius-sm, 8px)",
						background: hover ? "var(--dsw-alias-bg-hover, rgba(0,0,0,0.06))" : "transparent",
						color: "var(--dsw-alias-text-2, #4b5563)",
						font: "inherit",
						fontSize: 13,
						cursor: "pointer"
					}
				},
				react.createElement(Icon),
				wide ? react.createElement("span", { style: { whiteSpace: "nowrap" } }, label) : null
			);
		}

		const inject = ["slots", "locale", "uiWorkspace", "sessions"];

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "leasing-entry: dictionaries");
			const t = ctx.locale.bind(NS);
			ctx.slots.inject("sidebar.footer.action", () =>
				ctx.slots.register(
					{
						name: "sidebar.footer.action",
						id: "leasing-expert",
						locale: NS,
						inject: () => ({
							t,
							start: () => openOrStart(ctx)
						})
					},
					LeasingAction
				)
			);
		}

		exports.inject = inject;
		exports.apply = apply;
		return module.exports;
	}
});
