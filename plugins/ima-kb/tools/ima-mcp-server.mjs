#!/usr/bin/env node
// IMA MCP server (stdio)：把 IMA 知识库的读/写能力按 Model Context Protocol 暴露出来。
//
// 工具：
//   ima_ask         提问（默认知识库模式，可切通用问答）
//   ima_kb_write    本地文件写入知识库（create_media → COS 上传 → add_knowledge → rename）
//   ima_kb_list     列出知识库文档
//   ima_kb_rename   修改文档标题
//   ima_kb_delete   按 media_id 删除文档
//
// 凭据读取 %DSH_HOME%/.credentials.yaml 中的 IMA_X_IMA_COOKIE / IMA_X_IMA_BKN / IMA_KNOWLEDGE_BASE_IDS。
// 本文件随 @deepseek-ai/dsh-ima-kb 插件发布（tools/ima-mcp-server.mjs），不依赖工作区的绝对路径。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import readline from "node:readline";

const HOME = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
const CRED_FILE = path.join(HOME, ".credentials.yaml");
const BASE = "https://ima.qq.com";

// ---------- 凭据 ----------
function readRefs(file) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/u);
  const refs = {};
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^ {2}([A-Z0-9_]+):\s*(.*)$/u.exec(lines[i]);
    if (!m) continue;
    let value = m[2].trim();
    for (let j = i + 1; j < lines.length && /^ {4,}\S/u.test(lines[j]); j += 1) value += ` ${lines[j].trim()}`;
    refs[m[1]] = value.replace(/^["']|["']$/gu, "");
  }
  return refs;
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

const refs = readRefs(CRED_FILE);
const cookie = refs.IMA_X_IMA_COOKIE ?? "";
const bkn = refs.IMA_X_IMA_BKN ?? "";
const DEFAULT_KB = (refs.IMA_KNOWLEDGE_BASE_IDS ?? "").split(/[\r\n,]+/u).map((s) => s.trim()).filter(Boolean)[0] ?? "";
const UA = cookieValue(cookie, "IMA-IUA") || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/144.0.0.0 Safari/537.36";

// ---------- IMA HTTP ----------
let session = null; // { token, cookie, expiresAt }

async function getSession() {
  if (session && session.expiresAt > Date.now() + 60_000) return session;
  const res = await fetch(`${BASE}/cgi-bin/auth_login/refresh`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "x-ima-bkn": bkn,
      "x-ima-cookie": cookie,
      "user-agent": UA,
      referer: "https://ima.qq.com/wikis",
    },
    body: JSON.stringify({
      user_id: cookieValue(cookie, "IMA-UID"),
      refresh_token: cookieValue(cookie, "IMA-REFRESH-TOKEN"),
      token_type: 14,
    }),
  });
  const json = await res.json();
  if (json.code !== 0) throw new Error(`IMA token 刷新失败: code=${json.code} ${json.msg ?? ""}`);
  const parts = cookie.split(";").map((p) => p.trim()).filter(Boolean);
  const ti = parts.findIndex((p) => p.startsWith("IMA-TOKEN="));
  if (ti >= 0) parts[ti] = `IMA-TOKEN=${json.token}`;
  else parts.push(`IMA-TOKEN=${json.token}`);
  session = { token: json.token, cookie: parts.join("; "), expiresAt: Date.now() + 20 * 60_000 };
  return session;
}

async function api(apiPath, bodyObject, headers = {}) {
  const s = await getSession();
  const res = await fetch(`${BASE}${apiPath}`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "accept-language": "zh-CN,zh;q=0.9",
      extension_version: "999.999.999",
      from_browser_ima: "1",
      referer: "https://ima.qq.com/wikis",
      "user-agent": UA,
      "x-ima-bkn": bkn,
      "x-ima-cookie": s.cookie,
      authorization: `Bearer ${s.token}`,
      ...headers,
    },
    body: typeof bodyObject === "string" ? bodyObject : JSON.stringify(bodyObject),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  return { status: res.status, json, text };
}

