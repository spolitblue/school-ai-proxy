#!/usr/bin/env node
/**
 * 多轮会话探针：验证 session_id 复用能否让上游记住上下文。
 *   node probe-session.mjs
 * 报告写到 session-report.md。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROXY = process.env.PROXY || "http://127.0.0.1:8799";
const out = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "session-report.md",
);

async function ask(question, sessionId) {
  const r = await fetch(`${PROXY}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "school-deepseek",
      messages: [{ role: "user", content: question }],
      stream: false,
      ...(sessionId ? { session_id: sessionId } : {}),
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (j.error) return { http: r.status, error: JSON.stringify(j.error) };
  return {
    http: r.status,
    content: j.choices?.[0]?.message?.content || "",
    session_id: j.session_id,
  };
}

const lines = ["# 多轮会话探针报告", "", `- 时间: ${new Date().toISOString()}`, ""];

// 第一轮：不带 session_id
const r1 = await ask("请记住一个数字：42。只回复“记住了”。");
lines.push("## 第 1 轮（新会话）", "", `- 问题: 请记住一个数字：42`, `- HTTP: ${r1.http}`);
lines.push(`- session_id: \`${r1.session_id || "(无)"}\``);
lines.push(`- 回答: ${r1.content || r1.error}`, "");
console.log("R1:", r1.http, "session=", r1.session_id, "|", (r1.content || r1.error || "").slice(0, 60));

// 第二轮：复用 session_id
const r2 = await ask("我刚才让你记住的数字是多少？只回数字。", r1.session_id);
lines.push("## 第 2 轮（复用同一 session_id）", "", `- 问题: 我刚才让你记住的数字是多少？`, `- HTTP: ${r2.http}`);
lines.push(`- session_id: \`${r2.session_id || "(无)"}\``);
lines.push(`- 回答: ${r2.content || r2.error}`, "");
console.log("R2:", r2.http, "|", (r2.content || r2.error || "").slice(0, 80));

// 第三轮：全新会话，作为对照
const r3 = await ask("我刚才让你记住的数字是多少？只回数字。");
lines.push("## 第 3 轮（全新会话，对照组）", "", `- 问题: 同第 2 轮`, `- HTTP: ${r3.http}`);
lines.push(`- session_id: \`${r3.session_id || "(无)"}\``);
lines.push(`- 回答: ${r3.content || r3.error}`, "");
console.log("R3:", r3.http, "|", (r3.content || r3.error || "").slice(0, 80));

const remembered = (r2.content || "").includes("42");
lines.push(
  "## 结论",
  "",
  remembered
    ? "- ✅ session_id 复用生效：第 2 轮仍记得 42，上下文连续。"
    : "- ⚠️ 第 2 轮未体现记忆，session_id 可能未生效或上游按轮次重置。",
  `- 对照: 第 3 轮新会话回答 ${JSON.stringify((r3.content || "").slice(0, 40))}`,
  "",
);

fs.writeFileSync(out, lines.join("\n"), "utf8");
console.log("\n报告已写入:", out);
