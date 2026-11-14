/* DSH 浏览器端 bundle：左侧菜单“IMA 知识库”入口 + 主面板页面。
   注册两个 slot：
     - main（keyed）：面板内容 ImaKbPage
     - sidebar.panellist（list）：侧边栏图标 ImaKbIcon
   知识库以「名称 + id」勾选框呈现（可多选）；提问时对每个勾选的知识库各问一次，
   面板按知识库分组合并展示答案。数据通过宿主插件注册的 /api/ima/* 路由获取。 */
window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-ima-kb",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		const NS = "ima.kb";
		const PANEL_ID = "ima-kb";

		const zh = {
			"panel": "IMA 知识库",
			"title": "IMA 知识库",
			"subtitle": "勾选一个或多个知识库，组合提问；文档操作作用于第一个勾选的知识库",
			"unconfigured": "IMA 凭证尚未配置。请到 设置 → 插件 → IMA Copilot 填写 X-Ima-Cookie、X-Ima-Bkn 与知识库 ID。",
			"kb.title": "选择知识库",
			"kb.selected": "已选 {count} 个",
			"kb.all": "全选",
			"kb.none": "清空",
			"kb.needOne": "请先勾选至少一个知识库。",
			"ask.placeholder": "向勾选的知识库提问…",
			"ask.submit": "提问",
			"ask.busy": "思考中…",
			"ask.empty": "输入问题后点击“提问”。",
			"refs": "引用资料",
			"docs.title": "知识库文档",
			"docs.count": "共 {count} 篇",
			"docs.empty": "暂无文档，先上传一个吧。",
			"docs.refresh": "刷新",
			"docs.upload": "上传文档",
			"docs.upload.hint": "支持 md / txt / pdf / html / docx / pptx / xlsx / epub 与图片",
			"docs.rename": "重命名",
			"docs.delete": "删除",
			"docs.delete.confirm": "确定从知识库删除该文档？此操作不可恢复。",
			"docs.rename.prompt": "输入新标题：",
			"docs.parsing": "解析中 {progress}%",
			"docs.ready": "已解析",
			"docs.noKb": "请先勾选一个知识库（文档区使用第一个勾选的知识库）。",
			"loading": "加载中…",
			"error": "出错"
		};
		const en = {
			"panel": "IMA Knowledge Base",
			"title": "IMA Knowledge Base",
			"subtitle": "Check one or more knowledge bases to ask combined questions; document actions target the first checked one",
			"unconfigured": "IMA credentials are not configured. Fill in X-Ima-Cookie, X-Ima-Bkn and knowledge base IDs under Settings → Plugins → IMA Copilot.",
			"kb.title": "Knowledge bases",
			"kb.selected": "{count} selected",
			"kb.all": "All",
			"kb.none": "None",
			"kb.needOne": "Check at least one knowledge base first.",
			"ask.placeholder": "Ask the checked knowledge bases…",
			"ask.submit": "Ask",
			"ask.busy": "Thinking…",
			"ask.empty": "Type a question and press Ask.",
			"refs": "References",
			"docs.title": "Documents",
			"docs.count": "{count} documents",
			"docs.empty": "No documents yet — upload one to get started.",
			"docs.refresh": "Refresh",
			"docs.upload": "Upload document",
			"docs.upload.hint": "Supports md / txt / pdf / html / docx / pptx / xlsx / epub and images",
			"docs.rename": "Rename",
			"docs.delete": "Delete",
			"docs.delete.confirm": "Delete this document from the knowledge base? This cannot be undone.",
			"docs.rename.prompt": "New title:",
			"docs.parsing": "Parsing {progress}%",
			"docs.ready": "Parsed",
			"docs.noKb": "Check a knowledge base first (documents use the first checked one).",
			"loading": "Loading…",
			"error": "Error"
		};

		// ---------- 请求辅助 ----------
		async function callApi(endpoint, payload) {
			const response = await fetch(endpoint, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(payload ?? {})
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

		// ---------- 样式 ----------
		const styles = {
			page: { display: "grid", gap: 20, padding: "20px 20px 32px", maxWidth: 860, margin: "0 auto", width: "100%", boxSizing: "border-box" },
			header: { display: "grid", gap: 6 },
			title: { margin: 0, fontSize: 24, lineHeight: 1.3, color: "var(--dsw-alias-label-primary)" },
			subtitle: { margin: 0, fontSize: 13, opacity: 0.65, color: "var(--dsw-alias-label-secondary)" },
			warning: { margin: 0, padding: "10px 14px", borderRadius: "var(--dsw-radius-md, 8px)", border: "1px solid var(--dsw-alias-border-l2, #e0d5a8)", color: "#9a5b00", background: "rgba(196,122,0,0.10)", fontSize: 13, lineHeight: 1.5 },
			card: { border: "1px solid var(--dsw-alias-border-l3, #e2e2e2)", borderRadius: "var(--dsw-radius-lg, 12px)", background: "var(--dsw-alias-bg-base, transparent)", overflow: "hidden" },
			cardHead: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "14px 16px", borderBottom: "1px solid var(--dsw-alias-border-l3, #e2e2e2)" },
			cardTitle: { margin: 0, fontSize: 15, fontWeight: 600, color: "var(--dsw-alias-label-primary)" },
			cardMeta: { fontSize: 12, opacity: 0.6, color: "var(--dsw-alias-label-tertiary)" },
			cardBody: { padding: 16, display: "grid", gap: 12 },
			row: { display: "flex", gap: 8, alignItems: "center" },
			actions: { display: "flex", gap: 8, alignItems: "center" },
			button: { borderRadius: 8, padding: "7px 12px", cursor: "pointer", fontSize: 13, border: "1px solid var(--dsw-alias-border-l2, #ccc)", background: "transparent", color: "inherit" },
			buttonPrimary: { borderRadius: 8, padding: "7px 14px", cursor: "pointer", fontSize: 13, border: "1px solid #1769aa", background: "#1769aa", color: "#fff" },
			buttonDanger: { borderRadius: 8, padding: "6px 10px", cursor: "pointer", fontSize: 12, border: "1px solid transparent", background: "transparent", color: "var(--dsw-alias-state-error-primary, #c33)" },
			buttonDisabled: { opacity: 0.5, cursor: "not-allowed" },
			input: { width: "100%", boxSizing: "border-box", border: "1px solid var(--dsw-alias-border-l2, #c8c8c8)", borderRadius: 8, padding: "9px 11px", background: "transparent", color: "inherit", font: "inherit" },
			textarea: { resize: "vertical", minHeight: 72, lineHeight: 1.5 },
			answer: { margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 14, lineHeight: 1.65, color: "var(--dsw-alias-label-primary)" },
			answerBox: { border: "1px solid var(--dsw-alias-border-l3, #e2e2e2)", borderRadius: 10, padding: "12px 14px", background: "var(--dsw-alias-markdown-code-block, rgba(0,0,0,0.03))", display: "grid", gap: 10 },
			kbGroup: { display: "grid", gap: 10 },
			kbGroupTitle: { margin: 0, fontSize: 13.5, fontWeight: 600, color: "var(--dsw-alias-label-primary)", display: "flex", gap: 6, alignItems: "center" },
			kbGroupError: { margin: 0, fontSize: 13, color: "var(--dsw-alias-state-error-primary, #c33)", lineHeight: 1.5 },
			refsTitle: { margin: 0, fontSize: 12, fontWeight: 600, opacity: 0.7, color: "var(--dsw-alias-label-secondary)" },
			refItem: { margin: 0, fontSize: 13, lineHeight: 1.5, color: "var(--dsw-alias-label-secondary)" },
			docRow: { display: "flex", alignItems: "center", gap: 10, padding: "9px 4px", borderBottom: "1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.06))" },
			docTitle: { flex: 1, minWidth: 0, fontSize: 13.5, color: "var(--dsw-alias-label-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
			badge: { flex: "none", fontSize: 11, padding: "2px 7px", borderRadius: 999, border: "1px solid var(--dsw-alias-border-l2, #ccc)", color: "var(--dsw-alias-label-tertiary)", opacity: 0.85 },
			docMeta: { flex: "none", fontSize: 12, opacity: 0.6, color: "var(--dsw-alias-label-tertiary)", whiteSpace: "nowrap" },
			error: { margin: 0, fontSize: 13, color: "var(--dsw-alias-state-error-primary, #c33)", lineHeight: 1.5 },
			empty: { margin: 0, fontSize: 13, opacity: 0.6, color: "var(--dsw-alias-label-secondary)" },
			refNum: { color: "#1769aa" },
			kbList: { display: "grid", gap: 6, maxHeight: 220, overflow: "auto" },
			kbItem: { display: "flex", gap: 8, alignItems: "flex-start", padding: "6px 8px", borderRadius: 8, cursor: "pointer", border: "1px solid transparent" },
			kbItemChecked: { background: "var(--dsw-alias-interactive-bg-hover, rgba(23,105,170,0.10))", borderColor: "var(--dsw-alias-border-l2, #ccc)" },
			kbCheck: { marginTop: 2, flex: "none", accentColor: "#1769aa" },
			kbName: { fontSize: 13.5, color: "var(--dsw-alias-label-primary)", lineHeight: 1.4 },
			kbId: { fontSize: 11.5, opacity: 0.55, color: "var(--dsw-alias-label-tertiary)", fontFamily: "ui-monospace, Consolas, monospace", wordBreak: "break-all" }
		};

		// ---------- 侧边栏图标 ----------
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
				react.createElement("p", { style: styles.answer }, result.answer || t("ask.empty")),
				react.createElement(References, { references: result.references, t })
			);
		}

		// ---------- 主面板页面 ----------
		function ImaKbPage({ t }) {
			const [status, setStatus] = react.useState(null);
			const [selected, setSelected] = react.useState([]);
			const [docs, setDocs] = react.useState(null);
			const [docsLoading, setDocsLoading] = react.useState(false);
			const [question, setQuestion] = react.useState("");
			const [asking, setAsking] = react.useState(false);
			const [result, setResult] = react.useState(null);
			const [error, setError] = react.useState("");
			const [uploading, setUploading] = react.useState(false);
			const fileInput = react.useRef(null);

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

			const toggleKb = (id) => {
				setSelected((current) => current.includes(id)
					? current.filter((entry) => entry !== id)
					: [...current, id]);
			};
			const selectAll = () => setSelected(kbList.map((entry) => entry.id));
			const selectNone = () => setSelected([]);

			const refresh = react.useCallback(() => {
				if (!firstKbId) return;
				setDocsLoading(true);
				setError("");
				callApi("/api/ima/list", { knowledgeBaseId: firstKbId })
					.then((data) => setDocs(data))
					.catch(applyError)
					.finally(() => setDocsLoading(false));
			}, [firstKbId]);

			react.useEffect(() => {
				if (status && status.configured && firstKbId) refresh();
			}, [status, firstKbId, refresh]);

			const ask = () => {
				const text = question.trim();
				if (text.length === 0 || asking) return;
				if (selected.length === 0) {
					setError(t("kb.needOne"));
					return;
				}
				setAsking(true);
				setError("");
				setResult(null);
				callApi("/api/ima/ask", { question: text, knowledgeBaseIds: selected })
					.then((data) => setResult(data))
					.catch(applyError)
					.finally(() => setAsking(false));
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
						knowledgeBaseId: firstKbId
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
					react.createElement("h1", { style: styles.title }, t("title")),
					react.createElement("p", { style: styles.subtitle }, t("subtitle"))
				),
				!configured && react.createElement("p", { role: "alert", style: styles.warning }, t("unconfigured")),
				configured && react.createElement("section", { style: styles.card },
					react.createElement("div", { style: styles.cardHead },
						react.createElement("h2", { style: styles.cardTitle }, t("kb.title")),
						react.createElement("div", { style: styles.actions },
							react.createElement("span", { style: styles.cardMeta }, t("kb.selected").replace("{count}", String(selected.length))),
							react.createElement("button", { type: "button", style: styles.button, onClick: selectAll, children: t("kb.all") }),
							react.createElement("button", { type: "button", style: styles.button, onClick: selectNone, children: t("kb.none") })
						)
					),
					react.createElement("div", { style: styles.cardBody },
						react.createElement("div", { style: styles.kbList },
							kbList.map((entry) => {
								const checked = selected.includes(entry.id);
								return react.createElement("label", {
									key: entry.id,
									style: { ...styles.kbItem, ...(checked ? styles.kbItemChecked : {}) }
								},
									react.createElement("input", {
										type: "checkbox",
										style: styles.kbCheck,
										checked,
										onChange: () => toggleKb(entry.id)
									}),
									react.createElement("span", { style: { display: "grid", gap: 1 } },
										react.createElement("span", { style: styles.kbName }, entry.name),
										react.createElement("span", { style: styles.kbId }, entry.id)
									)
								);
							})
						)
					)
				),
				configured && react.createElement("section", { style: styles.card },
					react.createElement("div", { style: styles.cardHead },
						react.createElement("h2", { style: styles.cardTitle }, "💬 IMA"),
						react.createElement("button", {
							type: "button",
							style: { ...styles.buttonPrimary, ...(asking ? styles.buttonDisabled : {}) },
							disabled: asking,
							onClick: ask,
							children: asking ? t("ask.busy") : t("ask.submit")
						})
					),
					react.createElement("div", { style: styles.cardBody },
						react.createElement("textarea", {
							style: { ...styles.input, ...styles.textarea },
							rows: 3,
							placeholder: t("ask.placeholder"),
							value: question,
							disabled: asking,
							onChange: (event) => setQuestion(event.target.value),
							onKeyDown: (event) => {
								if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) ask();
							}
						}),
						react.createElement(AnswerView, { result, t })
					)
				),
				error && react.createElement("p", { role: "alert", style: styles.error }, `${t("error")}: ${error}`),
				configured && react.createElement("section", { style: styles.card },
					react.createElement("div", { style: styles.cardHead },
						react.createElement("div", { style: { display: "grid", gap: 2 } },
							react.createElement("h2", { style: styles.cardTitle }, t("docs.title")),
							react.createElement("span", { style: styles.cardMeta },
								docs && structuredDocs ? t("docs.count").replace("{count}", String(docs.total ?? docsItems.length)) : ""
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
					react.createElement("div", { style: styles.cardBody },
						!firstKbId && react.createElement("p", { style: styles.empty }, t("docs.noKb")),
						firstKbId && react.createElement(react.Fragment, null,
							react.createElement("p", { style: styles.empty }, t("docs.upload.hint")),
							!structuredDocs && docs && react.createElement(react.Fragment, null,
								docs.note && react.createElement("p", { style: styles.empty }, docs.note),
								react.createElement("p", { style: styles.answer }, docs.answer || t("docs.empty"))
							),
							structuredDocs && docsItems.length === 0 && react.createElement("p", { style: styles.empty }, t("docs.empty")),
							structuredDocs && docsItems.map((doc) => {
								const parsing = typeof doc.parseProgress === "number" && doc.parseProgress < 100;
								return react.createElement("div", { key: doc.mediaId, style: styles.docRow },
									react.createElement("span", { style: styles.badge }, String(doc.mediaType || "?").toLowerCase()),
									react.createElement("span", { style: styles.docTitle, title: doc.title }, doc.title),
									parsing && react.createElement("span", { style: styles.docMeta }, t("docs.parsing").replace("{progress}", String(doc.parseProgress))),
									!parsing && typeof doc.parseProgress === "number" && react.createElement("span", { style: styles.docMeta }, t("docs.ready")),
									react.createElement("span", { style: styles.docMeta }, formatSize(doc.fileSize)),
									react.createElement("div", { style: styles.actions },
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

		// ---------- 插件入口 ----------
		const inject = ["slots", "locale"];
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "ima-kb: dictionaries");
			const t = ctx.locale.bind(NS);
			ctx.slots.inject("main", () => ctx.slots.register({
				name: "main",
				key: PANEL_ID,
				locale: NS,
				inject: () => ({})
			}, ImaKbPage));
			ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
				name: "sidebar.panellist",
				id: PANEL_ID,
				order: 30,
				locale: NS,
				label: () => t("panel")
			}, ImaKbIcon));
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.NS = NS;
		exports.PANEL_ID = PANEL_ID;
		return module.exports;
	}
});
