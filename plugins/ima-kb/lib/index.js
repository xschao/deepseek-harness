// dsh-ima-kb — 宿主插件：在 DSH Web 服务器上注册 /api/ima/* 路由，
// 直连腾讯 IMA HTTP API，提供知识库的列表（名称+id）、文档列表 / 问答（单库或多库扇出）/ 上传 / 改名 / 删除能力。
// 凭据通过 DSH Credentials API 读取：
//   IMA_X_IMA_COOKIE / IMA_X_IMA_BKN          —— IMA 登录态
//   IMA_KNOWLEDGE_BASE_IDS                    —— 知识库 ID 列表（逗号/换行分隔）
//   IMA_KNOWLEDGE_BASES（可选）               —— 「名称:id」对，每行一个；配置了则覆盖自动发现的名称
import z from "@deepseek-ai/schemastery";
import crypto from "node:crypto";
import path from "node:path";

const CRED_COOKIE = "IMA_X_IMA_COOKIE";
const CRED_BKN = "IMA_X_IMA_BKN";
const CRED_KB_IDS = "IMA_KNOWLEDGE_BASE_IDS";
const CRED_KB_PAIRS = "IMA_KNOWLEDGE_BASES";

const BASE = "https://ima.qq.com";

/** Cordis 插件配置（patch 里可覆盖）。 */
const Config = z.object({
	robotType: z.number().step(1).min(1).default(5),
	requestTimeoutMs: z.number().step(1).min(1).default(300000),
	maxUploadBytes: z.number().step(1).min(1).default(25 * 1024 * 1024),
	kbNameCacheMs: z.number().step(1).min(1).default(600000)
});

export const inject = ["webServer", "credentials"];
export const name = "dsh-ima-kb";

// ---------- 小工具 ----------
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function cookieValue(cookie, name) {
	const entry = cookie.split(";").map((p) => p.trim()).find((p) => p.startsWith(`${name}=`));
	if (entry === void 0) return void 0;
	const raw = entry.slice(name.length + 1);
	try {
		return decodeURIComponent(raw);
	} catch {
		return raw;
	}
}
function replaceCookieValue(cookie, name, value) {
	const parts = cookie.split(";").map((p) => p.trim()).filter(Boolean);
	const index = parts.findIndex((p) => p.startsWith(`${name}=`));
	if (index >= 0) parts[index] = `${name}=${value}`;
	else parts.push(`${name}=${value}`);
	return parts.join("; ");
}
function userAgent(cookie) {
	return cookieValue(cookie, "IMA-IUA") ?? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/144.0.0.0 Safari/537.36";
}
function safeMessage(payload) {
	const msg = typeof payload?.msg === "string" ? payload.msg : "";
	return msg.replace(/[\u0000-\u001f\u007f]+/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 200);
}
/** 解析「名称:id」对（逗号/换行分隔；名称可为空时退回 id 作为名称）。 */
function parseKbPairs(text) {
	const tokens = (text ?? "").split(/[\r\n,]+/u).map((s) => s.trim()).filter(Boolean);
	const pairs = [];
	for (const token of tokens) {
		const colon = token.indexOf(":");
		if (colon <= 0) continue; // 必须带冒号的“名称:id”
		const name = token.slice(0, colon).trim();
		const id = token.slice(colon + 1).trim();
		if (id.length > 0) pairs.push({ id, name: name.length > 0 ? name : id });
	}
	return pairs;
}

const MEDIA_TYPES = {
	".md": "MARKDOWN", ".markdown": "MARKDOWN", ".txt": "TXT", ".pdf": "PDF",
	".html": "HTML", ".htm": "HTML", ".docx": "WORD", ".doc": "WORD",
	".pptx": "PPT", ".xlsx": "EXCEL", ".epub": "EPUB",
	".png": "IMG", ".jpg": "IMG", ".jpeg": "IMG", ".webp": "IMG", ".gif": "IMG"
};
const CONTENT_TYPES = {
	MARKDOWN: "text/markdown; charset=utf-8",
	TXT: "text/plain; charset=utf-8",
	HTML: "text/html; charset=utf-8",
	PDF: "application/pdf",
	IMG: "image/png"
};

