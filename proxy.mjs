#!/usr/bin/env node
/**
 * 校园 AI 本地反向代理（联奕 AI 帮助台 / 学校 DeepSeek）
 *
 * 做三件事：
 *   1. 透明反代：/ai/autoHelpDesk/** 与 /ly-ai/** 全部转发到上游，前端资源与接口同源，
 *      SPA 无需改动即可通过 http://127.0.0.1:<PORT>/ai/autoHelpDesk/ 正常使用。
 *   2. SSO 回跳改写：把 CAS 回调地址从上游域名改写回本代理，使 token 落在本代理源的
 *      sessionStorage / cookie 里（REWRITE_SSO=1，默认开）。
 *   3. OpenAI 兼容网关：POST /v1/chat/completions -> 上游 say SSE。
 *      需要你自己的 aiAccessToken（环境变量 TOKEN，或同目录 token.txt）。
 *
 * 无第三方依赖。
 *
 * 用法：
 *   node proxy.mjs
 *   $env:TOKEN="你的aiAccessToken"; node proxy.mjs
 *   或把 token 写进同目录 token.txt 后直接 node proxy.mjs
 */

import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

const UPSTREAM = process.env.UPSTREAM || "https://aiservice.ly-sky.com";
const PORT = Number(process.env.PORT || 8799);
const BIND = process.env.BIND || "127.0.0.1";
const ENV_TOKEN = (process.env.TOKEN || "").trim();
const ACCESS_LAYER_ID =
  process.env.ACCESS_LAYER_ID || "1001740878824427000660000000001";
const REWRITE_SSO = (process.env.REWRITE_SSO || "1") !== "0";
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || `http://127.0.0.1:${PORT}`;
const DEBUG = process.env.DEBUG === "1";

/**
 * 凭证来源：环境变量 TOKEN 优先，其次同目录 token.txt。
 * token.txt 便于在不重启、且不把密钥写进命令行历史或聊天记录的情况下更换 token。
 */
const TOKEN_FILE =
  process.env.TOKEN_FILE ||
  path.join(path.dirname(fileURLToPath(import.meta.url)), "token.txt");
let tokenCache = { value: "", mtime: -1 };

function currentToken() {
  if (ENV_TOKEN) return ENV_TOKEN;
  try {
    const st = fs.statSync(TOKEN_FILE);
    if (st.mtimeMs !== tokenCache.mtime) {
      // 逐行取第一个非空、非注释行，允许文件里保留说明文字
      const line = fs
        .readFileSync(TOKEN_FILE, "utf8")
        .replace(/^\uFEFF/, "")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l && !l.startsWith("#") && !l.startsWith("//"));
      const value = (line || "")
        .replace(/^["']|["']$/g, "")
        .replace(/^aiAccessToken\s*[:=]\s*/i, "")
        .trim();
      // 占位符视为未配置
      const usable = /PASTE_YOUR/i.test(value) ? "" : value;
      tokenCache = { value: usable, mtime: st.mtimeMs };
      log("token.txt reloaded, length =", usable.length);
    }
    return tokenCache.value;
  } catch {
    return "";
  }
}

const up = new URL(UPSTREAM);
const upstreamAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 64,
  servername: up.hostname,
});

/** 逐跳首部，不可透传 */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function log(...a) {
  if (DEBUG) console.log(new Date().toISOString(), ...a);
}

/** 反代一个请求到上游；SSE 直接透传不缓冲 */
function passthrough(req, res) {
  const targetPath = req.url || "/";
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(k.toLowerCase())) headers[k] = v;
  }
  headers.host = up.host;

  // 注入校园身份凭证（仅当你提供了 token）
  const tok = currentToken();
  if (tok && targetPath.startsWith("/ly-ai/application/api/")) {
    headers["aiAccessToken"] = tok;
    headers["userAuthType"] = "AI";
  }

  const upstreamReq = https.request(
    {
      protocol: "https:",
      hostname: up.hostname,
      port: up.port || 443,
      method: req.method,
      path: targetPath,
      headers,
      agent: upstreamAgent,
    },
    (upstreamRes) => {
      const outHeaders = {};
      for (const [k, v] of Object.entries(upstreamRes.headers)) {
        if (!HOP_BY_HOP.has(k.toLowerCase())) outHeaders[k] = v;
      }
      // SSO 回跳改写：让 CAS 回调落到本代理
      if (REWRITE_SSO && outHeaders.location) {
        outHeaders.location = rewriteLocation(outHeaders.location);
      }
      res.writeHead(upstreamRes.statusCode || 502, outHeaders);
      upstreamRes.pipe(res);
    },
  );

  upstreamReq.on("error", (err) => {
    log("upstream error", err.message);
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json; charset=utf-8" });
    }
    res.end(
      JSON.stringify({ error: "upstream_unreachable", detail: err.message }),
    );
  });

  req.pipe(upstreamReq);
}

