#!/usr/bin/env node
/**
 * 流式稳定性探针：连续发若干次流式请求，把结果写成 UTF-8 报告文件。
 *   node probe-stream.mjs [次数]
 * 报告写到 probe-report.md，避开 PowerShell 重定向的 UTF-16 坑。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROXY = process.env.PROXY || "http://127.0.0.1:8799";
const N = Number(process.argv[2] || 3);
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "probe-report.md");

const questions = [
  "1+1 等于几？只回数字",
  "用一句话说明什么是快速排序",
  "水的化学式是什么？",
  "武汉科技大学在哪个城市？",
  "用一句话解释什么是递归",
];

async function oneStream(q, i) {
  const started = Date.now();
  let status = 0;
  let answer = "";
  let chunks = 0;
  let err = "";
  try {
    const r = await fetch(`${PROXY}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "school-deepseek",
        messages: [{ role: "user", content: q }],
        stream: true,
      }),
    });
    status = r.status;
    if (!r.ok) {
      err = (await r.text()).slice(0, 300);
    } else {
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
            const evt = JSON.parse(body);
            chunks++;
            const d = evt.choices?.[0]?.delta || {};
            if (d.content) answer += d.content;
          } catch {}
        }
      }
    }
  } catch (e) {
    err = "fetch 异常: " + e.message;
  }
  return {
    i,
    q,
    status,
    chunks,
    answer,
    err,
    ms: Date.now() - started,
  };
}

const results = [];
for (let i = 0; i < N; i++) {
  const q = questions[i % questions.length];
  const r = await oneStream(q, i + 1);
  results.push(r);
  console.log(
    `#${r.i} status=${r.status} chunks=${r.chunks} ms=${r.ms} answer="${r.answer.slice(0, 40)}" ${r.err ? "ERR=" + r.err.slice(0, 80) : ""}`,
  );
  await new Promise((r2) => setTimeout(r2, 800));
}

const okCount = results.filter((r) => r.status === 200).length;
const lines = [
  "# 流式稳定性探针报告",
  "",
  `- 目标: ${PROXY}`,
  `- 时间: ${new Date().toISOString()}`,
  `- 成功: ${okCount}/${results.length}`,
  "",
  "| # | HTTP | chunks | 耗时ms | 回答 | 错误 |",
  "| --- | --- | --- | --- | --- | --- |",
  ...results.map(
    (r) =>
      `| ${r.i} | ${r.status} | ${r.chunks} | ${r.ms} | ${r.answer.replace(/\|/g, "\\|").slice(0, 80)} | ${r.err.replace(/\|/g, "\\|").slice(0, 120)} |`,
  ),
  "",
];
fs.writeFileSync(out, lines.join("\n"), "utf8");
console.log("\n报告已写入:", out);