// ---------- 业务能力 ----------
// 问答节流：两次问答请求之间至少间隔 ASK_COOLDOWN_MS，避免触发 IMA 的「提问太快」限流。
const ASK_COOLDOWN_MS = 3000;
let lastAskAt = 0;
async function throttleAsk() {
  const wait = lastAskAt + ASK_COOLDOWN_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastAskAt = Date.now();
}
const MEDIA_TYPES = {
  ".md": "MARKDOWN", ".markdown": "MARKDOWN", ".txt": "TXT", ".pdf": "PDF",
  ".html": "HTML", ".htm": "HTML", ".docx": "WORD", ".doc": "WORD",
  ".pptx": "PPT", ".xlsx": "EXCEL", ".epub": "EPUB",
  ".png": "IMG", ".jpg": "IMG", ".jpeg": "IMG", ".webp": "IMG", ".gif": "IMG",
};
const CONTENT_TYPES = {
  MARKDOWN: "text/markdown; charset=utf-8",
  TXT: "text/plain; charset=utf-8",
  HTML: "text/html; charset=utf-8",
  PDF: "application/pdf",
  IMG: "image/png",
};

async function kbWrite({ file, title, knowledgeBaseId, folderId }) {
  const kb = knowledgeBaseId || DEFAULT_KB;
  if (!kb) throw new Error("缺少知识库 ID");
  const filePath = path.resolve(file);
  const bytes = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  const ext = path.extname(fileName).toLowerCase();
  const mediaType = MEDIA_TYPES[ext] ?? "MARKDOWN";
  const contentType = CONTENT_TYPES[mediaType] ?? "application/octet-stream";

  const created = await api("/cgi-bin/file_manager/create_media", {
    media_type: mediaType,
    file_name: fileName,
    file_size: String(bytes.length),
  });
  if (created.json?.code !== 0) throw new Error(`create_media 失败: ${created.text.slice(0, 200)}`);

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
  });
  if (!put.ok) throw new Error(`COS 上传失败: HTTP ${put.status}`);

  // 入库：need_parse 必须是布尔 true，且不能带 folder_id
  const added = await api("/cgi-bin/knowledge_tab_writer/add_knowledge", {
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
      content_type: contentType,
    },
  });
  if (added.json?.code !== 0) throw new Error(`add_knowledge 失败: ${added.text.slice(0, 200)}`);

  let renamed = false;
  if (title) {
    const r = await api("/cgi-bin/knowledge_tab_writer/rename_knowledge", {
      media_id: mediaId,
      knowledge_base_id: kb,
      title,
    });
    renamed = r.json?.code === 0;
  }

  return { mediaId, cosKey, bytes: bytes.length, mediaType, title: title || null, renamed, knowledgeBaseId: kb };
}

async function kbList({ knowledgeBaseId, cursor } = {}) {
  const kb = knowledgeBaseId || DEFAULT_KB;
  const toItems = (list) => (Array.isArray(list) ? list : []).map((item) => ({
    mediaId: item.media_id,
    title: item.title,
    mediaType: item.media_type,
    fileSize: item.file_size,
    parseProgress: item.parse_progress,
    updateTime: item.update_time,
    isFolder: item.media_type === 99,
  }));
  // 登录态 reader 接口：个人知识库与订阅库都可用（_nl 免登录版对个人库返回 80100）。
  const reader = await api("/cgi-bin/knowledge_tab_reader/get_knowledge_list", {
    knowledge_base_id: kb,
    limit: 50,
    cursor: "",
  });
  if (reader.json?.code === 0) {
    const items = toItems(reader.json.knowledge_list);
    return { knowledgeBaseId: kb, structured: true, total: reader.json.total_size ?? items.length, items };
  }
  const result = await api("/cgi-bin/knowledge_tab_reader_nl/get_knowledge_list", {
    knowledge_base_id: kb,
    limit: 50,
    offset: 0,
  });
  if (result.json?.code === 0) {
    const items = toItems(result.json.knowledge_list);
    return { knowledgeBaseId: kb, structured: true, total: result.json.total_size ?? items.length, items };
  }
  // 都失败时退化为让 IMA 自己列（结果是自然语言，但可用）。
  const fallback = await ask({ question: "请列出当前知识库中的全部文档，逐条给出标题和 media_id。", knowledgeBaseId: kb });
  return {
    knowledgeBaseId: kb,
    structured: false,
    note: `列表接口不可用（reader=${reader.json?.code ?? reader.status}, nl=${result.json?.code ?? result.status}），已退化为问答式列举`,
    answer: fallback.answer,
  };
}