/** 把 CAS/上游绝对地址改写到本代理源 */
function rewriteLocation(loc) {
  try {
    // 1) 上游自身的回调地址 -> 本代理
    if (loc.startsWith(UPSTREAM)) return PUBLIC_ORIGIN + loc.slice(UPSTREAM.length);
    // 2) CAS 登录地址里的 service= 参数指向上游，改成指向本代理
    const u = new URL(loc);
    const service = u.searchParams.get("service");
    if (service && service.startsWith(UPSTREAM)) {
      u.searchParams.set(
        "service",
        PUBLIC_ORIGIN + service.slice(UPSTREAM.length),
      );
      return u.toString();
    }
    return loc;
  } catch {
    return loc;
  }
}

/* ------------------------- OpenAI 兼容网关 ------------------------- */

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 2 * 1024 * 1024) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** OpenAI messages -> 上游单条 message */
function messagesToPrompt(messages = []) {
  const parts = [];
  for (const m of messages) {
    const text =
      typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content)
          ? m.content
              .filter((p) => p && p.type === "text")
              .map((p) => p.text)
              .join("\n")
          : "";
    if (!text) continue;
    if (m.role === "system") parts.push(`【系统设定】${text}`);
    else if (m.role === "assistant") parts.push(`【历史回答】${text}`);
    else parts.push(text);
  }
  return parts.join("\n\n");
}

