#!/usr/bin/env node
/**
 * 历史拼接探针：上游原生 session_id 不保留上下文时，靠把完整对话历史拼进
 * 单条 message 来维持多轮。验证该路径是否有效。
 *   node probe-history.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROXY = process.env.PROXY || "http://127.0.0.1:8799";
const out = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "history-report.md",
);

async function ask(messages) {
  const r = await fetch(`${PROXY}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "school-deepseek", messages, stream: false }),
  });
  const j = await r.json().catch(() => ({}));
  if (j.error) return { http: r.status, error: JSON.stringify(j.error) };
  return {
    http: r.status,
    content: j.choices?.[0]?.message?.content || "",
    session_id: j.session_id,
  };
}

const lines = [
  "# 历史拼接探针报告",
  "",
  `- 时间: ${new Date().toISOString()}`,
  "- 思路: 不依赖上游 session 记忆，把完整对话历史拼进单条 prompt",
  "",
];

// 模拟 OpenAI 客户端发送完整历史
const messages = [
  { role: "system", content: "你是一个乐于助人的助手，回答尽量简短。" },
  { role: "user", content: "请记住一个数字：42。只回复“记住了”。" },
  { role: "assistant", content: "记住了" },
  { role: "user", content: "我刚才让你记住的数字是多少？只回数字。" },
];

lines.push("## 发送的 messages", "", "```json", JSON.stringify(messages, null, 2), "```", "");
console.log("发送 4 条 message（system + 2 轮 user + 1 轮 assistant）...");

const r = await ask(messages);
lines.push(`## 结果`, "", `- HTTP: ${r.http}`, `- session_id: \`${r.session_id || "(无)"}\``);
lines.push(`- 回答: ${r.content || r.error}`, "");
console.log("HTTP", r.http, "| 回答:", (r.content || r.error || "").slice(0, 120));

const ok = (r.content || "").includes("42");
lines.push(
  "## 结论",
  "",
  ok
    ? "- ✅ 历史拼接生效：模型正确回忆起 42，多轮上下文可用。"
    : "- ⚠️ 历史拼接未生效，需另想办法维持上下文。",
  "",
);

fs.writeFileSync(out, lines.join("\n"), "utf8");
console.log("\n报告已写入:", out);