async function kbRename({ mediaId, title, knowledgeBaseId }) {
  const kb = knowledgeBaseId || DEFAULT_KB;
  const r = await api("/cgi-bin/knowledge_tab_writer/rename_knowledge", {
    media_id: mediaId,
    knowledge_base_id: kb,
    title,
  });
  if (r.json?.code !== 0) throw new Error(`rename_knowledge 失败: ${r.text.slice(0, 200)}`);
  return { mediaId, title, ok: true };
}

async function kbDelete({ mediaIds, knowledgeBaseId }) {
  const kb = knowledgeBaseId || DEFAULT_KB;
  const r = await api("/cgi-bin/knowledge_tab_writer/del_knowledge", {
    media_ids: mediaIds,
    knowledge_base_id: kb,
  });
  if (r.json?.code !== 0) throw new Error(`del_knowledge 失败: ${r.text.slice(0, 200)}`);
  return { deleted: mediaIds, results: r.json.results ?? {} };
}

async function ask({ question, knowledgeBaseId, robotType = 5 }) {
  await throttleAsk();
  const kb = knowledgeBaseId || DEFAULT_KB;
  const init = await api("/cgi-bin/session_logic/init_session", {
    envInfo: { robotType, interactType: 0 },
    sceneType: 1,
    msgsLimit: 10,
    forbidAutoAddToHistoryList: false,
    ...(robotType === 5 && kb
      ? { relatedUrl: kb, knowledgeBaseInfoWithFolder: { knowledgeBaseId: kb, folderIds: [] } }
      : {}),
  });
  if (init.json?.code !== 0) throw new Error(`init_session 失败: ${init.text.slice(0, 200)}`);
  const sessionId = init.json.session_id;

  const s = await getSession();
  const qa = await fetch(`${BASE}/cgi-bin/assistant/qa`, {
    method: "POST",
    headers: {
      accept: "*/*",
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "accept-language": "zh-CN,zh;q=0.9",
      extension_version: "999.999.999",
      from_browser_ima: "1",
      referer: "https://ima.qq.com/wikis",
      "user-agent": UA,
      "x-ima-bkn": bkn,
      "x-ima-cookie": s.cookie,
      authorization: `Bearer ${s.token}`,
    },
    body: JSON.stringify({
      session_id: sessionId,
      robot_type: robotType,
      question,
      question_type: robotType === 10000 ? 3 : 2,
      client_id: crypto.randomUUID(),
      command_info: { type: 14, knowledge_qa_info: { tags: [], knowledge_ids: [], media_id_infos: [] } },
      model_info:
        robotType === 10000
          ? { model_type: 3, model_id: "official_3", enable_enhancement: true }
          : { model_type: 4, enable_enhancement: false },
      history_info: robotType === 10000 ? { type: 0 } : {},
      device_info: {
        uskey: crypto.randomBytes(32).toString("base64"),
        uskey_bus_infos_input: `${cookieValue(cookie, "IMA-GUID") ?? "default_guid"}_${Math.floor(Date.now() / 1000)}`,
      },
      client_tools: [],
    }),
  });
  const text = await qa.text();
  const answer = [];
  for (const line of text.split(/\r?\n/u)) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    try {
      const payload = JSON.parse(t.slice(5).trim());
      if (payload?.Type === "blockMessage" && payload.Data?.text_message?.Text) answer.push(payload.Data.text_message.Text);
      for (const key of ["content", "Text", "answer"]) {
        if (typeof payload?.[key] === "string" && payload[key]) answer.push(payload[key]);
      }
      if (Array.isArray(payload?.msgs)) {
        for (const m of payload.msgs) {
          const c = m?.content;
          if (typeof c === "string") answer.push(c);
          else if (typeof c?.answer === "string") answer.push(c.answer);
        }
      }
    } catch {
      /* skip */
    }
  }
  return { answer: answer.join("").trim(), robotType, knowledgeBaseId: robotType === 5 ? kb : null };
}