// ---------- 配置归一化 ----------
/** 兼容 volatile 配置包装：取真实值（0.2.x 的 volatile schema 会包一层 get()）。 */
function readCompatible(value) {
	return typeof value === "object" && value !== null && typeof value.get === "function" ? value.get() : value;
}
function normalizeConfig(config) {
	const source = typeof config === "function" ? config() : config;
	return {
		robotType: readCompatible(source?.robotType) ?? 5,
		requestTimeoutMs: readCompatible(source?.requestTimeoutMs) ?? 300000,
		maxUploadBytes: readCompatible(source?.maxUploadBytes) ?? 25 * 1024 * 1024,
		kbNameCacheMs: readCompatible(source?.kbNameCacheMs) ?? 600000
	};
}

// ---------- IMA HTTP 客户端 ----------
class ImaApi {
	constructor(resolveCredential, config) {
		this.resolveCredential = resolveCredential;
		// 注意：这里 config 可能是“工厂函数”，必须先求值；否则 this.config.xxx 全是 undefined。
		this.config = normalizeConfig(config);
		this.session = null;
		this.kbCache = null;
	}
	/** 读取当前凭证（每次现取，不回显给浏览器）。 */
	async credentials() {
		const [cookie, bkn, kbIdsRaw] = await Promise.all([
			this.resolveCredential(CRED_COOKIE),
			this.resolveCredential(CRED_BKN),
			this.resolveCredential(CRED_KB_IDS)
		]);
		const kbIds = [...new Set((kbIdsRaw?.value ?? "").split(/[\r\n,]+/u).map((s) => s.trim()).filter(Boolean))];
		return { cookie: cookie?.value ?? "", bkn: bkn?.value ?? "", kbIds };
	}
	/** 知识库清单（名称 + id）。优先「名称:id」配置；否则用自动发现的名称（get_knowledge_base_list）。 */
	async resolveKnowledgeBases() {
		const [creds, pairsRaw] = await Promise.all([
			this.credentials(),
			this.resolveCredential(CRED_KB_PAIRS)
		]);
		const pairs = parseKbPairs(pairsRaw?.value ?? "");
		if (pairs.length > 0) return pairs;
		const names = await this.discoverKbNames();
		return creds.kbIds.map((id) => ({
			id,
			name: names.get(id) ?? id
		}));
	}
	/** 从 IMA 拉全量知识库列表并缓存（个人 + 加入的知识库，带名称）。 */
	async discoverKbNames() {
		if (this.kbCache && this.kbCache.expiresAt > Date.now()) return this.kbCache.names;
		const names = new Map();
		for (const type of [1, 3]) {
			try {
				const r = await this.api("/cgi-bin/knowledge_tab_reader/get_knowledge_base_list", {
					params: [{ type, cursor: "", limit: 50 }]
				});
				if (r.json?.code === 0) {
					for (const group of r.json.results ?? []) {
						for (const kb of group.knowledge_base_list ?? group.knowledgeBaseList ?? []) {
							const info = kb.basic_info ?? {};
							if (typeof kb.id === "string" && kb.id.length > 0 && typeof info.name === "string" && info.name.length > 0) {
								names.set(kb.id, info.name);
							}
						}
					}
				}
			} catch {
				/* 名称发现失败时退回 id 作为名称 */
			}
		}
		this.kbCache = { names, expiresAt: Date.now() + this.config.kbNameCacheMs };
		return names;
	}
	/** 获取带 token 的会话（缓存 20 分钟；cookie 变了自动刷新）。 */
	async getSession() {
		const creds = await this.credentials();
		if (creds.cookie.length === 0 || creds.bkn.length === 0) {
			throw new Error("IMA 凭证未配置：请在 设置 → 插件 → IMA Copilot 中填写 X-Ima-Cookie 与 X-Ima-Bkn");
		}
		const uid = cookieValue(creds.cookie, "IMA-UID");
		const refreshToken = cookieValue(creds.cookie, "IMA-REFRESH-TOKEN") ?? cookieValue(creds.cookie, "IMA-TOKEN");
		if (uid === void 0 || refreshToken === void 0) {
			throw new Error("IMA Cookie 缺少 IMA-UID 或 IMA-REFRESH-TOKEN，请重新复制完整 Cookie");
		}
		if (this.session && this.session.sourceCookie === creds.cookie && this.session.expiresAt > Date.now() + 60_000) {
			return this.session;
		}
		const res = await fetch(`${BASE}/cgi-bin/auth_login/refresh`, {
			method: "POST",
			headers: this.headers(creds, "application/json"),
			body: JSON.stringify({ user_id: uid, refresh_token: refreshToken, token_type: 14 }),
			signal: AbortSignal.timeout(this.config.requestTimeoutMs)
		});
		const json = await res.json().catch(() => null);
		if (json?.code !== 0 || typeof json?.token !== "string" || json.token.length === 0) {
			throw new Error(`IMA token 刷新失败(code=${json?.code ?? res.status})${safeMessage(json) ? `: ${safeMessage(json)}` : ""}`);
		}
		this.session = {
			sourceCookie: creds.cookie,
			token: json.token,
			cookie: replaceCookieValue(creds.cookie, "IMA-TOKEN", json.token),
			expiresAt: Date.now() + 20 * 60_000
		};
		return this.session;
	}
	headers(creds, contentType, token) {
		const h = {
			accept: contentType === "text/event-stream" ? "*/*" : "application/json",
			"content-type": contentType,
			"accept-language": "zh-CN,zh;q=0.9",
			extension_version: "999.999.999",
			from_browser_ima: "1",
			referer: "https://ima.qq.com/wikis",
			"user-agent": userAgent(creds.cookie),
			"x-ima-bkn": creds.bkn,
			"x-ima-cookie": creds.cookie
		};
		if (token !== void 0) h.authorization = `Bearer ${token}`;
		return h;
	}
	/** POST JSON 到 IMA，返回 {status, json, text}。 */
	async api(apiPath, bodyObject, contentType = "application/json") {
		const creds = await this.credentials();
		const session = await this.getSession();
		const res = await fetch(`${BASE}${apiPath}`, {
			method: "POST",
			headers: this.headers({ ...creds, cookie: session.cookie }, contentType, session.token),
			body: typeof bodyObject === "string" ? bodyObject : JSON.stringify(bodyObject),
			signal: AbortSignal.timeout(this.config.requestTimeoutMs)
		});
		const text = await res.text();
		let json = null;
		try {
			json = JSON.parse(text);
		} catch {
			/* 非 JSON（如 SSE） */
		}
		return { status: res.status, json, text };
	}
	/** 列出知识库文档。结构化接口对个人知识库常返回权限错误（code=80100），
	 *  此时退化为问答式列举（自然语言文本）。 */
	async listDocs(kbId) {
		const kb = kbId || (await this.credentials()).kbIds[0];
		if (!kb) throw new Error("缺少知识库 ID：请在 设置 → 插件 → IMA Copilot 中配置 IMA_KNOWLEDGE_BASE_IDS");
		const result = await this.api("/cgi-bin/knowledge_tab_reader_nl/get_knowledge_list", {
			knowledge_base_id: kb,
			limit: 50,
			offset: 0
		});
		if (result.json?.code === 0) {
			const items = (result.json.knowledge_list ?? []).map((item) => ({
				mediaId: item.media_id,
				title: item.title,
				mediaType: item.media_type,
				fileSize: item.file_size,
				parseProgress: item.parse_progress,
				updateTime: item.update_time
			}));
			return { knowledgeBaseId: kb, structured: true, total: result.json.total_size ?? items.length, items };
		}
		// 个人知识库列表接口常返回权限错误，退化为让 IMA 自己列（结果是自然语言，可用）。
		const fallback = await this.ask("请列出当前知识库中的全部文档，逐条给出：标题、media_id（资料 ID）。", kb);
		return {
			knowledgeBaseId: kb,
			structured: false,
			note: `列表接口不可用(code=${result.json?.code ?? result.status})，已退化为问答式列举`,
			answer: fallback.answer
		};
	}
	/** 单个知识库问答（robotType 5），返回 {answer, references}。 */
	async ask(question, kbId) {
		const robotType = this.config.robotType;
		const kb = robotType === 5 ? kbId || (await this.credentials()).kbIds[0] : void 0;
		if (robotType === 5 && !kb) throw new Error("缺少知识库 ID：请在 设置 → 插件 → IMA Copilot 中配置 IMA_KNOWLEDGE_BASE_IDS");
		const init = await this.api("/cgi-bin/session_logic/init_session", {
			envInfo: { robotType, interactType: 0 },
			sceneType: 1,
			msgsLimit: 10,
			forbidAutoAddToHistoryList: false,
			...(robotType === 5 && kb ? { relatedUrl: kb, knowledgeBaseInfoWithFolder: { knowledgeBaseId: kb, folderIds: [] } } : {})
		});
		if (init.json?.code !== 0 || typeof init.json?.session_id !== "string" || init.json.session_id.length === 0) {
			throw new Error(`init_session 失败(code=${init.json?.code ?? init.status})${safeMessage(init.json) ? `: ${safeMessage(init.json)}` : ""}`);
		}
		const sessionId = init.json.session_id;
		const creds = await this.credentials();
		const session = await this.getSession();
		const qa = await fetch(`${BASE}/cgi-bin/assistant/qa`, {
			method: "POST",
			headers: this.headers({ ...creds, cookie: session.cookie }, "text/event-stream", session.token),
			body: JSON.stringify({
				session_id: sessionId,
				robot_type: robotType,
				question,
				question_type: robotType === 10000 ? 3 : 2,
				client_id: crypto.randomUUID(),
				command_info: { type: 14, knowledge_qa_info: { tags: [], knowledge_ids: [], media_id_infos: [] } },
				model_info: robotType === 10000
					? { model_type: 3, model_id: "official_3", enable_enhancement: true }
					: { model_type: 4, enable_enhancement: false },
				history_info: robotType === 10000 ? { type: 0 } : {},
				device_info: {
					uskey: crypto.randomBytes(32).toString("base64"),
					uskey_bus_infos_input: `${cookieValue(creds.cookie, "IMA-GUID") ?? "default_guid"}_${Math.floor(Date.now() / 1000)}`
				},
				client_tools: []
			}),
			signal: AbortSignal.timeout(this.config.requestTimeoutMs)
		});
		const text = await qa.text();
		return parseQaStream(text);
	}
	/** 多知识库组合问答：IMA 一次会话只绑一个库，因此对每个库各问一次（串行）并合并。 */
	async askMultiple(question, kbIds) {
		const bases = await this.resolveKnowledgeBases();
		const nameOf = (id) => bases.find((entry) => entry.id === id)?.name ?? id;
		const results = [];
		for (const id of kbIds) {
			try {
				const outcome = await this.ask(question, id);
				results.push({
					knowledgeBaseId: id,
					knowledgeBase: nameOf(id),
					answer: outcome.answer,
					references: outcome.references
				});
			} catch (error) {
				results.push({
					knowledgeBaseId: id,
					knowledgeBase: nameOf(id),
					answer: "",
					references: [],
					error: error instanceof Error ? error.message : String(error)
				});
			}
		}
		return results;
	}
	/** 上传文档到知识库。 */
	async upload({ fileName, bytes, title, kbId, folderId }) {
		const kb = kbId || (await this.credentials()).kbIds[0];
		if (!kb) throw new Error("缺少知识库 ID：请在 设置 → 插件 → IMA Copilot 中配置 IMA_KNOWLEDGE_BASE_IDS");
		if (!fileName) throw new Error("缺少文件名");
		if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error("文件内容为空");
		const ext = path.extname(fileName).toLowerCase();
		const mediaType = MEDIA_TYPES[ext] ?? "MARKDOWN";
		const contentType = CONTENT_TYPES[mediaType] ?? "application/octet-stream";

		const created = await this.api("/cgi-bin/file_manager/create_media", {
			media_type: mediaType,
			file_name: fileName,
			file_size: String(bytes.length)
		});
		if (created.json?.code !== 0 || !created.json?.cos_credential) {
			throw new Error(`create_media 失败: ${created.text.slice(0, 200)}`);
		}
		const cred = created.json.cos_credential;
		const mediaId = created.json.media_id;
		const cosKey = cred.cos_key;

		// COS v5 签名上传
		const host = `${cred.bucket_name}.cos.${cred.region}.myqcloud.com`;
		const keyTime = `${cred.start_time};${cred.expired_time}`;
		const signKey = crypto.createHmac("sha1", cred.secret_key).update(keyTime).digest("hex");
		const headerList = "host;x-cos-security-token";
		const headerString = `host=${encodeURIComponent(host)}&x-cos-security-token=${encodeURIComponent(cred.token)}`;
		const sha1Http = crypto.createHash("sha1").update(`put\n/${cosKey}\n\n${headerString}\n`).digest("hex");
		const signature = crypto.createHmac("sha1", signKey).update(`sha1\n${keyTime}\n${sha1Http}\n`).digest("hex");
		const authorization =
			`q-sign-algorithm=sha1&q-ak=${cred.secret_id}&q-sign-time=${keyTime}&q-key-time=${keyTime}` +
			`&q-header-list=${headerList}&q-url-param-list=&q-signature=${signature}`;

		const put = await fetch(`https://${host}/${cosKey}`, {
			method: "PUT",
			headers: { authorization, "x-cos-security-token": cred.token, "content-type": contentType },
			body: bytes,
			signal: AbortSignal.timeout(this.config.requestTimeoutMs)
		});
		if (!put.ok) throw new Error(`COS 上传失败: HTTP ${put.status}`);

		const added = await this.api("/cgi-bin/knowledge_tab_writer/add_knowledge", {
			media_id: mediaId,
			media_type: mediaType,
			knowledge_base_id: kb,
			title: title || path.basename(fileName, ext),
			need_parse: true,
			...(folderId ? { folder_id: folderId } : {}),
			file_info: {
				file_size: String(bytes.length),
				cos_key: cosKey,
				file_name: fileName,
				content_type: contentType
			}
		});
		if (added.json?.code !== 0) throw new Error(`add_knowledge 失败: ${added.text.slice(0, 200)}`);

		let renamed = false;
		if (title) {
			const r = await this.api("/cgi-bin/knowledge_tab_writer/rename_knowledge", {
				media_id: mediaId,
				knowledge_base_id: kb,
				title
			});
			renamed = r.json?.code === 0;
		}
		return { mediaId, bytes: bytes.length, mediaType, title: title || null, renamed, knowledgeBaseId: kb };
	}
	/** 重命名文档。 */
	async renameDoc({ mediaId, title, kbId }) {
		const kb = kbId || (await this.credentials()).kbIds[0];
		if (!kb) throw new Error("缺少知识库 ID");
		const r = await this.api("/cgi-bin/knowledge_tab_writer/rename_knowledge", {
			media_id: mediaId,
			knowledge_base_id: kb,
			title
		});
		if (r.json?.code !== 0) throw new Error(`rename_knowledge 失败: ${r.text.slice(0, 200)}`);
		return { mediaId, title, ok: true };
	}
	/** 删除文档（按 media_id）。 */
	async deleteDocs({ mediaIds, kbId }) {
		const kb = kbId || (await this.credentials()).kbIds[0];
		if (!kb) throw new Error("缺少知识库 ID");
		const r = await this.api("/cgi-bin/knowledge_tab_writer/del_knowledge", {
			media_ids: mediaIds,
			knowledge_base_id: kb
		});
		if (r.json?.code !== 0) throw new Error(`del_knowledge 失败: ${r.text.slice(0, 200)}`);
		return { deleted: mediaIds, results: r.json.results ?? {} };
	}
}

