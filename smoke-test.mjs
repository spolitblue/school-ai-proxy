#!/usr/bin/env node
/**
 * 冒烟测试：验证 OpenAI 兼容口能否真正拿到校园 AI 的回答。
 *   node smoke-test.mjs "你的问题"
 */

const PROXY = process.env.PROXY || "http://127.0.0.1:8799";
const question = process.argv[2] || "你好，请用一句话介绍你自己";

async function health() {
  const r = await fetch(`${PROXY}/healthz`);
  const j = await r.json();
  console.log("[healthz]", JSON.stringify(j));
  if (!j.token_configured) {
    console.error("!! token 未配置，先写 token.txt");
    process.exit(1);
  }
}

async function nonStream() {
  console.log("\n=== 非流式 POST /v1/chat/completions ===");
  const r = await fetch(`${PROXY}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "school-deepseek",
      messages: [{ role: "user", content: question }],
      stream: false,
    }),
  });
  console.log("HTTP", r.status);
  const text = await r.text();
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    console.log("非 JSON 响应前 500 字:", text.slice(0, 500));
    return;
  }
  if (j.error) {
    console.log("上游错误:", JSON.stringify(j.error).slice(0, 800));
    return;
  }
  console.log("session_id:", j.session_id);
  console.log("finish_reason:", j.choices?.[0]?.finish_reason);
  const msg = j.choices?.[0]?.message || {};
  if (msg.reasoning_content) {
    console.log("\n--- reasoning_content ---");
    console.log(msg.reasoning_content.slice(0, 1200));
  }
  console.log("\n--- content ---");
  console.log(msg.content || "(空)");
  console.log("\ncontent 长度:", (msg.content || "").length);
}

async function streamed() {
  console.log("\n=== 流式 POST /v1/chat/completions (stream:true) ===");
  const r = await fetch(`${PROXY}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "school-deepseek",
      messages: [{ role: "user", content: question }],
      stream: true,
    }),
  });
  console.log("HTTP", r.status, r.headers.get("content-type"));
  if (!r.ok) {
    console.log((await r.text()).slice(0, 800));
    return;
  }
  let answer = "";
  let reasoning = "";
  let chunks = 0;
  let buffer = "";
  const dec = new TextDecoder();
  for await (const raw of r.body) {
    buffer += dec.decode(raw, { stream: true });
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
      chunks++;
      const d = evt.choices?.[0]?.delta || {};
      if (d.content) answer += d.content;
      if (d.reasoning_content) reasoning += d.reasoning_content;
    }
  }
  console.log("收到 chunk 数:", chunks);
  if (reasoning) console.log("reasoning 长度:", reasoning.length);
  console.log("\n--- 拼接后的 content ---");
  console.log(answer || "(空)");
  console.log("\ncontent 长度:", answer.length);
}

await health();
await nonStream();
await streamed();
