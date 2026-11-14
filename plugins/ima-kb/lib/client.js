/* DSH 浏览器端 bundle：左侧菜单两个入口。
     - “IMA 知识库”：知识库名称+id 多选、组合问答、文档管理（/api/ima/* 路由）。
     - “IMA 网页”：点击左侧「IMA 网页」标签即创建 https://ima.qq.com/ 的 iframe（首次点击就加载），
       离开面板或点「卸载」即销毁，避免网页版在后台常驻轮询。
   注册 slot：
     - main（keyed）：面板内容 ImaKbPage / ImaWebPage
     - sidebar.panellist（list）：侧边栏图标 ImaKbIcon / ImaWebIcon */
window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-ima-kb",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let reactDom = require("react-dom");

		const NS = "ima.kb";
		const PANEL_ID = "ima-kb";
		const WEB_PANEL_ID = "ima-web";

		const zh = {
			"panel": "IMA 知识库",
			"panel.web": "IMA 网页",
			"back": "返回会话",
			"web.title": "IMA 网页",
			"web.hint": "IMA 网页已卸载，后台不再保持连接。点下方按钮可重新加载；离开面板也会自动销毁。",
			"web.load": "加载 IMA 网页",
			"web.loaded": "已加载 · ima.qq.com",
			"web.unload": "卸载",
			"title": "IMA 知识库",
			"subtitle": "选择一个知识库提问；下方文档区展示该知识库的目录与文档",
			"unconfigured": "IMA 凭证尚未配置。请到 设置 → 插件 → IMA Copilot 填写 X-Ima-Cookie、X-Ima-Bkn 与知识库 ID。",
			"status.ready": "已连接 · {count} 个知识库",
			"status.off": "凭据未配置",
			"kb.title": "选择知识库",
			"kb.selected": "已选 {count} 个",
			"kb.placeholder": "请选择知识库…",
			"kb.needOne": "请先选择一个知识库。",
			"kb.close": "关闭",
			"docs.folder": "文件夹",
			"ask.placeholder": "向选中的知识库提问…",
			"ask.submit": "提问",
			"ask.busy": "思考中…",
			"ask.cancel": "取消",
			"ask.cancelled": "已取消本次提问。",
			"ask.hint": "Enter 快速提问 · Shift + Enter 换行 · 提问中可继续修改问题",
			"ask.empty": "输入问题后点击“提问”。",
			"ask.emptyResponse": "IMA 未返回内容：接口或模型可能已被 IMA 调整，请稍后重试，或改用「IMA 网页」提问。",
			"refs": "引用资料",
			"docs.title": "知识库文档",
			"docs.count": "共 {count} 篇",
			"docs.empty": "暂无文档，先上传一个吧。",
			"docs.refresh": "刷新",
			"docs.upload": "上传文档",
			"docs.upload.hint": "支持 md / txt / pdf / html / docx / pptx / xlsx / epub 与图片",
			"docs.rename": "重命名",
			"docs.download": "下载",
			"docs.delete": "删除",
			"docs.delete.confirm": "确定从知识库删除该文档？此操作不可恢复。",
			"docs.rename.prompt": "输入新标题：",
			"docs.parsing": "解析中 {progress}%",
			"docs.ready": "已解析",
			"docs.noKb": "请先选择一个知识库。",
			"loading": "加载中…",
			"error": "出错"
		};
		const en = {
			"panel": "IMA Knowledge Base",
			"panel.web": "IMA Web",
			"back": "Back to conversation",
			"web.title": "IMA Web",
			"web.hint": "The IMA web app is unloaded, so no connection is kept in the background. Click below to load it again; leaving the panel destroys it as well.",
			"web.load": "Load IMA web",
			"web.loaded": "Loaded · ima.qq.com",
			"web.unload": "Unload",
			"title": "IMA Knowledge Base",
			"subtitle": "Pick one knowledge base to ask; the document area below shows its folders and files",
			"unconfigured": "IMA credentials are not configured. Fill in X-Ima-Cookie, X-Ima-Bkn and knowledge base IDs under Settings → Plugins → IMA Copilot.",
			"status.ready": "Connected · {count} knowledge bases",
			"status.off": "Not configured",
			"kb.title": "Knowledge bases",
			"kb.selected": "{count} selected",
			"kb.placeholder": "Select a knowledge base…",
			"kb.needOne": "Select a knowledge base first.",
			"kb.close": "Close",
			"docs.folder": "Folder",
			"ask.placeholder": "Ask the selected knowledge base…",
			"ask.submit": "Ask",
			"ask.busy": "Thinking…",
			"ask.cancel": "Cancel",
			"ask.cancelled": "Question cancelled.",
			"ask.hint": "Enter to ask · Shift + Enter for a new line · keep editing while an answer is pending",
			"ask.empty": "Type a question and press Ask.",
			"ask.emptyResponse": "IMA returned an empty answer: its API or model may have changed. Retry later or ask inside IMA Web.",
			"refs": "References",
			"docs.title": "Documents",
			"docs.count": "{count} documents",
			"docs.empty": "No documents yet — upload one to get started.",
			"docs.refresh": "Refresh",
			"docs.upload": "Upload document",
			"docs.upload.hint": "Supports md / txt / pdf / html / docx / pptx / xlsx / epub and images",
			"docs.rename": "Rename",
			"docs.download": "Download",
			"docs.delete": "Delete",
			"docs.delete.confirm": "Delete this document from the knowledge base? This cannot be undone.",
			"docs.rename.prompt": "New title:",
			"docs.parsing": "Parsing {progress}%",
			"docs.ready": "Parsed",
			"docs.noKb": "Select a knowledge base first.",
			"loading": "Loading…",
			"error": "Error"
		};

		// ---------- 请求辅助 ----------
		// 请求统一带超时（可用外部 signal 取消）：避免上游卡住时 asking 永久为 true，导致按钮和回车都像“失效”。
		async function callApi(endpoint, payload, signal) {
			const timeout = AbortSignal.timeout(240000);
			const response = await fetch(endpoint, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(payload ?? {}),
				signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout])
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const data = await response.json();
			if (data && data.ok === false) throw new Error(data.error ?? "request failed");
			return data;
		}
		function readAsBase64(file) {
			return new Promise((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => {
					const result = reader.result;
					if (typeof result !== "string") {
						reject(new Error("read failed"));
						return;
					}
					resolve(result.split(",")[1] ?? "");
				};
				reader.onerror = () => reject(new Error("read failed"));
				reader.readAsDataURL(file);
			});
		}
		function formatSize(bytes) {
			if (bytes === undefined || bytes === null) return "";
			if (bytes < 1024) return `${bytes} B`;
			if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
			return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
		}
		function mediaTypeLabel(type) {
			const map = { 1: "PDF", 2: "WEB", 3: "WORD", 4: "WX", 5: "PPT", 6: "WX", 7: "MD", 8: "IMG", 9: "NOTE", 20: "TXT", 99: "DIR" };
			return map[type] ?? String(type ?? "?");
		}

		// ---------- 样式 ----------
		const styles = {
			page: {
				display: "grid", gap: 18, padding: "28px 24px 48px",
				maxWidth: 1280, margin: "0 auto", width: "100%", boxSizing: "border-box",
				color: "var(--dsw-alias-label-primary)"
			},
			header: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, paddingBottom: 2 },
			headerActions: { display: "flex", alignItems: "center", gap: 8, flex: "none", flexWrap: "wrap", justifyContent: "flex-end" },
			headerText: { display: "grid", gap: 6, minWidth: 0 },
			title: { margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: -0.3, lineHeight: 1.25 },
			subtitle: { margin: 0, fontSize: 13, lineHeight: 1.5, opacity: 0.6, color: "var(--dsw-alias-label-secondary)" },
			statusPill: { flex: "none", marginTop: 4, fontSize: 12, padding: "3px 10px", borderRadius: 999, background: "rgba(23,105,170,0.08)", color: "#1769aa", whiteSpace: "nowrap" },
			statusPillOff: { flex: "none", marginTop: 4, fontSize: 12, padding: "3px 10px", borderRadius: 999, background: "rgba(0,0,0,0.05)", color: "var(--dsw-alias-label-tertiary)", whiteSpace: "nowrap" },
			warning: { margin: 0, padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(196,122,0,0.35)", color: "#9a5b00", background: "rgba(196,122,0,0.08)", fontSize: 13, lineHeight: 1.5 },
			card: { border: "1px solid var(--dsw-alias-border-l3, #ebebeb)", borderRadius: 14, background: "var(--dsw-alias-bg-base, #fff)", boxShadow: "0 1px 2px rgba(0,0,0,0.04)", overflow: "hidden" },
			cardHead: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "13px 18px", borderBottom: "1px solid var(--dsw-alias-border-l3, #efefef)" },
			cardTitleRow: { display: "flex", alignItems: "center", gap: 10, minWidth: 0 },
			iconChip: { width: 26, height: 26, borderRadius: 8, display: "inline-grid", placeItems: "center", fontSize: 14, flex: "none" },
			cardTitle: { margin: 0, fontSize: 15, fontWeight: 600, color: "var(--dsw-alias-label-primary)", whiteSpace: "nowrap" },
			cardMeta: { fontSize: 12, opacity: 0.55, color: "var(--dsw-alias-label-tertiary)", fontWeight: 400 },
			metaPill: { fontSize: 12, padding: "2px 9px", borderRadius: 999, background: "rgba(23,105,170,0.07)", color: "#1769aa", whiteSpace: "nowrap" },
			cardBody: { padding: 18, display: "grid", gap: 12 },
			actions: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
			button: { borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 13, border: "1px solid var(--dsw-alias-border-l2, #d7d7d7)", background: "var(--dsw-alias-bg-base, #fff)", color: "inherit", lineHeight: 1.4 },
			buttonPrimary: { borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontSize: 13, border: "1px solid #1769aa", background: "#1769aa", color: "#fff", lineHeight: 1.4 },
			buttonDanger: { borderRadius: 8, padding: "4px 8px", cursor: "pointer", fontSize: 12, border: "1px solid transparent", background: "transparent", color: "var(--dsw-alias-state-error-primary, #c33)" },
			buttonDisabled: { opacity: 0.5, cursor: "not-allowed" },
			input: { width: "100%", boxSizing: "border-box", border: "1px solid var(--dsw-alias-border-l2, #d0d0d0)", borderRadius: 10, padding: "10px 12px", background: "rgba(0,0,0,0.02)", color: "inherit", font: "inherit" },
			textarea: { resize: "vertical", minHeight: 88, lineHeight: 1.6 },
			askHint: { margin: 0, fontSize: 12, opacity: 0.5, color: "var(--dsw-alias-label-tertiary)" },
			answer: { margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 14, lineHeight: 1.65, color: "var(--dsw-alias-label-primary)" },
			answerBox: { border: "1px solid var(--dsw-alias-border-l3, #e8e8e8)", borderRadius: 12, padding: "14px 16px", background: "rgba(0,0,0,0.025)", display: "grid", gap: 12, maxHeight: 480, overflowY: "auto" },
			kbGroup: { display: "grid", gap: 8 },
			kbGroupTitle: { margin: 0, fontSize: 13.5, fontWeight: 600, color: "var(--dsw-alias-label-primary)", display: "flex", gap: 8, alignItems: "center" },
			kbGroupError: { margin: 0, fontSize: 13, color: "var(--dsw-alias-state-error-primary, #c33)", lineHeight: 1.5 },
			refsTitle: { margin: 0, fontSize: 12, fontWeight: 600, opacity: 0.65, color: "var(--dsw-alias-label-secondary)", letterSpacing: 0.2 },
			refItem: { margin: 0, fontSize: 13, lineHeight: 1.5, color: "var(--dsw-alias-label-secondary)" },
			docRow: { display: "flex", alignItems: "center", gap: 10, padding: "10px 4px", borderBottom: "1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.05))" },
			docRowButton: { display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 4px", border: "none", borderBottom: "1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.05))", background: "transparent", color: "inherit", font: "inherit", textAlign: "left", cursor: "pointer" },
			crumbs: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 2, fontSize: 12.5 },
			crumbLink: { border: "none", background: "transparent", color: "#1769aa", cursor: "pointer", padding: "0 2px", font: "inherit", fontSize: 12.5 },
			crumbCurrent: { color: "var(--dsw-alias-label-tertiary)", padding: "0 2px" },
			crumbSep: { color: "var(--dsw-alias-label-tertiary)" },
			docTitle: { flex: 1, minWidth: 0, fontSize: 13.5, color: "var(--dsw-alias-label-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
			badge: { flex: "none", fontSize: 10.5, padding: "2px 7px", borderRadius: 6, border: "1px solid var(--dsw-alias-border-l2, #d9d9d9)", color: "var(--dsw-alias-label-tertiary)", fontFamily: "ui-monospace, Consolas, monospace", letterSpacing: 0.3 },
			docMeta: { flex: "none", fontSize: 12, opacity: 0.55, color: "var(--dsw-alias-label-tertiary)", whiteSpace: "nowrap" },
			docLink: { fontSize: 12, color: "#1769aa", textDecoration: "none", padding: "4px 6px", borderRadius: 6, border: "1px solid rgba(23,105,170,0.25)" },
			error: { margin: 0, fontSize: 13, color: "var(--dsw-alias-state-error-primary, #c33)", lineHeight: 1.5, padding: "0 2px" },
			empty: { margin: 0, fontSize: 13, opacity: 0.55, color: "var(--dsw-alias-label-secondary)", lineHeight: 1.6 },
			refNum: { color: "#1769aa", fontWeight: 600 },
			kbList: { display: "grid", gap: 6, maxHeight: 300, overflow: "auto", paddingRight: 2 },
			kbItem: { display: "flex", gap: 10, alignItems: "flex-start", padding: "9px 12px", borderRadius: 10, cursor: "pointer", border: "1px solid transparent", transition: "background-color .12s ease, border-color .12s ease" },
			kbItemChecked: { background: "rgba(23,105,170,0.07)", borderColor: "rgba(23,105,170,0.32)" },
			kbCheck: { marginTop: 3, flex: "none", accentColor: "#1769aa", width: 16, height: 16 },
			kbName: { fontSize: 13.5, fontWeight: 500, color: "var(--dsw-alias-label-primary)", lineHeight: 1.4 },
			kbId: { fontSize: 11.5, opacity: 0.5, color: "var(--dsw-alias-label-tertiary)", fontFamily: "ui-monospace, Consolas, monospace", wordBreak: "break-all" },
			scrollBox: { maxHeight: 420, overflowY: "auto" },
			kbSelect: { position: "relative" },
			kbSelectButton: { width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 14px", borderRadius: 10, border: "1px solid var(--dsw-alias-border-l2, #d0d0d0)", background: "var(--dsw-alias-bg-base, #fff)", color: "inherit", cursor: "pointer", fontSize: 13.5, textAlign: "left" },
			kbSelectSummary: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
			kbSelectCaret: { opacity: 0.5, fontSize: 10, flex: "none" },
			kbDropdown: { position: "fixed", zIndex: 2000, boxSizing: "border-box", background: "var(--dsw-alias-bg-base, #fff)", border: "1px solid var(--dsw-alias-border-l2, #d7d7d7)", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.16)", padding: 8, display: "flex", flexDirection: "column", gap: 6 },
			kbDropdownList: { display: "grid", gap: 4, overflowY: "auto", minHeight: 0, paddingRight: 2 },
			kbDropdownFooter: { display: "flex", justifyContent: "flex-end", gap: 8, paddingTop: 8, marginTop: 6, borderTop: "1px solid var(--dsw-alias-border-l3, #eee)" },
			webGateHost: { width: "100%", height: "calc(100vh - 72px)", minHeight: 520, boxSizing: "border-box", display: "grid", placeItems: "center", padding: 24 },
			webGate: { display: "grid", justifyItems: "center", gap: 10, maxWidth: 520, padding: "24px 26px", border: "1px solid var(--dsw-alias-border-l3, #ebebeb)", borderRadius: 14, background: "var(--dsw-alias-bg-base, #fff)", textAlign: "center" },
			webShell: { width: "100%", height: "calc(100vh - 72px)", minHeight: 520, display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", background: "#fff", overflow: "hidden" },
			webBar: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "6px 12px", borderBottom: "1px solid var(--dsw-alias-border-l3, #efefef)", background: "var(--dsw-alias-bg-base, #fff)" },
			webBarText: { fontSize: 12, color: "var(--dsw-alias-label-tertiary)" },
			webFrame: { width: "100%", height: "100%", border: "none", display: "block", background: "#fff" }
		};

		// ---------- 图标 ----------
		function ImaKbIcon({ size, active }) {
			return react.createElement("svg", {
				width: size, height: size, viewBox: "0 0 24 24", fill: "none",
				xmlns: "http://www.w3.org/2000/svg", "aria-hidden": "true"
			},
				react.createElement("path", {
					d: "M12 5.6C10.7 4.4 8.5 3.9 5.5 3.9V18.3C8.5 18.3 10.7 18.8 12 20C13.3 18.8 15.5 18.3 18.5 18.3V3.9C15.5 3.9 13.3 4.4 12 5.6Z",
					stroke: "currentColor", strokeWidth: 1.6, strokeLinejoin: "round"
				}),
				react.createElement("path", {
					d: "M12 5.6V20",
					stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round"
				})
			);
		}
		/** IMA 首页图标（项目内 assets/ima-home.svg，由宿主 /api/ima/icon 提供）。 */
		function ImaWebIcon({ size }) {
			return react.createElement("img", {
				src: "/api/ima/icon",
				alt: "",
				"aria-hidden": "true",
				style: { width: size, height: size, flex: "none", borderRadius: 4, display: "block" }
			});
		}
		function IconChip({ emoji, tint }) {
			return react.createElement("span", {
				style: { ...styles.iconChip, background: tint ?? "rgba(23,105,170,0.10)" }
			}, emoji);
		}

		// ---------- 整页 IMA 网页（点击标签即加载，可手动卸载） ----------
		function ImaWebPage({ t, backToConversation }) {
			const [loaded, setLoaded] = react.useState(true);
			if (!loaded) {
				return react.createElement("div", { style: styles.webGateHost, "data-testid": "ima-web-gate" },
					react.createElement("div", { style: styles.webGate },
						react.createElement(IconChip, { emoji: "🌐", tint: "rgba(23,105,170,0.10)" }),
						react.createElement("h2", { style: styles.cardTitle }, t("web.title")),
						react.createElement("p", { style: styles.empty }, t("web.hint")),
						react.createElement("button", {
							type: "button",
							style: styles.buttonPrimary,
							onClick: () => setLoaded(true),
							"data-testid": "ima-web-load"
						}, t("web.load"))
					)
				);
			}
			return react.createElement("div", { style: styles.webShell, "data-testid": "ima-web-page" },
				react.createElement("div", { style: styles.webBar },
					react.createElement("span", { style: styles.webBarText }, t("web.loaded")),
					react.createElement("div", { style: styles.actions },
						react.createElement("button", {
							type: "button",
							style: styles.button,
							onClick: backToConversation,
							"data-testid": "ima-back"
						}, t("back")),
						react.createElement("button", {
							type: "button",
							style: styles.button,
							onClick: () => setLoaded(false),
							"data-testid": "ima-web-unload"
						}, t("web.unload"))
					)
				),
				react.createElement("iframe", {
					src: "https://ima.qq.com/",
					title: "IMA",
					style: styles.webFrame
				})
			);
		}

		// ---------- 答案渲染 ----------
		function References({ references, t }) {
			if (!references || references.length === 0) return null;
			return react.createElement(react.Fragment, null,
				react.createElement("p", { style: styles.refsTitle }, t("refs")),
				references.map((ref, index) => react.createElement("p", { key: ref.id, style: styles.refItem },
					react.createElement("span", { style: styles.refNum }, `${index + 1}. `),
					ref.title,
					ref.knowledgeBase ? ` — ${ref.knowledgeBase}` : "",
					` (${ref.id})`
				))
			);
		}
		function AnswerView({ result, t }) {
			if (!result) return null;
			if (result.combined) {
				return react.createElement("div", { style: styles.answerBox },
					(Array.isArray(result.results) ? result.results : []).map((entry) => react.createElement("div", {
						key: entry.knowledgeBaseId,
						style: styles.kbGroup
					},
						react.createElement("p", { style: styles.kbGroupTitle },
							"📚 ", entry.knowledgeBase, react.createElement("span", { style: styles.kbId }, entry.knowledgeBaseId)
						),
						entry.error ? react.createElement("p", { style: styles.kbGroupError }, entry.error)
							: react.createElement("p", { style: styles.answer }, entry.answer || t("ask.empty")),
						entry.error ? null : react.createElement(References, { references: entry.references, t })
					))
				);
			}
			return react.createElement("div", { style: styles.answerBox },
				react.createElement("p", { style: styles.answer }, result.answer || t("ask.emptyResponse")),
				react.createElement(References, { references: result.references, t })
			);
		}

		// ---------- 知识库工具页 ----------
		function ImaKbPage({ t, backToConversation }) {
			const [status, setStatus] = react.useState(null);
			const [selected, setSelected] = react.useState([]);
			const [folderId, setFolderId] = react.useState(null);
			const [docs, setDocs] = react.useState(null);
			const [docsLoading, setDocsLoading] = react.useState(false);
			const [question, setQuestion] = react.useState("");
			const [asking, setAsking] = react.useState(false);
			const [result, setResult] = react.useState(null);
			const [error, setError] = react.useState("");
			const [uploading, setUploading] = react.useState(false);
			const fileInput = react.useRef(null);
			const [kbOpen, setKbOpen] = react.useState(false);
			const [kbPos, setKbPos] = react.useState(null);
			const kbSelectRef = react.useRef(null);
			const kbDropdownRef = react.useRef(null);
			const askAbortRef = react.useRef(null);

			// 下拉面板通过 portal 挂到 body 并用 fixed 定位：既不被卡片的 overflow 裁剪，也不会被下方卡片盖住。
			const measureKbMenu = () => {
				const el = kbSelectRef.current;
				if (el === null) return null;
				const rect = el.getBoundingClientRect();
				const gap = 6;
				const spaceBelow = window.innerHeight - rect.bottom - gap - 12;
				const spaceAbove = rect.top - gap - 12;
				const openAbove = spaceBelow < 200 && spaceAbove > spaceBelow;
				const available = Math.max(80, openAbove ? spaceAbove : spaceBelow);
				const maxHeight = Math.min(320, available);
				return openAbove
					? { bottom: window.innerHeight - rect.top + gap, left: rect.left, width: rect.width, maxHeight }
					: { top: rect.bottom + gap, left: rect.left, width: rect.width, maxHeight };
			};

			const toggleKbMenu = () => {
				if (kbOpen) {
					setKbOpen(false);
					return;
				}
				setKbPos(measureKbMenu());
				setKbOpen(true);
			};

			const applyError = (cause) => setError(cause instanceof Error ? cause.message : String(cause));

			react.useEffect(() => {
				callApi("/api/ima/status")
					.then((data) => {
						setStatus(data);
						const list = Array.isArray(data.knowledgeBases) ? data.knowledgeBases : [];
						if (list.length > 0) setSelected((current) => (current.length > 0 ? current : [list[0].id]));
					})
					.catch(applyError);
			}, []);

			const kbList = (status && Array.isArray(status.knowledgeBases)) ? status.knowledgeBases : [];
			const configured = !!(status && status.configured);
			const firstKbId = selected.length > 0 ? selected[0] : "";

			const pickKb = (id) => {
				setSelected([id]);
				setFolderId(null);
				setKbOpen(false);
			};

			const refresh = react.useCallback(() => {
				if (!firstKbId) return;
				setDocsLoading(true);
				setError("");
				callApi("/api/ima/list", { knowledgeBaseId: firstKbId, folderId })
					.then((data) => setDocs(data))
					.catch(applyError)
					.finally(() => setDocsLoading(false));
			}, [firstKbId, folderId]);

			react.useEffect(() => {
				if (status && status.configured && firstKbId) refresh();
			}, [status, firstKbId, refresh]);

			react.useEffect(() => {
				if (!kbOpen) return;
				const onDocumentMouseDown = (event) => {
					if (kbSelectRef.current !== null && kbSelectRef.current.contains(event.target)) return;
					if (kbDropdownRef.current !== null && kbDropdownRef.current.contains(event.target)) return;
					setKbOpen(false);
				};
				const onKeyDown = (event) => {
					if (event.key === "Escape") setKbOpen(false);
				};
				const reposition = () => setKbPos(measureKbMenu());
				document.addEventListener("mousedown", onDocumentMouseDown);
				document.addEventListener("keydown", onKeyDown);
				window.addEventListener("resize", reposition);
				window.addEventListener("scroll", reposition, true);
				return () => {
					document.removeEventListener("mousedown", onDocumentMouseDown);
					document.removeEventListener("keydown", onKeyDown);
					window.removeEventListener("resize", reposition);
					window.removeEventListener("scroll", reposition, true);
				};
			}, [kbOpen]);

			const selectedNames = kbList.filter((entry) => selected.includes(entry.id)).map((entry) => entry.name);

			// 提问期间按钮变成「取消」：请求卡住时能主动中断，不会出现按钮和回车都点不动的情况。
			const sendQuestion = () => {
				if (asking) return;
				const text = question.trim();
				if (text.length === 0) {
					setError(t("ask.empty"));
					return;
				}
				if (selected.length === 0) {
					setError(t("kb.needOne"));
					return;
				}
				const controller = new AbortController();
				askAbortRef.current = controller;
				setAsking(true);
				setError("");
				setResult(null);
				callApi("/api/ima/ask", { question: text, knowledgeBaseIds: selected }, controller.signal)
					.then((data) => setResult(data))
					.catch((cause) => {
						if (controller.signal.aborted) setError(t("ask.cancelled"));
						else applyError(cause);
					})
					.finally(() => {
						askAbortRef.current = null;
						setAsking(false);
					});
			};
			const cancelAsk = () => {
				askAbortRef.current?.abort();
			};

			const onPickFile = (event) => {
				const file = event.target.files && event.target.files[0];
				event.target.value = "";
				if (!file || !firstKbId) return;
				setUploading(true);
				setError("");
				readAsBase64(file)
					.then((dataBase64) => callApi("/api/ima/upload", {
						fileName: file.name,
						dataBase64,
						title: null,
						knowledgeBaseId: firstKbId,
						folderId
					}))
					.then(() => refresh())
					.catch(applyError)
					.finally(() => setUploading(false));
			};

			const onRename = (doc) => {
				const title = window.prompt(t("docs.rename.prompt"), doc.title);
				if (title === null || title.trim().length === 0) return;
				callApi("/api/ima/rename", { mediaId: doc.mediaId, title: title.trim(), knowledgeBaseId: firstKbId })
					.then(() => refresh())
					.catch(applyError);
			};

			const onDelete = (doc) => {
				if (!window.confirm(t("docs.delete.confirm"))) return;
				callApi("/api/ima/delete", { mediaIds: [doc.mediaId], knowledgeBaseId: firstKbId })
					.then(() => refresh())
					.catch(applyError);
			};

			const structuredDocs = docs && docs.structured !== false;
			const docsItems = docs && Array.isArray(docs.items) ? docs.items : [];

			return react.createElement("div", { style: styles.page, "data-testid": "ima-kb-page" },
				react.createElement("header", { style: styles.header },
					react.createElement("div", { style: styles.headerText },
						react.createElement("h1", { style: styles.title }, t("title")),
						react.createElement("p", { style: styles.subtitle }, t("subtitle"))
					),
					react.createElement("div", { style: styles.headerActions },
						status === null ? null : react.createElement("span", {
							style: configured ? styles.statusPill : styles.statusPillOff
						}, configured ? t("status.ready").replace("{count}", String(kbList.length)) : t("status.off")),
						react.createElement("button", {
							type: "button",
							style: styles.button,
							onClick: backToConversation,
							"data-testid": "ima-back"
						}, t("back"))
					)
				),				!configured && react.createElement("p", { role: "alert", style: styles.warning }, t("unconfigured")),
				configured && react.createElement("section", { style: styles.card },
					react.createElement("div", { style: styles.cardHead },
						react.createElement("div", { style: styles.cardTitleRow },
							react.createElement(IconChip, { emoji: "📚", tint: "rgba(23,105,170,0.10)" }),
							react.createElement("h2", { style: styles.cardTitle }, t("kb.title"))
						),
						react.createElement("span", { style: styles.metaPill }, t("kb.selected").replace("{count}", String(selected.length)))
					),
					react.createElement("div", { style: styles.cardBody },
						react.createElement("div", { style: styles.kbSelect, ref: kbSelectRef },
							react.createElement("button", {
								type: "button",
								style: styles.kbSelectButton,
								onClick: toggleKbMenu,
								"aria-haspopup": "true",
								"aria-expanded": kbOpen ? "true" : "false",
								"data-testid": "ima-kb-select"
							},
								react.createElement("span", { style: styles.kbSelectSummary },
									selected.length === 0
										? t("kb.placeholder")
										: `${t("kb.selected").replace("{count}", String(selected.length))}${selectedNames.length > 0 ? ` · ${selectedNames.join("、")}` : ""}`),
								react.createElement("span", { style: styles.kbSelectCaret }, kbOpen ? "▲" : "▼")
							),
							kbOpen && kbPos !== null && reactDom.createPortal(
								react.createElement("div", {
									ref: kbDropdownRef,
									style: { ...styles.kbDropdown, ...kbPos },
									role: "group",
									"aria-label": t("kb.title"),
									"data-testid": "ima-kb-dropdown"
								},
									react.createElement("div", { style: styles.kbDropdownList },
										kbList.map((entry) => {
											const checked = selected.includes(entry.id);
											return react.createElement("label", {
												key: entry.id,
												style: { ...styles.kbItem, ...(checked ? styles.kbItemChecked : {}) }
											},
												react.createElement("input", {
													type: "radio",
													name: "ima-kb-pick",
													style: styles.kbCheck,
													checked,
													onChange: () => pickKb(entry.id)
												}),
												react.createElement("span", { style: { display: "grid", gap: 1, minWidth: 0 } },
													react.createElement("span", { style: styles.kbName }, entry.name),
													react.createElement("span", { style: styles.kbId }, entry.id)
												)
											);
										})
									),
									react.createElement("div", { style: styles.kbDropdownFooter },
										react.createElement("button", { type: "button", style: styles.button, onClick: () => setKbOpen(false), children: t("kb.close") })
									)
								),
								document.body
							)
						)
					)
				),
				configured && react.createElement("section", { style: styles.card },
					react.createElement("div", { style: styles.cardHead },
						react.createElement("div", { style: styles.cardTitleRow },
							react.createElement(IconChip, { emoji: "💬", tint: "rgba(120,80,200,0.10)" }),
							react.createElement("h2", { style: styles.cardTitle }, "IMA")
						),
						react.createElement("button", {
							type: "button",
							style: asking ? styles.button : styles.buttonPrimary,
							onClick: asking ? cancelAsk : sendQuestion,
							"aria-busy": asking ? "true" : "false",
							"data-testid": asking ? "ima-ask-cancel" : "ima-ask-send",
							children: asking ? t("ask.cancel") : t("ask.submit")
						})
					),
					react.createElement("div", { style: styles.cardBody },
						react.createElement("textarea", {
							style: { ...styles.input, ...styles.textarea },
							rows: 3,
							placeholder: t("ask.placeholder"),
							value: question,
							onChange: (event) => setQuestion(event.target.value),
							onKeyDown: (event) => {
								if (event.key !== "Enter" || event.isComposing || event.shiftKey) return;
								event.preventDefault();
								sendQuestion();
							}
						}),
						asking && react.createElement("p", { style: styles.askHint, role: "status" }, t("ask.busy")),
						react.createElement("p", { style: styles.askHint }, t("ask.hint")),
						react.createElement(AnswerView, { result, t })
					)
				),
				error && react.createElement("p", { role: "alert", style: styles.error }, `${t("error")}: ${error}`),
				configured && react.createElement("section", { style: styles.card },
					react.createElement("div", { style: styles.cardHead },
						react.createElement("div", { style: styles.cardTitleRow },
							react.createElement(IconChip, { emoji: "📄", tint: "rgba(0,140,120,0.10)" }),
							react.createElement("div", { style: { display: "grid", gap: 1 } },
								react.createElement("h2", { style: styles.cardTitle }, t("docs.title")),
								react.createElement("span", { style: styles.cardMeta },
									docs && structuredDocs ? t("docs.count").replace("{count}", String(docs.total ?? docsItems.length)) : ""
								)
							)
						),
						react.createElement("div", { style: styles.actions },
							react.createElement("button", { type: "button", style: styles.button, onClick: refresh, disabled: docsLoading || !firstKbId, children: docsLoading ? t("loading") : t("docs.refresh") }),
							react.createElement("button", {
								type: "button",
								style: { ...styles.buttonPrimary, ...(uploading || !firstKbId ? styles.buttonDisabled : {}) },
								disabled: uploading || !firstKbId,
								onClick: () => fileInput.current && fileInput.current.click(),
								children: uploading ? t("loading") : t("docs.upload")
							}),
							react.createElement("input", {
								ref: fileInput,
								type: "file",
								style: { display: "none" },
								accept: ".md,.markdown,.txt,.pdf,.html,.htm,.docx,.doc,.pptx,.xlsx,.epub,.png,.jpg,.jpeg,.webp,.gif",
								onChange: onPickFile
							})
						)
					),
					react.createElement("div", { style: { ...styles.cardBody, maxHeight: 520, overflowY: "auto" } },
						!firstKbId && react.createElement("p", { style: styles.empty }, t("docs.noKb")),
						firstKbId && react.createElement(react.Fragment, null,
							react.createElement("p", { style: styles.empty }, t("docs.upload.hint")),
							!structuredDocs && docs && react.createElement(react.Fragment, null,
								docs.note && react.createElement("p", { style: styles.empty }, docs.note),
								react.createElement("p", { style: styles.answer }, docs.answer || t("docs.empty"))
							),
							docs && structuredDocs && Array.isArray(docs.path) && docs.path.length > 1 && react.createElement("div", { style: styles.crumbs, "data-testid": "ima-crumbs" },
								docs.path.map((entry, index) => react.createElement(react.Fragment, { key: String(entry.folder_id ?? index) },
									index > 0 && react.createElement("span", { style: styles.crumbSep }, "/"),
									index === docs.path.length - 1
										? react.createElement("span", { style: styles.crumbCurrent }, entry.name)
										: react.createElement("button", {
											type: "button",
											style: styles.crumbLink,
											onClick: () => setFolderId(index === 0 ? null : entry.folder_id)
										}, entry.name)
								))
							),
							structuredDocs && docsItems.length === 0 && react.createElement("p", { style: styles.empty }, t("docs.empty")),
							structuredDocs && docsItems.map((doc) => {
								if (doc.isFolder === true || doc.mediaType === 99) {
									return react.createElement("button", {
										key: doc.mediaId,
										type: "button",
										style: styles.docRowButton,
										onClick: () => setFolderId(doc.folderId ?? doc.mediaId),
										"data-testid": "ima-folder"
									},
										react.createElement("span", { style: styles.badge }, "DIR"),
										react.createElement("span", { style: styles.docTitle, title: doc.title }, doc.title),
										react.createElement("span", { style: styles.docMeta }, t("docs.folder"))
									);
								}
								const parsing = typeof doc.parseProgress === "number" && doc.parseProgress < 100;
								return react.createElement("div", { key: doc.mediaId, style: styles.docRow },
									react.createElement("span", { style: styles.badge }, mediaTypeLabel(doc.mediaType)),
									react.createElement("span", { style: styles.docTitle, title: doc.title }, doc.title),
									parsing && react.createElement("span", { style: styles.docMeta }, t("docs.parsing").replace("{progress}", String(doc.parseProgress))),
									!parsing && typeof doc.parseProgress === "number" && react.createElement("span", { style: styles.docMeta }, t("docs.ready")),
									react.createElement("span", { style: styles.docMeta }, formatSize(doc.fileSize)),
									react.createElement("div", { style: styles.actions },
										doc.downloadUrl ? react.createElement("a", {
											href: doc.downloadUrl,
											target: "_blank",
											rel: "noreferrer",
											download: doc.title || undefined,
											style: styles.docLink,
											"data-testid": "ima-doc-download"
										}, t("docs.download")) : null,
										react.createElement("button", { type: "button", style: styles.buttonDanger, onClick: () => onRename(doc), children: t("docs.rename") }),
										react.createElement("button", { type: "button", style: styles.buttonDanger, onClick: () => onDelete(doc), children: t("docs.delete") })
									)
								);
							})
						)
					)
				)
			);
		}

		// ---------- 设置页：IMA 凭据（嵌入 settings.section） ----------
		const IMA_REFS = ["IMA_X_IMA_COOKIE", "IMA_X_IMA_BKN", "IMA_KNOWLEDGE_BASE_IDS"];
		function isPlainRecord(value) {
			return typeof value === "object" && value !== null;
		}
		function hasCredentialMethods(value) {
			return isPlainRecord(value) && typeof value.describe === "function" && typeof value.set === "function";
		}
		function safeService(ctx, name) {
			try {
				return typeof ctx.get === "function" ? ctx.get(name) : void 0;
			} catch {
				return void 0;
			}
		}
		function unwrapCredentialResult(result) {
			if (result.ok) return result.value;
			throw new Error(result.error && typeof result.error.message === "string" ? result.error.message : "credential operation failed");
		}
		function gatewayCredentials(service) {
			return {
				async describe(refs) { return unwrapCredentialResult(await service.describe([...refs])); },
				async set(ref, value) { unwrapCredentialResult(await service.set(ref, value)); }
			};
		}
		function legacyCredentials(service) {
			return {
				async describe(refs) {
					const response = await service.describe({ refs: [...refs] });
					if (!response.result.ok) throw new Error(response.result.error.message);
					return response.result.value.credentials;
				},
				async set(ref, value) {
					const response = await service.set({ ref, value });
					if (!response.result.ok) throw new Error(response.result.error.message);
				}
			};
		}
		function findGatewayCredentials(ctx) {
			const remote = safeService(ctx, "remote");
			const service = safeService(ctx, "remote.credentials") ?? (isPlainRecord(remote) ? remote.credentials : void 0);
			return hasCredentialMethods(service) ? gatewayCredentials(service) : void 0;
		}
		function findLegacyCredentials(ctx) {
			const connection = safeService(ctx, "connection");
			const service = isPlainRecord(connection) && isPlainRecord(connection.api) ? connection.api.credentials : void 0;
			return hasCredentialMethods(service) ? legacyCredentials(service) : void 0;
		}
		function createClientCredentials(ctx) {
			const credentials = findGatewayCredentials(ctx) ?? findLegacyCredentials(ctx);
			if (credentials) return credentials;
			throw new Error("IMA settings cannot start: missing credential capabilities");
		}
		function ImaSettingsCard(props) {
			const [values, setValues] = react.useState({});
			const [state, setState] = react.useState({});
			const [saving, setSaving] = react.useState(false);
			const [error, setError] = react.useState();
			const [saved, setSaved] = react.useState(false);
			const refresh = react.useCallback(async () => {
				setState(await props.credentials.describe(IMA_REFS));
			}, [props.credentials]);
			react.useEffect(() => {
				refresh().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
			}, [refresh]);
			const save = async () => {
				setSaving(true);
				setError(void 0);
				setSaved(false);
				try {
					for (const ref of IMA_REFS) {
						const value = values[ref]?.trim();
						if (value !== undefined && value.length > 0) await props.credentials.set(ref, value);
					}
					setValues({});
					setSaved(true);
					await refresh();
				} catch (cause) {
					setError(cause instanceof Error ? cause.message : String(cause));
				} finally {
					setSaving(false);
				}
			};
			const fields = [
				["IMA_X_IMA_COOKIE", "X-Ima-Cookie（完整 Cookie）", true],
				["IMA_X_IMA_BKN", "X-Ima-Bkn（纯数字）", true],
				["IMA_KNOWLEDGE_BASE_IDS", "知识库 ID（逗号或换行分隔）", false]
			];
			const dirty = IMA_REFS.some((ref) => (values[ref]?.trim().length ?? 0) > 0);
			return react.createElement("div", { style: styles.page },
				react.createElement("header", { style: styles.header },
					react.createElement("div", { style: styles.headerText },
						react.createElement("h1", { style: styles.title }, "IMA 凭据设置"),
						react.createElement("p", { style: styles.subtitle }, "与「IMA 知识库」「IMA 网页」共用同一份凭据，保存在 ~/.dsh/.credentials.yaml；保存后实时生效，无需重启。")
					)
				),
				react.createElement("section", { style: styles.card },
					react.createElement("div", { style: styles.cardHead },
						react.createElement("div", { style: styles.cardTitleRow },
							react.createElement(IconChip, { emoji: "🔐", tint: "rgba(23,105,170,0.10)" }),
							react.createElement("h2", { style: styles.cardTitle }, "IMA 认证与知识库")
						)
					),
					react.createElement("div", { style: styles.cardBody },
						fields.map(([ref, label, secret]) => react.createElement("label", { key: ref, style: { display: "grid", gap: 6 } },
							react.createElement("span", { style: { fontSize: 13, fontWeight: 600 } }, label),
							react.createElement("input", {
								type: secret ? "password" : "text",
								autoComplete: "off",
								value: values[ref] ?? "",
								placeholder: state[ref]?.configured ? "已配置，输入新值可替换" : "尚未配置",
								disabled: state[ref]?.writable === false || saving,
								onChange: (event) => setValues((current) => ({ ...current, [ref]: event.target.value })),
								style: styles.input
							}),
							react.createElement("small", { style: styles.askHint }, state[ref]?.configured ? "已配置" : "未配置")
						)),
						error === void 0 ? null : react.createElement("p", { role: "alert", style: styles.error }, error),
						react.createElement("div", { style: { display: "flex", justifyContent: "flex-end", gap: 8 } },
							react.createElement("button", {
								type: "button",
								style: { ...styles.buttonPrimary, ...(saving || !dirty ? styles.buttonDisabled : {}) },
								disabled: saving || !dirty,
								onClick: save,
								children: saving ? "保存中…" : (saved ? "已保存" : "保存")
							})
						),
						react.createElement("p", { style: styles.empty }, "如果 IMA 返回 code 41，请从同一个浏览器请求中重新复制 X-Ima-Cookie 与 X-Ima-Bkn，并同时替换。")
					)
				)
			);
		}
		function installImaSettings(ctx, slots) {
			const registerCard = (credentials) => slots.register({
				name: "settings.section",
				id: "ima-kb",
				order: 20,
				label: "IMA",
				inject: () => ({ credentials })
			}, ImaSettingsCard);
			if (typeof ctx.inject !== "function") return registerCard(createClientCredentials(ctx));
			const gateway = ctx.inject(["remote.credentials"], (child) => {
				const credentials = findGatewayCredentials(child);
				if (credentials) return registerCard(credentials);
			});
			const legacy = ctx.inject(["connection"], (child) => {
				const credentials = findLegacyCredentials(child);
				if (credentials) return registerCard(credentials);
			});
			return () => {
				gateway.dispose();
				legacy.dispose();
			};
		}

		// ---------- 插件入口 ----------
		const inject = ["slots", "locale", "layout"];
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "ima-kb: dictionaries");
			const t = ctx.locale.bind(NS);
			// 切回会话但不改变当前选中的会话；会话本身由 layout/sessions 持有，面板切换不会销毁它。
			const backToConversation = () => ctx.layout.selectPanel(null);
			ctx.slots.inject("main", () => ctx.slots.register({
				name: "main",
				key: PANEL_ID,
				locale: NS,
				inject: () => ({ backToConversation })
			}, ImaKbPage));
			ctx.slots.inject("main", () => ctx.slots.register({
				name: "main",
				key: WEB_PANEL_ID,
				locale: NS,
				inject: () => ({ backToConversation })
			}, ImaWebPage));
			ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
				name: "sidebar.panellist",
				id: PANEL_ID,
				order: 30,
				locale: NS,
				label: () => t("panel")
			}, ImaKbIcon));
			ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
				name: "sidebar.panellist",
				id: WEB_PANEL_ID,
				order: 31,
				locale: NS,
				label: () => t("panel.web")
			}, ImaWebIcon));
			// 设置页：IMA 凭据（Cookie / BKN / 知识库 ID），替代已删除的 dsh-ima-copilot 设置面板。
			ctx.slots.inject("settings.section", () => installImaSettings(ctx, ctx.slots));
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.NS = NS;
		exports.PANEL_ID = PANEL_ID;
		exports.WEB_PANEL_ID = WEB_PANEL_ID;
		return module.exports;
	}
});