// ---------- QA SSE 解析 ----------
function parseQaStream(text) {
	const parsed = { answer: "", references: [], codes: [] };
	const seen = new Set();
	const addRef = (ref) => {
		if (ref !== void 0 && !seen.has(ref.id)) {
			seen.add(ref.id);
			parsed.references.push(ref);
		}
	};
	const referenceOf = (value) => {
		if (!isRecord(value)) return void 0;
		const id = typeof value.id === "string" ? value.id : void 0;
		const title = typeof value.title === "string" ? value.title : void 0;
		if (id === void 0 || title === void 0) return void 0;
		const reference = { id, title };
		if (typeof value.subtitle === "string") reference.subtitle = value.subtitle;
		if (typeof value.introduction === "string") reference.introduction = value.introduction;
		if (typeof value.timestamp === "number") reference.timestamp = value.timestamp;
		if (isRecord(value.knowledge_base_info) && typeof value.knowledge_base_info.name === "string") {
			reference.knowledgeBase = value.knowledge_base_info.name;
		}
		return reference;
	};
	const append = (chunk) => {
		if (typeof chunk === "string" && chunk.length > 0) {
			if (chunk.startsWith(parsed.answer)) parsed.answer = chunk;
			else if (!parsed.answer.endsWith(chunk)) parsed.answer += chunk;
		}
	};
	const consume = (payload) => {
		if (!isRecord(payload)) return;
		if (typeof payload.code === "number") parsed.codes.push(payload.code);
		if (payload.Type === "blockMessage" && isRecord(payload.Data)) {
			append(payload.Data.text_message?.Text);
		}
		for (const media of Array.isArray(payload.medias) ? payload.medias : []) addRef(referenceOf(media));
		for (const message of Array.isArray(payload.msgs) ? payload.msgs : []) {
			if (isRecord(message)) {
				if (typeof message.content === "string") append(message.content);
				else if (isRecord(message.content)) {
					if (typeof message.content.answer === "string") {
						try {
							const decoded = JSON.parse(message.content.answer);
							append(isRecord(decoded) && typeof decoded.Text === "string" ? decoded.Text : message.content.answer);
						} catch {
							append(message.content.answer);
						}
					}
					if (typeof message.content.context_refs === "string") {
						try {
							const decoded = JSON.parse(message.content.context_refs);
							for (const media of Array.isArray(decoded?.medias) ? decoded.medias : []) addRef(referenceOf(media));
						} catch {
							/* ignore */
						}
					}
				}
			}
		}
		for (const key of ["content", "Text", "answer"]) append(payload[key]);
	};
	for (const line of text.split(/\r?\n/u)) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("data:")) continue;
		try {
			consume(JSON.parse(trimmed.slice(5).trim()));
		} catch {
			/* 跳过无法解析的行 */
		}
	}
	return { answer: parsed.answer.trim(), references: parsed.references };
}

