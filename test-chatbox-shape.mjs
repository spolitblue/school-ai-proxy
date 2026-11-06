#!/usr/bin/env node
/**
 * 按 Chatbox 实际会发送的请求形状打一次本地反代，确认兼容。
 * Chatbox 自定义 provider 的行为：POST {apiHost}{apiPath}，
 * body 含 model / messages / stream / temperature / top_p / max_tokens，
 * 带 Authorization: Bearer <apiKey>（apiKey 是占位串，反代不校验）。
 */
const PROXY = "http://127.0.0.1:8799/v1/chat/completions";

const body = {
  model: "school-deepseek",
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "用一句话解释什么是快速排序" },
  ],
  stream: true,
  temperature: 0.7,
  top_p: 1,
  max_tokens: 2048,
};

console.log("POST", PROXY);
const t0 = Date.now();
const r = await fetch(PROXY, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: "Bearer dsh-local-proxy-placeholder",
  },
  body: JSON.stringify(body),
});
console.log("HTTP", r.status, r.headers.get("content-type"), "| 响应头耗时:", Date.now() - t0, "ms");
if (!r.ok) {
  console.log((await r.text()).slice(0, 600));
  process.exit(1);
}

let content = "";
let reasoning = "";
let chunks = 0;
let firstChunkMs = 0;
let buffer = "";
const dec = new TextDecoder();
for await (const raw of r.body) {
  if (!firstChunkMs) firstChunkMs = Date.now() - t0;
  buffer += dec.decode(raw, { stream: true });
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    const s = line.trim();
    if (!s.startsWith("data:")) continue;
    const b = s.slice(5).trim();
    if (!b || b === "[DONE]") continue;
    let e;
    try {
      e = JSON.parse(b);
    } catch {
      continue;
    }
    chunks++;
    const d = e.choices?.[0]?.delta || {};
    if (d.reasoning_content) reasoning += d.reasoning_content;
    if (d.content) content += d.content;
  }
}
console.log("首包延迟:", firstChunkMs, "ms | 总耗时:", Date.now() - t0, "ms | chunk 数:", chunks);
console.log("reasoning 字符数:", reasoning.length);
console.log("\n--- content ---");
console.log(content || "(空)");