async function chatCompletions(req, res) {
  const token = currentToken();
  if (!token) {
    res.writeHead(401, { "content-type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        error: {
          type: "missing_token",
          message:
            "未配置 aiAccessToken。请把 token 写入同目录 token.txt，或设置 TOKEN 环境变量后重启。",
        },
      }),
    );
    return;
  }

  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (e) {
    res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: { message: `bad request: ${e.message}` } }));
    return;
  }

  const stream = payload.stream !== false;
  const id = "chatcmpl-" + Math.random().toString(36).slice(2, 12);
  const created = Math.floor(Date.now() / 1000);
  const model = payload.model || "school-deepseek";

  let sessionId = payload.session_id || "";
  const prompt = messagesToPrompt(payload.messages);
  if (!prompt) {
    res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: { message: "messages 为空" } }));
    return;
  }

  // 上游协议：POST /ly-ai/application/api/aialogue/say/{accessLayerId}
  const upstreamBody = JSON.stringify({
    message: prompt,
    messageType: 2,
    questionId: null,
    sessionId,
    hiAgentType: "",
    network: false,
  });

  let uRes;
  let lastErr = "";
  // 上游偶发 500「系统错误」（限流/抖动），首包未发出前重试
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(
        `${UPSTREAM}/ly-ai/application/api/aialogue/say/${ACCESS_LAYER_ID}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            aiAccessToken: token,
            userAuthType: "AI",
            accept: "text/event-stream",
          },
          body: upstreamBody,
        },
      );
      if (r.ok && r.body) {
        uRes = r;
        break;
      }
      // 631 未登录这类错误重试无意义，直接返回
      const text = await r.text().catch(() => "");
      lastErr = `${r.status} ${text}`;
      if (text.includes("631") || text.includes("未登录")) {
        res.writeHead(r.status, {
          "content-type": "application/json; charset=utf-8",
        });
        res.end(JSON.stringify({ error: { message: text || r.statusText } }));
        return;
      }
      log(`upstream attempt ${attempt} failed:`, lastErr.slice(0, 200));
    } catch (e) {
      lastErr = e.message;
      log(`upstream attempt ${attempt} threw:`, e.message);
    }
    if (attempt < 3) await new Promise((r2) => setTimeout(r2, 600 * attempt));
  }

  if (!uRes) {
    res.writeHead(502, { "content-type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        error: {
          message: `上游连续 3 次失败: ${lastErr}`,
          hint: "多为上游限流或抖动，稍后重试；若含 631 则 token 已过期，需重新获取。",
        },
      }),
    );
    return;
  }

  const chunk = (delta, finish = null) =>
    `data: ${JSON.stringify({
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`;

  if (stream) {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.write(chunk({ role: "assistant", content: "" }));
  }

  let answer = "";
  let reasoning = "";
  let buffer = "";
  const decoder = new TextDecoder();

  /**
   * 上游 SSE 事件字段（逆向自 SPA）：
   *   data             增量正文（字符串；AI_HELPER 卡片时可能是对象，需跳过）
   *   reasoningContent 增量思维链
   *   sessionId        会话 ID，首轮返回后可复用
   *   type === "End"   本轮结束
   *   replySource      DOC_QA / TEXT_REPLY / CHITCHAT / SYSTEM / SCHEDULE_INFO / ...
   *   resultType       1=答案卡片 2=选项 3/8=模型回答
   */
  try {
    for await (const raw of uRes.body) {
      buffer += decoder.decode(raw, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const s = line.trim();
        if (!s.startsWith("data:")) continue;
        const body = s.slice(5).trim();
        if (!body || body === "[DONE]") continue;

        let evt;
        try {
          evt = JSON.parse(body);
        } catch {
          continue;
        }
        if (evt.sessionId) sessionId = evt.sessionId;

        if (typeof evt.reasoningContent === "string" && evt.reasoningContent) {
          reasoning += evt.reasoningContent;
          // DeepSeek 系客户端（含 dsh 的 pi-ai 适配器，thinkingFormat=deepseek）
          // 靠 reasoning_content 增量显示思维链，所以要一直发。
          if (stream) res.write(chunk({ reasoning_content: evt.reasoningContent }));
        }

        // 只有字符串才是增量正文；对象属于卡片类回复，交给调用方按需处理
        if (typeof evt.data === "string" && evt.data) {
          answer += evt.data;
          if (stream) res.write(chunk({ content: evt.data }));
        } else if (
          typeof evt.message === "string" &&
          evt.message &&
          evt.replySource !== "SYSTEM"
        ) {
          answer += evt.message;
          if (stream) res.write(chunk({ content: evt.message }));
        }

        if (evt.type === "End") log("upstream End event");
      }
    }
  } catch (e) {
    log("stream error", e.message);
  }

  if (stream) {
    res.write(chunk({}, "stop"));
    // OpenAI 客户端开了 stream_options.include_usage 时，末尾要单独发一个 usage 帧
    if (payload.stream_options && payload.stream_options.include_usage) {
      res.write(
        `data: ${JSON.stringify({
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        })}\n\n`,
      );
    }
    res.write("data: [DONE]\n\n");
    res.end();
  } else {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        id,
        object: "chat.completion",
        created,
        model,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: answer,
              ...(reasoning ? { reasoning_content: reasoning } : {}),
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        session_id: sessionId,
      }),
    );
  }
}

/* ------------------------------ 路由 ------------------------------ */

const server = http.createServer((req, res) => {
  const path = (req.url || "/").split("?")[0];
  log(req.method, req.url, "token=" + (currentToken() ? "yes" : "no"));

  if (path === "/healthz") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        ok: true,
        upstream: UPSTREAM,
        public_origin: PUBLIC_ORIGIN,
        token_configured: Boolean(currentToken()),
        rewrite_sso: REWRITE_SSO,
      }),
    );
    return;
  }

  if (path === "/v1/models") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        object: "list",
        data: [{ id: "school-deepseek", object: "model", owned_by: "school" }],
      }),
    );
    return;
  }

  if (path === "/v1/chat/completions" && req.method === "POST") {
    chatCompletions(req, res).catch((e) => {
      log("bridge error", e);
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      }
      res.end(JSON.stringify({ error: { message: e.message } }));
    });
    return;
  }

  // 其余全部透明反代（SPA 静态资源 + 校园接口）
  passthrough(req, res);
});

server.headersTimeout = 0;
server.requestTimeout = 0;
server.keepAliveTimeout = 65_000;

server.listen(PORT, BIND, () => {
  console.log(`[school-ai-proxy] listening on ${PUBLIC_ORIGIN}`);
  console.log(
    `  SPA   : ${PUBLIC_ORIGIN}/ai/autoHelpDesk/?accessLayerId=${ACCESS_LAYER_ID}&ssoAuth=1`,
  );
  console.log(
    `  OpenAI: ${PUBLIC_ORIGIN}/v1/chat/completions  (token: ${currentToken() ? "已配置" : "未配置"})`,
  );
  console.log(`  upstream: ${UPSTREAM}`);
});
