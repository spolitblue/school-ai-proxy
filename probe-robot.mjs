#!/usr/bin/env node
/**
 * 机器人配置探针：SPA 的 modelName / modelType 来自服务端 robot baseInfo，
 * 这里用同一批接口把它问出来（物证，而非模型自述）。
 *   node probe-robot.mjs
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

const calls = [
  ["robot baseInfo（按 id 取机器人配置）", `/ly-ai/application/api/mRobot/baseInfo/${ACCESS_LAYER_ID}`, {}],
  ["helloMsg", "/ly-ai/application/api/mRobot/baseInfo/helloMsg", { accessLayerId: ACCESS_LAYER_ID }],
  ["getEnableClassifyList", "/ly-ai/application/api/mRobot/baseInfo/getEnableClassifyList", { accessLayerId: ACCESS_LAYER_ID }],
];

const out = [
  "# 机器人配置探针报告（模型溯源的物证）",
  "",
  `- 时间: ${new Date().toISOString()}`,
  `- 上游: ${UPSTREAM}`,
  `- accessLayerId: ${ACCESS_LAYER_ID}`,
  "",
];

for (const [name, url, body] of calls) {
  console.log("\n=====", name);
  let r;
  try {
    r = await fetch(`${UPSTREAM}${url}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        aiAccessToken: token,
        userAuthType: "AI",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.log("请求异常:", e.message);
    out.push(`## ${name}`, "", `- 请求异常: ${e.message}`, "");
    continue;
  }
  const text = await r.text();
  console.log("HTTP", r.status);
  let j = null;
  try {
    j = JSON.parse(text);
  } catch {}
  console.log(text.slice(0, 1500));

  out.push(`## ${name}`, "", `- URL: \`POST ${url}\``, `- HTTP: ${r.status}`, "");

  if (j && typeof j === "object") {
    // 找出所有含 model 的键，递归
    const hits = [];
    (function walk(o, p) {
      if (!o || typeof o !== "object") return;
      for (const [k, v] of Object.entries(o)) {
        const np = p ? `${p}.${k}` : k;
        if (/model|robotName|tenantId|accessLayerType/i.test(k)) {
          hits.push(`\`${np}\` = ${JSON.stringify(v)}`);
        }
        walk(v, np);
      }
    })(j, "");
    if (hits.length) {
      out.push("### 含 model / 机器人标识的字段", "", ...hits.map((h) => `- ${h}`), "");
    } else {
      out.push("（无 model 相关字段）", "");
    }
  }
  out.push("<details><summary>原始响应（截断 2000 字）</summary>", "", "```json", text.slice(0, 2000), "```", "</details>", "");
}

fs.writeFileSync(path.join(dir, "robot-report.md"), out.join("\n"), "utf8");
console.log("\n报告: robot-report.md");