// ---------- HTTP 辅助 ----------
function json(res, status, payload) {
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store"
	});
	res.end(JSON.stringify(payload));
}
async function readBody(req, limit) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		size += chunk.length;
		if (size > limit) {
			const err = new Error("request body too large");
			err.code = "BODY_TOO_LARGE";
			throw err;
		}
		chunks.push(chunk);
	}
	return Buffer.concat(chunks).toString("utf8");
}
const ALLOWED_ORIGINS = ["http://127.0.0.1:3080", "http://localhost:3080"];
function sameOrigin(req) {
	const origin = req.headers.origin;
	if (origin === void 0) return true;
	return ALLOWED_ORIGINS.includes(origin);
}

// ---------- 插件主体 ----------
export function apply(ctx, config) {
	const api = new ImaApi(
		(ref) => ctx.credentials.resolve(ref),
		() => config
	);
	const makeRoute = (routePath, handler) => ({
		kind: "exact",
		path: routePath,
		handler: async (req, res) => {
			if (req.method !== "POST" && req.method !== "GET") {
				json(res, 405, { ok: false, error: "method not allowed" });
				return;
			}
			if (!sameOrigin(req)) {
				json(res, 403, { ok: false, error: "cross-origin request rejected" });
				return;
			}
			try {
				let payload = {};
				if (req.method === "POST") {
					if (!(req.headers["content-type"] ?? "").includes("application/json")) {
						json(res, 415, { ok: false, error: "expected application/json body" });
						return;
					}
					const text = await readBody(req, config.maxUploadBytes * 2);
					if (text.trim().length > 0) {
						payload = JSON.parse(text);
					}
				}
				const result = await handler(payload);
				json(res, 200, { ok: true, ...result });
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				try {
					ctx.logger?.warn(`ima-kb: ${routePath} failed: ${message}`);
				} catch {
					/* logger 可能不可用 */
				}
				json(res, 200, { ok: false, error: message });
			}
		}
	});
	ctx.effect(() => {
		const disposers = [
			ctx.webServer.register(makeRoute("/api/ima/status", async () => {
				const creds = await api.credentials();
				let bases = [];
				try {
					bases = await api.resolveKnowledgeBases();
				} catch {
					bases = creds.kbIds.map((id) => ({ id, name: id }));
				}
				return {
					configured: creds.cookie.length > 0 && creds.bkn.length > 0,
					knowledgeBases: bases,
					knowledgeBaseIds: bases.map((entry) => entry.id),
					robotType: config.robotType
				};
			})),
			ctx.webServer.register(makeRoute("/api/ima/list", (payload) => api.listDocs(payload.knowledgeBaseId))),
			ctx.webServer.register(makeRoute("/api/ima/ask", async (payload) => {
				const question = (payload.question ?? "").trim();
				if (question.length === 0) throw new Error("question 不能为空");
				const ids = Array.isArray(payload.knowledgeBaseIds)
					? [...new Set(payload.knowledgeBaseIds.map((s) => String(s).trim()).filter(Boolean))]
					: [];
				if (ids.length <= 1) {
					const kbId = ids.length === 1 ? ids[0] : void 0;
					const bases = await api.resolveKnowledgeBases();
					const outcome = await api.ask(question, kbId);
					const effectiveId = kbId ?? (await api.credentials()).kbIds[0];
					return {
						combined: false,
						knowledgeBaseId: effectiveId,
						knowledgeBase: bases.find((entry) => entry.id === effectiveId)?.name ?? effectiveId,
						answer: outcome.answer,
						references: outcome.references
					};
				}
				const results = await api.askMultiple(question, ids);
				return { combined: true, results };
			})),
			ctx.webServer.register(makeRoute("/api/ima/upload", async (payload) => {
				if (typeof payload.fileName !== "string" || typeof payload.dataBase64 !== "string") {
					throw new Error("fileName 与 dataBase64 必填");
				}
				const bytes = Buffer.from(payload.dataBase64, "base64");
				if (bytes.length === 0) throw new Error("文件内容为空");
				if (bytes.length > config.maxUploadBytes) throw new Error("文件过大（上限 25MB）");
				return api.upload({
					fileName: payload.fileName,
					bytes,
					title: payload.title,
					kbId: payload.knowledgeBaseId,
					folderId: payload.folderId
				});
			})),
			ctx.webServer.register(makeRoute("/api/ima/rename", (payload) => {
				if (typeof payload.mediaId !== "string" || typeof payload.title !== "string") {
					throw new Error("mediaId 与 title 必填");
				}
				return api.renameDoc({ mediaId: payload.mediaId, title: payload.title, kbId: payload.knowledgeBaseId });
			})),
			ctx.webServer.register(makeRoute("/api/ima/delete", (payload) => {
				if (!Array.isArray(payload.mediaIds) || payload.mediaIds.length === 0) {
					throw new Error("mediaIds 必填");
				}
				return api.deleteDocs({ mediaIds: payload.mediaIds, kbId: payload.knowledgeBaseId });
			}))
		];
		return () => {
			for (const dispose of disposers) dispose();
		};
	}, "ima-kb: http routes");
}

export { ImaApi, normalizeConfig, parseKbPairs };