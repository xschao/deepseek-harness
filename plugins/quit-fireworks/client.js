/* 浏览器端 bundle：说一句「下班」，整页放一场烟花。
   两块注册：
     - shell.overlay（list，root 作用域）：全屏 canvas，平时透明不拦截点击
     - tool.call.toolview（keyed，key=quit_fireworks）：工具调用行，挂载即点燃
   两块通过模块内的 fire()/subscribe() 总线相连。 */
window.__ModuleLoader__.load({
	id: "@local/dsh-quit-fireworks",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, {
			value: "Module"
		});
		let react = require("react");
		const h = react.createElement;

		/** locale 命名空间。 */
		const NS = "quit-fireworks";

		const zh = {
			"card.title": "下班烟花",
			"card.body": "已点燃，下班快乐！",
			"overlay.text": "下班快乐！",
			"fab.label": "放烟花"
		};
		const en = {
			"card.title": "Off-work fireworks",
			"card.body": "lit up — enjoy your evening!",
			"overlay.text": "Off work!",
			"fab.label": "Fireworks"
		};

		/* ───────────── 触发总线 ───────────── */

		/** 已挂载的烟花图层订阅者。 */
		const listeners = /* @__PURE__ */ new Set();
		/** 图层还没挂载时先攒着的点火次数。 */
		let pendingFires = 0;

		/** 订阅一次点火；返回退订函数。 */
		function subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		}

		/** 取走攒下的点火次数。 */
		function consumePending() {
			const count = pendingFires;
			pendingFires = 0;
			return count;
		}

		/** 点燃一场烟花；没有订阅者时排队，图层挂载后补放。 */
		function fire() {
			if (listeners.size === 0) {
				pendingFires = Math.min(pendingFires + 1, 3);
				return;
			}
			for (const listener of [...listeners]) try {
				listener();
			} catch (error) {
				console.error("[quit-fireworks] layer failed:", error);
			}
		}

		/* ───────────── 调色板与画布引擎 ───────────── */

		/** 烟花配色：暖金 + 青 + 洋红 + 草绿，够喜庆。 */
		const PALETTE = [
			"#ffd166",
			"#ff7b54",
			"#ff4d6d",
			"#f472b6",
			"#a78bfa",
			"#60a5fa",
			"#4ecdc4",
			"#7ee787",
			"#ffe66d",
			"#fdba74"
		];

		/** 从调色板随机取一色。 */
		function pickColor() {
			return PALETTE[Math.floor(Math.random() * PALETTE.length)];
		}

		/**
		 * 一块 canvas 上的烟花引擎：火箭升空 → 爆开 → 粒子重力衰减 → 收尾清屏。
		 * @param canvas - 全屏画布。
		 * @returns 控制面（mount / show / setLabel / dispose）。
		 */
		function createEngine(canvas) {
			const g = canvas.getContext("2d");
			const rockets = [];
			const sparks = [];
			const rings = [];
			const labels = [];
			const timers = [];
			let labelText = () => "下班快乐！";
			let width = 0;
			let height = 0;
			let dpr = 1;
			let frame = 0;
			let previous = 0;
			let alive = true;

			/** 跟随窗口尺寸与像素比重设画布。 */
			function resize() {
				dpr = Math.min(window.devicePixelRatio || 1, 2);
				width = window.innerWidth;
				height = window.innerHeight;
				canvas.width = Math.max(1, Math.floor(width * dpr));
				canvas.height = Math.max(1, Math.floor(height * dpr));
				g.setTransform(dpr, 0, 0, dpr, 0, 0);
			}

			/** 追加一枚会爆开的火箭。 */
			function addRocket() {
				const x = width * (0.12 + Math.random() * 0.76);
				rockets.push({
					x,
					y: height + 10,
					vx: (Math.random() - 0.5) * 30,
					vy: -(height * (0.66 + Math.random() * 0.3)),
					target: height * (0.06 + Math.random() * 0.32),
					color: pickColor()
				});
			}

			/** 在一点炸开一团粒子并留一圈冲击波。 */
			function explode(x, y, color) {
				const count = 110 + Math.floor(Math.random() * 80);
				for (let i = 0; i < count; i += 1) {
					const angle = Math.random() * Math.PI * 2;
					const speed = 60 + Math.random() * 430;
					sparks.push({
						x,
						y,
						vx: Math.cos(angle) * speed,
						vy: Math.sin(angle) * speed,
						age: 0,
						life: 0.9 + Math.random() * 1.6,
						size: 1 + Math.random() * 2,
						color: Math.random() < 0.74 ? color : pickColor()
					});
				}
				rings.push({
					x,
					y,
					radius: 6,
					age: 0,
					life: 0.6,
					color
				});
			}

			/** 画一帧。 */
			function step(now) {
				const seconds = now / 1000;
				const dt = previous === 0 ? 0.016 : Math.min(seconds - previous, 0.05);
				previous = seconds;
				g.clearRect(0, 0, width, height);
				g.globalCompositeOperation = "lighter";

				for (let i = rockets.length - 1; i >= 0; i -= 1) {
					const rocket = rockets[i];
					rocket.vy += 210 * dt;
					rocket.x += rocket.vx * dt;
					rocket.y += rocket.vy * dt;
					g.globalAlpha = 0.9;
					g.strokeStyle = rocket.color;
					g.lineWidth = 2.6;
					g.beginPath();
					g.moveTo(rocket.x, rocket.y);
					g.lineTo(rocket.x - rocket.vx * 0.04, rocket.y - rocket.vy * 0.05);
					g.stroke();
					if (rocket.y <= rocket.target || rocket.vy >= -40) {
						explode(rocket.x, rocket.y, rocket.color);
						rockets.splice(i, 1);
					}
				}

				const damp = Math.max(0, 1 - 1.55 * dt);
				for (let i = sparks.length - 1; i >= 0; i -= 1) {
					const spark = sparks[i];
					spark.age += dt;
					if (spark.age >= spark.life) {
						sparks.splice(i, 1);
						continue;
					}
					spark.vx *= damp;
					spark.vy = spark.vy * damp + 165 * dt;
					spark.x += spark.vx * dt;
					spark.y += spark.vy * dt;
					const left = 1 - spark.age / spark.life;
					g.globalAlpha = Math.max(0, left);
					g.fillStyle = spark.color;
					g.beginPath();
					g.arc(spark.x, spark.y, spark.size * (0.45 + left * 0.75), 0, Math.PI * 2);
					g.fill();
					if (left > 0.55) {
						g.globalAlpha = left * 0.28;
						g.beginPath();
						g.arc(spark.x, spark.y, spark.size * 3.1, 0, Math.PI * 2);
						g.fill();
					}
				}

				for (let i = rings.length - 1; i >= 0; i -= 1) {
					const ring = rings[i];
					ring.age += dt;
					if (ring.age >= ring.life) {
						rings.splice(i, 1);
						continue;
					}
					const progress = ring.age / ring.life;
					g.globalAlpha = (1 - progress) * 0.5;
					g.strokeStyle = ring.color;
					g.lineWidth = 2.5 * (1 - progress) + 0.6;
					g.beginPath();
					g.arc(ring.x, ring.y, ring.radius + progress * 190, 0, Math.PI * 2);
					g.stroke();
				}

				g.globalCompositeOperation = "source-over";
				for (let i = labels.length - 1; i >= 0; i -= 1) {
					const label = labels[i];
					label.age += dt;
					if (label.age >= label.life) {
						labels.splice(i, 1);
						continue;
					}
					const grow = label.age < 0.32 ? label.age / 0.32 : 1;
					const fade = label.age > label.life - 0.9 ? (label.life - label.age) / 0.9 : 1;
					const size = Math.min(78, Math.max(34, width * 0.062)) * (0.85 + grow * 0.15);
					g.globalAlpha = Math.max(0, fade);
					g.textAlign = "center";
					g.textBaseline = "middle";
					g.font = `700 ${size.toFixed(1)}px system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif`;
					g.shadowColor = "rgba(255, 203, 96, 0.95)";
					g.shadowBlur = 28;
					g.fillStyle = "#fff9eb";
					g.fillText(label.text, width / 2, height * 0.34);
					g.shadowBlur = 0;
				}
				g.globalAlpha = 1;

				if (alive && (rockets.length > 0 || sparks.length > 0 || rings.length > 0 || labels.length > 0)) frame = window.requestAnimationFrame(step);
				else {
					frame = 0;
					previous = 0;
					g.clearRect(0, 0, width, height);
				}
			}

			/** 需要时才起动画帧。 */
			function kick() {
				if (frame === 0 && alive) frame = window.requestAnimationFrame(step);
			}

			/** 点燃一场：8 枚火箭错峰升空，0.7s 后浮出祝福语。 */
			function show() {
				if (!alive) return;
				resize();
				for (let i = 0; i < 8; i += 1) timers.push(window.setTimeout(() => {
					if (!alive) return;
					addRocket();
					kick();
				}, i * 150 + Math.random() * 70));
				timers.push(window.setTimeout(() => {
					if (!alive) return;
					labels.push({
						text: labelText(),
						age: 0,
						life: 2.9
					});
					kick();
				}, 700));
			}

			return {
				/** 装监听并测量一次。 */
				mount() {
					resize();
					window.addEventListener("resize", resize);
				},
				/** 设置祝福语来源（跟随界面语言）。 */
				setLabel(read) {
					labelText = read;
				},
				show,
				/** 摘掉全部监听、定时器与动画帧。 */
				dispose() {
					alive = false;
					window.removeEventListener("resize", resize);
					for (const timer of timers) window.clearTimeout(timer);
					timers.length = 0;
					if (frame !== 0) window.cancelAnimationFrame(frame);
					frame = 0;
					g.clearRect(0, 0, width, height);
				}
			};
		}

		/* ───────────── UI ───────────── */

		/** shell.overlay 的全屏烟花层：永远挂载，平时透明且不拦点击。 */
		function FireworksLayer(props) {
			const canvasRef = react.useRef(null);
			const labelRef = react.useRef((props && props.t ? props.t("overlay.text") : null) || "下班快乐！");
			labelRef.current = (props && props.t ? props.t("overlay.text") : null) || "下班快乐！";
			react.useEffect(() => {
				const canvas = canvasRef.current;
				if (!canvas) return void 0;
				const engine = createEngine(canvas);
				engine.mount();
				engine.setLabel(() => labelRef.current);
				const off = subscribe(() => engine.show());
				const queued = consumePending();
				for (let i = 0; i < queued; i += 1) engine.show();
				// 无工具触发通道：URL 带 #fireworks（或 ?fireworks=1）时直接放一场，
				// 放完把标记抹掉，刷新不会重复。
				let addressFire = false;
				try {
					const hash = window.location.hash.toLowerCase();
					const query = window.location.search.toLowerCase();
					addressFire = hash.includes("fireworks") || query.includes("fireworks=1");
				} catch {
					addressFire = false;
				}
				if (addressFire) {
					engine.show();
					try {
						const url = new URL(window.location.href);
						url.hash = "";
						url.searchParams.delete("fireworks");
						window.history.replaceState(null, "", url.toString());
					} catch {
						/* 改不了地址栏也不影响放 */
					}
				}
				// 同一页内改地址栏 hash 也能放：输入 #fireworks 回车。
				const onHashChange = () => {
					if (!window.location.hash.toLowerCase().includes("fireworks")) return;
					engine.show();
					try {
						window.history.replaceState(null, "", window.location.pathname + window.location.search);
					} catch {
						/* 忽略 */
					}
				};
				window.addEventListener("hashchange", onHashChange);
				return () => {
					window.removeEventListener("hashchange", onHashChange);
					off();
					engine.dispose();
				};
			}, []);
			return h("div", {
				style: {
					position: "fixed",
					inset: 0,
					pointerEvents: "none"
				}
			}, h("canvas", {
				ref: canvasRef,
				"aria-hidden": "true",
				style: {
					position: "absolute",
					inset: 0,
					width: "100%",
					height: "100%",
					display: "block",
					pointerEvents: "none"
				}
			}), h(FireworksButton, {
				t: props && props.t
			}));
		}

		/** 右下角常驻浮动按钮：点一下放一场，随时可放。 */
		function FireworksButton(props) {
			const t = props && props.t;
			const label = (t ? t("fab.label") : null) || "放烟花";
			const [hover, setHover] = react.useState(false);
			const [pressed, setPressed] = react.useState(false);
			return h("button", {
				type: "button",
				title: label,
				"aria-label": label,
				onClick: () => fire(),
				onMouseEnter: () => setHover(true),
				onMouseLeave: () => {
					setHover(false);
					setPressed(false);
				},
				onMouseDown: () => setPressed(true),
				onMouseUp: () => setPressed(false),
				style: {
					position: "absolute",
					right: 18,
					bottom: 18,
					width: 44,
					height: 44,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					padding: 0,
					borderRadius: "999px",
					border: "1px solid var(--dsw-alias-border-subtle, rgba(128,128,128,0.3))",
					background: hover ? "var(--dsw-alias-bg-raised, rgba(255,255,255,0.97))" : "var(--dsw-alias-bg-subtle, rgba(255,255,255,0.86))",
					boxShadow: hover ? "0 10px 26px rgba(0,0,0,0.22)" : "0 6px 18px rgba(0,0,0,0.16)",
					color: "var(--dsw-alias-text-2, #374151)",
					fontSize: 20,
					lineHeight: 1,
					cursor: "pointer",
					pointerEvents: "auto",
					transform: pressed ? "scale(0.94)" : hover ? "scale(1.06)" : "none",
					transition: "transform 120ms ease, box-shadow 120ms ease, background 120ms ease"
				}
			}, h("span", {
				"aria-hidden": "true",
				style: {
					transform: hover ? "rotate(-8deg)" : "none",
					transition: "transform 160ms ease"
				}
			}, "🎆"));
		}

		/** 工具调用行：第一次渲染就点火，刷新页面不重复放（sessionStorage 记号）。 */
		function FireworksCard(props) {
			const callId = props && typeof props.callId === "string" ? props.callId : "unknown";
			react.useEffect(() => {
				const key = `dsh.quitFireworks.${callId}`;
				let seen = false;
				try {
					seen = window.sessionStorage.getItem(key) === "1";
					window.sessionStorage.setItem(key, "1");
				} catch {
					/* 隐私模式下写不进去：只影响刷新去重 */
				}
				if (!seen) fire();
			}, [callId]);
			const t = props && props.t;
			const title = (t ? t("card.title") : null) || "下班烟花";
			const body = (t ? t("card.body") : null) || "已点燃，下班快乐！";
			return h("div", {
				style: {
					display: "flex",
					alignItems: "center",
					gap: 8,
					padding: "6px 10px",
					borderRadius: "var(--dsw-radius-sm, 8px)",
					border: "1px solid var(--dsw-alias-border-subtle, rgba(128,128,128,0.28))",
					background: "var(--dsw-alias-bg-subtle, rgba(128,128,128,0.08))",
					color: "var(--dsw-alias-text-2, #4b5563)",
					font: "inherit",
					fontSize: 13,
					lineHeight: "20px"
				}
			}, h("span", {
				"aria-hidden": "true",
				style: {
					fontSize: 15,
					lineHeight: "18px"
				}
			}, "🎆"), h("span", {
				style: {
					fontWeight: 600
				}
			}, title), h("span", {
				style: {
					opacity: 0.72
				}
			}, body));
		}

		const inject = ["slots", "locale"];

		/**
		 * 输入框里按回车发送时直接判断口令：命中就当场点燃，不等模型、不用改地址栏。
		 * 读的是当前聚焦输入控件的值（textarea / input / contenteditable），
		 * 输入法组字过程中的回车（isComposing）不算，避免打「烟花」两个字就误触。
		 */
		const TRIGGER = /(烟花|放烟|下班|收工|下播)/;

		/** 全局回车监听：命中口令放一场。 */
		function onKeyDown(event) {
			if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
			const target = event.target;
			if (!target || typeof target.value !== "string") {
				const active = document.activeElement;
				if (!active || typeof active.value !== "string") return;
				if (!TRIGGER.test(active.value)) return;
				fire();
				return;
			}
			if (!TRIGGER.test(target.value)) return;
			fire();
		}

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "quit-fireworks: dictionaries");
			ctx.effect(() => {
				window.addEventListener("keydown", onKeyDown, true);
				return () => window.removeEventListener("keydown", onKeyDown, true);
			}, "quit-fireworks: composer trigger");
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "quit-fireworks",
				order: 200,
				locale: NS
			}, FireworksLayer));
			ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({
				name: "tool.call.toolview",
				key: "quit_fireworks",
				locale: NS
			}, FireworksCard));
		}

		exports.inject = inject;
		exports.apply = apply;
		return module.exports;
	}
});