// ---------- MCP 协议 ----------
const tools = [
  {
    name: "ima_ask",
    description: "询问腾讯 IMA。默认用知识库模式（带引用）；robotType=10000 时用通用问答。",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "问题" },
        knowledgeBaseId: { type: "string", description: "可选，知识库 ID" },
        robotType: { type: "number", description: "5=知识库（默认），10000=通用问答" },
      },
      required: ["question"],
    },
  },
  {
    name: "ima_kb_write",
    description: "把本地文件写入 IMA 知识库（自动上传、解析、改名）。支持 md/txt/pdf/html/docx/pptx/xlsx/epub。",
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string", description: "本地文件绝对路径或相对当前目录的路径" },
        title: { type: "string", description: "可选，入库后的标题（默认用文件名）" },
        knowledgeBaseId: { type: "string", description: "可选，知识库 ID" },
        folderId: { type: "string", description: "可选，目标文件夹 id（如 folder_7526549616084612）；不传则落知识库根目录" },
      },
      required: ["file"],
    },
  },
  {
    name: "ima_kb_list",
    description: "列出 IMA 知识库中的文档（media_id、标题、解析进度等）。",
    inputSchema: {
      type: "object",
      properties: {
        knowledgeBaseId: { type: "string", description: "可选，知识库 ID" },
        cursor: { type: "string", description: "可选，分页游标" },
      },
    },
  },
  {
    name: "ima_kb_rename",
    description: "修改知识库文档标题。",
    inputSchema: {
      type: "object",
      properties: {
        mediaId: { type: "string", description: "文档的 media_id" },
        title: { type: "string", description: "新标题" },
        knowledgeBaseId: { type: "string", description: "可选，知识库 ID" },
      },
      required: ["mediaId", "title"],
    },
  },
  {
    name: "ima_kb_delete",
    description: "从知识库删除文档（按 media_id）。",
    inputSchema: {
      type: "object",
      properties: {
        mediaIds: { type: "array", items: { type: "string" }, description: "要删除的 media_id 列表" },
        knowledgeBaseId: { type: "string", description: "可选，知识库 ID" },
      },
      required: ["mediaIds"],
    },
  },
];

const handlers = {
  ima_ask: ask,
  ima_kb_write: kbWrite,
  ima_kb_list: kbList,
  ima_kb_rename: kbRename,
  ima_kb_delete: kbDelete,
};

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handleRequest(msg) {
  const { id, method, params } = msg;
  try {
    if (method === "initialize") {
      send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: params?.protocolVersion ?? "2024-11-05",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "ima-kb", version: "1.0.0" },
        },
      });
      return;
    }
    if (method === "ping") {
      send({ jsonrpc: "2.0", id, result: {} });
      return;
    }
    if (method === "tools/list") {
      send({ jsonrpc: "2.0", id, result: { tools } });
      return;
    }
    if (method === "tools/call") {
      const name = params?.name;
      const handler = handlers[name];
      if (!handler) throw new Error(`未知工具: ${name}`);
      const value = await handler(params.arguments ?? {});
      send({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
          structuredContent: value,
          isError: false,
        },
      });
      return;
    }
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
  } catch (error) {
    send({
      jsonrpc: "2.0",
      id,
      result: { content: [{ type: "text", text: `错误: ${error?.message ?? String(error)}` }], isError: true },
    });
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let pending = 0;
let closed = false;
const maybeExit = () => {
  if (closed && pending === 0) {
    // 让 stdout 写完再自然退出，避免 libuv 的 UV_HANDLE_CLOSING 断言
    process.stdout.write("", () => process.exit(0));
  }
};
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (msg.id === undefined) return; // notification
  pending += 1;
  handleRequest(msg).finally(() => {
    pending -= 1;
    maybeExit();
  });
});
rl.on("close", () => {
  closed = true;
  maybeExit();
});
process.on("SIGTERM", () => process.exit(0));
