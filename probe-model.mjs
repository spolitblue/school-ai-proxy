#!/usr/bin/env node
/**
 * 模型溯源探针：直接打上游 say，把 SSE 事件的**全部字段**摊开，
 * 找 modelId / modelName / modelType 这类可验证的模型标识。
 *   node probe-model.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const UPSTREAM = process.env.UPSTREAM || "https://aiservice.ly-sky.com";
const ACCESS_LAYER_ID =
  process.env.ACCESS_LAYER_ID || "1001740878824427000660000000001";

function readToken() {
  const line = fs
    .readFileSync(path.join(dir, "token.txt"), "utf8")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("#") && !l.startsWith("//"));
  return (line || "").trim();
}

const token = readToken();
if (!token) {
  console.error("token.txt 里没有 token");
  process.exit(1);
}

const question = process.argv[2] || "你好，请用一句话介绍你自己";

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
    body: JSON.stringify({
      message: question,
      messageType: 2,
      questionId: null,
      sessionId: "",
      hiAgentType: "",
      network: false,
    }),
  },
);

console.log("HTTP", r.status, r.headers.get("content-type"));
if (!r.ok) {
  console.log((await r.text()).slice(0, 500));
  process.exit(1);
}

const events = [];
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
    try {
      events.push(JSON.parse(body));
    } catch {}
  }
}

console.log("事件总数:", events.length);

// 所有出现过的顶层字段，以及去重后的取值
const values = new Map();
for (const e of events) {
  for (const [k, v] of Object.entries(e)) {
    if (!values.has(k)) values.set(k, new Set());
    const repr =
      typeof v === "object" && v !== null
        ? `[${Array.isArray(v) ? "array" : "object"}]`
        : String(v);
    if (repr.length < 120) values.get(k).add(repr);
  }
}

const lines = [
  "# 模型溯源探针报告",
  "",
  `- 时间: ${new Date().toISOString()}`,
  `- 上游: ${UPSTREAM}`,
  `- 问题: ${question}`,
  `- 事件总数: ${events.length}`,
  "",
  "## SSE 事件全部字段（含去重取值）",
  "",
  "| 字段 | 出现取值（去重，最多 8 个） |",
  "| --- | --- |",
];
for (const [k, set] of values) {
  const arr = [...set].slice(0, 8);
  lines.push(
    `| \`${k}\` | ${arr.map((x) => "`" + x.replace(/\|/g, "\\|") + "`").join(" / ")} |`,
  );
}

// 重点看：带 model 字样的字段
const modelKeys = [...values.keys()].filter((k) => /model/i.test(k));
lines.push("", "## 疑似模型标识字段", "");
if (modelKeys.length === 0) {
  lines.push("**SSE 事件里没有任何含 `model` 的字段。**", "");
} else {
  for (const k of modelKeys) {
    lines.push(`- \`${k}\` = ${[...values.get(k)].join(" / ")}`);
  }
  lines.push("");
}

// 首尾事件原文
lines.push(
  "## 首尾事件原文（截断 1200 字）",
  "",
  "```json",
  JSON.stringify(events[0], null, 2).slice(0, 1200),
  "```",
  "",
  "```json",
  JSON.stringify(events[events.length - 1], null, 2).slice(0, 1200),
  "```",
  "",
);

fs.writeFileSync(path.join(dir, "model-report.md"), lines.join("\n"), "utf8");
fs.writeFileSync(
  path.join(dir, "model-raw-events.json"),
  JSON.stringify(events, null, 2),
  "utf8",
);
console.log("报告: model-report.md");
console.log("原始事件: model-raw-events.json");
console.log("\n含 model 的字段:", modelKeys.length ? modelKeys.join(", ") : "(无)");
for (const k of modelKeys) console.log(`  ${k} = ${[...values.get(k)].join(" / ")}`);
