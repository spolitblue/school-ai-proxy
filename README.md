# 校园 AI 本地反向代理（联奕 AI 帮助台 / 学校 DeepSeek）

零依赖 Node 脚本，把 `https://aiservice.ly-sky.com`（武汉科技大学 · 联奕「智能帮助台」）
反代到本地，并额外提供一个 OpenAI 兼容口。

## 结论速览

| 问题 | 结论 |
| --- | --- |
| 能不能反代 | **能**。公网 443 直连、无客户端证书、无 IP 白名单、无 CORS 限制 |
| 反代能不能白嫖 | **不能**。鉴权在服务端：请求头 `aiAccessToken` + `userAuthType: AI`，无效即 `{"code":631,"message":"用户未登录，无权限查看"}` |
| 凭证从哪来 | 学校统一身份认证 `https://auth.wust.edu.cn/lyuapServer/login`（CAS）登录后签发，有效期有限，过期需重登 |
| 后端模型 | 服务端配置声明 **`modelName = "DeepSeek-R1"`**，平台 `modelType = ["LianYi"]`（联奕自有平台，不是火山 HiAgent） |
| 模型溯源的依据 | `POST /ly-ai/application/api/mRobot/baseInfo/helloMsg` 返回的机器人配置，属服务端物证；另有推理流里字面出现 `<think>` 且无 `</think>`（后端按结尾标记切分），与 R1 系一致 |
| 机器人身份 | `robotName = "武科大校园助手"`，`robotId = "o81562"`，`tenantId = "wust"`，`isEnableLargeModel = "1"` |
| 开场白 | `#username#老师你好，我是Deepseek武科大专属版，很高兴见到你！`（由校方/服务商配置，非模型自述） |
| 能否当通用模型用 | **能**。实测非校园问题（Python 快排、化学式、递归解释）均正常作答，未拒答 |
| 上下文 | 上游原生 `session_id` **不保留记忆**；靠把完整 history 拼进 prompt 维持多轮（已验证有效） |

## 接入 DeepSeek Harness（dsh）

路由配在 **profile 补丁层**，也就是你自己维护的那个文件：

`C:\Users\LZY20\.dsh\profiles\desktop\cordis.patch.yml` → `id: llm-pi-ai` → `config.providers`：

```yaml
      wust-school:
        displayName: DeepSeek-R1
        apiKeyEnv: WUST_SCHOOL_API_KEY
        api: openai-completions
        baseURL: http://127.0.0.1:8799/v1
        compat:
          thinkingFormat: deepseek
        models:
          - id: school-deepseek
            name: DeepSeek-R1 · 武科大校园助手
            contextWindow: 65536
            maxTokens: 8192
            input:
              - text
            reasoningEfforts:
              off: null
              high: high
```

放在补丁层比放 `$DSH_HOME/settings.yaml` 更好：和已有的两条小米路由同处一个字典，属于组合层，
不依赖 settings 文档的存在与否（那份文档被重命名/删掉过一次，路由就跟着失效了）。

**热加载行为（已核实源码）**：desktop profile 的 `package.json` 没声明 `patchReload`，
而 `dsh-app-boot` 里是 `const patchReload = rawPatchReload ?? "live"` —— **默认就是 `live`**，
注释写着 "custom profiles default to live reload"。所以改完保存即生效，**不需要重启 harness**。

配套改动：

- `C:\Users\LZY20\.dsh\.credentials.yaml` 的 `refs` 下加了占位密钥
  `WUST_SCHOOL_API_KEY`（反代不校验 API key，真凭证是 `token.txt` 里的 `aiAccessToken`）
- 该路由走 `@deepseek-ai/dsh-llm-pi-ai`（base 里已休眠挂载，一给 profile 就注册路由）

### 关键约束

| 项 | 说明 |
| --- | --- |
| `api: openai-completions` | 非 pi-ai 目录路由必须显式声明协议 + `baseURL` + 非空 `models`，否则 `assertServiceable` 拒绝 |
| `thinkingFormat: deepseek` | 让 pi-ai 从 `reasoning_content` 读思维链；反代已改成**总是**输出该增量字段 |
| `reasoningEfforts` | 只影响选择器开关。上游是校园智能体，**永远会思考**，选 off 也关不掉 |
| 工具调用 | **不支持**。反代只转发 `messages`，不翻译 `tools`/`tool_calls`，所以 harness 里只能对话，不能驱动工具 |

### 怎么自检这份配置

不要靠肉眼。用插件自己的解析器验证，等价于 harness 热加载时的判定：

```powershell
# 1) 复制包体并补上内部导出（resolveProfiles 没被公开导出）
$p="C:\Users\LZY20\.dsh\profiles\node_modules\@deepseek-ai\dsh-llm-pi-ai\lib\index.js"
Copy-Item $p "C:\Users\LZY20\.dsh\profiles\_probe.mjs"
Add-Content "C:\Users\LZY20\.dsh\profiles\_probe.mjs" "`nexport { resolveProfiles, assertServiceable };"
# 2) 在 C:\Users\LZY20\.dsh\profiles 下用 js-yaml 读 cordis.patch.yml，
#    取出 id=llm-pi-ai 条目的 config.providers，
#    依次跑 Config(section) -> assertServiceable -> resolveProfiles -> piProvider.getModels()
# 3) 用完删掉 _probe.mjs
```

实测结果：三步全过，`resolveProfiles` 返回 **3 条路由**（`xiaomi`、`xiaomi-token-plan-cn`、`wust-school`），
`wust-school` 的模型为 `id=school-deepseek`、`ctx=65536`、`api=openai-completions`、
`thinking="deepseek"`、`reasoning=true`。

这一步不是形式主义：配置若不可服务，插件会**静默保留上一个有效路由集**（只写一条 error 日志），
表面上什么都不会报——所以必须主动验证。

## 保活：登录时自动启动（计划任务）

反代必须常驻，否则 harness 重启后路由就指向一个没人监听的端口。
**踩过的坑：harness 重启会杀掉它的子进程树**，所以反代绝不能挂在 harness 下面启动。

已注册一个用户级计划任务：

| 项 | 值 |
| --- | --- |
| 任务名 | `DSH-SchoolAI-Proxy` |
| 触发 | 登录时（`AtLogOn`，当前用户） |
| 动作 | `wscript.exe start-proxy-hidden.vbs`（隐藏窗口） |
| 权限 | 当前用户、`Limited`（不提权） |
| 时长限制 | 无（`ExecutionTimeLimit: 0`） |
| 多实例 | `IgnoreNew` |

配套文件：

- [start-proxy.bat](start-proxy.bat)——**幂等**启动器：先 `netstat` 查 8799，已在监听就直接 `exit 0`；
  否则定位 node 并以 `DEBUG=1` 启动，输出追加到 `proxy.log`
- [start-proxy-hidden.vbs](start-proxy-hidden.vbs)——以窗口样式 0 运行 bat，登录时不闪黑框

验证记录（2026-10-10）：停掉手动启的代理 → `Start-ScheduledTask` → `healthz` 正常 →
新进程链 `node.exe ← cmd.exe`（父进程已退出，**不在 harness 进程树下**）→ `LastTaskResult: 0` →
重复执行启动器不起第二个实例。

手动控制：

```powershell
Start-ScheduledTask   -TaskName "DSH-SchoolAI-Proxy"    # 立即启动
Unregister-ScheduledTask -TaskName "DSH-SchoolAI-Proxy" -Confirm:$false   # 彻底卸载

# 停掉代理进程本身（改完 proxy.mjs 后需要这样重启）
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'school-ai-proxy\\proxy\.mjs' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-ScheduledTask -TaskName "DSH-SchoolAI-Proxy"
```

## 接入 Chatbox（1.23.1）

Harness 里它显得笨，是因为 harness 会把整段 agent 系统提示词塞进去，而 R1 没有工具能力、
只能干瞪眼。放进 Chatbox 就是纯粹的聊天，会正常很多。

配置文件：`%APPDATA%\xyz.chatboxapp.app\config.json`（Chatbox 自己也会定期备份）。

**关键约束**：只在 `settings.providers` 里加是不够的。Chatbox 取 provider 时会先查注册表：

```js
const providerBaseInfo = [...getSystemProviders(), ...(globalSettings.customProviders || [])]
  .find((p) => p.id === provider)
if (!providerBaseInfo) throw new Error(`Cannot find model with provider: ${setting.provider}`)
```

所以**必须同时在 `settings.customProviders` 里注册**，否则报
`Cannot find model with provider: wust-school`。

写入的两段：

```json
"providers": {
  "wust-school": {
    "apiKey": "dsh-local-proxy-placeholder",
    "apiHost": "http://127.0.0.1:8799/v1",
    "apiPath": "/chat/completions",
    "useProxy": false,
    "models": [{
      "modelId": "school-deepseek",
      "type": "chat",
      "apiStyle": "openai",
      "nickname": "DeepSeek-R1 · 武科大校园助手",
      "capabilities": ["reasoning"],
      "contextWindow": 65536,
      "maxOutput": 8192
    }]
  }
},
"customProviders": [{
  "id": "wust-school",
  "name": "武科大 DeepSeek-R1",
  "isCustom": true,
  "type": "openai",
  "defaultSettings": { "apiHost": "http://127.0.0.1:8799/v1", "apiPath": "/chat/completions" }
}]
```

字段依据（从 `C:\Program Files\Chatbox\resources\app.asar` 里抠出的 zod schema）：

- `ProviderModelInfoSchema`：`modelId`(必填)、`providerId?`、`type?: chat|embedding|rerank|image`、
  `apiStyle?: google|openai|openai-responses|anthropic`、`nickname?`、`labels?`、
  `capabilities?: vision|reasoning|tool_use|web_search`、`contextWindow?`、`maxOutput?`
- `ProviderSettingsSchema`：`apiKey?`、`apiHost?`、`apiPath?`、`models?`、`excludedModels?`、
  `useProxy?`、`oauth?`、`activeAuthMode?`
- `CustomProviderBaseInfoSchema = BuiltinProviderBaseInfoSchema.extend({ id: string, isCustom: literal(true) })`，
  `BuiltinProviderBaseInfoSchema` 里 `name` 必填、`type` 默认为 `openai`
- 自定义判定：`isCustomProviderId(id) = id && !BUILTIN_PROVIDER_IDS.has(id)`——
  **任何不在内置枚举里的 id 都算自定义**。注意内置枚举里本身有个 `"custom"`，所以不能拿 `custom` 当 id。
- URL 拼接：`apiHost + apiPath`，`normalizeOpenAIApiHostAndPath()` 会去掉 apiHost 末尾斜杠、
  给 apiPath 补前导斜杠、把 scheme 转小写；**没有 scheme 时会强制补 `https://`**，
  所以本地地址必须写成完整的 `http://127.0.0.1:8799/v1`
- `useProxy: false`：不走 Chatbox 自己的中转，本地地址直连

### 实测（按 Chatbox 的请求形状）

[test-chatbox-shape.mjs](test-chatbox-shape.mjs) 用带 system 提示、`stream:true`、
`temperature/top_p/max_tokens`、`Authorization: Bearer <占位串>` 的 body 打了一次：

```
HTTP 200 text/event-stream
响应头耗时 11484 ms | 总耗时 20080 ms | chunk 209 | reasoning 647 字
content: 快速排序是一种分治排序算法……
```

注意那个 **11.5 秒**：校园接口是"先在服务端算好一大段再吐"，不是逐字流式，
所以 Chatbox 里体感是**先卡十秒左右、然后内容较快地出来**，不是逐字蹦。

### 备份与回滚

改动前的原文件备份在
`%APPDATA%\xyz.chatboxapp.app\config.json.bak-before-wust-school`。
如果 Chatbox 不认这份配置（表现为模型列表里没有"武科大 DeepSeek-R1"），
把备份复制回 `config.json` 即可回到原状。

## 模型溯源（谁才是后端模型）

**不要用"模型自述"来判断后端模型**——它被包在学校的机器人系统提示里，说自己是谁基本由系统提示和开场白决定。

可靠做法是查服务端配置。同一个 `accessLayerId` 配你的 token 调：

```
POST /ly-ai/application/api/mRobot/baseInfo/helloMsg
Header: aiAccessToken: <你的 token>   userAuthType: AI
Body:   {"accessLayerId":"1001740878824427000660000000001"}
```

返回里的关键字段：

```json
{
  "robotName": "武科大校园助手",
  "robotId": "o81562",
  "isEnableLargeModel": "1",
  "modelType": ["LianYi"],
  "modelName": "DeepSeek-R1",
  "tenantId": "wust",
  "userInfo": { "helloMsg": "#username#老师你好，我是Deepseek武科大专属版，很高兴见到你！" }
}
```

**结论：服务端声明后端是 DeepSeek-R1。** 佐证：

- 推理流里 `reasoningContent` 字面以 `<think>` 开头，且全程不出现 `</think>`——后端显然按结尾标记把推理与正文切开，只把 `<think>` 留在了推理段里
- 界面代码里对非 `sysu` 租户硬编码显示 "DeepSeek" 品牌字样
- 对 `wust` 租户，前端特意不显示 `modelName`，改显示"内容由AI生成，不作为学校权威解释"

**无法验证的部分**：这是服务商的配置声明，不是对权重做指纹识别。要独立证明实际推理的是 R1 原始权重，需要对比 tokenizer 行为、输出分布这类手段，超出本次范围。

## 实测结果（2026-10-10，token 有效时）

- 非流式 `/v1/chat/completions`：HTTP 200，`reasoning_content`（思维链）+ `content` 均正常返回，`session_id` 正常回传
- 流式 `stream:true`：HTTP 200，`text/event-stream`，chunk 数 3～58 不等，拼接结果正确
- 单次响应耗时 **10～18 秒**（推理模型 + 智能体编排，比直连 API 慢很多）
- 流式稳定性：5/5、3/3 连续成功；但**出现过一次偶发 500「系统错误」**，已在桥接里加「首包前最多重试 3 次、指数退避」
- 多轮：原生 `session_id` 复用返回同一 ID，但模型答不出上一轮的「42」（无记忆）；把 system + 历史 user/assistant 一起放进 `messages` 后正确答出 `42`
- `631 用户未登录`：token 过期时出现，需重新获取 token 覆盖 `token.txt`（代理热加载，不用重启）

## 辅助脚本

| 脚本 | 用途 |
| --- | --- |
| `smoke-test.mjs "问题"` | 一次跑通非流式 + 流式，验证链路 |
| `probe-stream.mjs [次数]` | 连续流式请求，报告写入 `probe-report.md` |
| `probe-session.mjs` | 验证上游 `session_id` 是否保留上下文 → `session-report.md` |
| `probe-history.mjs` | 验证历史拼接能否维持多轮 → `history-report.md` |
| `probe-model.mjs` | 摊开 SSE 全部字段找模型标识（结论：SSE 里没有） → `model-report.md` |
| `probe-robot.mjs` | 查服务端机器人配置里的 `modelName`（**模型溯源的物证来源**） → `robot-report.md` |



## 上游接口画像（从 SPA bundle 逆向）

- 应用入口：`/ai/autoHelpDesk/`（Vue 2 SPA，webpack）
- 接口前缀：`/ly-ai/...`，网关会剥掉 `/ly-ai/application`
- 核心对话：`POST /ly-ai/application/api/aialogue/say/{accessLayerId}`，**SSE 流式**
  - 请求体：`{message, messageType, questionId, sessionId, hiAgentType, network}`
  - 响应：每行 `data: {...}`，字段含 `data`(增量文本) / `reasoningContent` / `resultType` / `replySource` / `sessionId`
- 鉴权：请求头 `aiAccessToken`、`userAuthType: AI`
- 部分接口（`chunk-c` 里的 axios 实例）还有 AES 请求体加密 + 响应解密，但 **say 走 fetch-event-source，未加密**，所以反代最好做的正是对话链路
- 另有 `/ly-ai/application/open/openclaw/responses`（Lobster 智能体，Responses API 风格事件），在 `/open/` 下，鉴权可能更松

## 用法

```powershell
# 只做透明反代（不注入任何凭证，浏览器里正常 SSO 登录）
node proxy.mjs

# 再把 token 写进同目录 token.txt（推荐，热加载、不进命令行历史）
node proxy.mjs

# 或用环境变量
$env:TOKEN="你的aiAccessToken"; node proxy.mjs
```

打开：`http://127.0.0.1:8799/ai/autoHelpDesk/?accessLayerId=1001740878824427000660000000001&ssoAuth=1`

> `token.txt` 已在 `.gitignore` 里。文件支持 `#` 注释，解析器取第一个非空非注释行。

OpenAI 兼容口：

```powershell
curl.exe -sS -X POST http://127.0.0.1:8799/v1/chat/completions `
  -H "Content-Type: application/json" `
  -d '{\"model\":\"school-deepseek\",\"messages\":[{\"role\":\"user\",\"content\":\"你好\"}],\"stream\":false}'
```

## 怎么拿 aiAccessToken

1. 浏览器正常登录学校 AI 帮助台（真站点，不是本地代理）
2. F12 → Console 执行：`copy(sessionStorage.getItem("aiAccessToken"))`
   （或 Application → Session Storage / Cookies 里找 `aiAccessToken`）
3. 把值交给代理的 `TOKEN` 环境变量

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `8799` | 本地监听端口 |
| `BIND` | `127.0.0.1` | **默认仅本机可访问**，公开暴露等于把校园凭证共享出去 |
| `TOKEN` | 空 | 你的 `aiAccessToken` |
| `ACCESS_LAYER_ID` | `1001740878824427000660000000001` | 租户/接入层 ID |
| `REWRITE_SSO` | `1` | 把 CAS `service=` 回跳改写到本代理源 |
| `UPSTREAM` | `https://aiservice.ly-sky.com` | 上游 |
| `DEBUG` | `0` | 打印每条请求 |

## 两个已知不确定点

1. **CAS 白名单**：把 `service=` 改成 `http://127.0.0.1:8799/...` 后，学校 CAS 是否接受该回调地址未知。若不接受，就退回「在真站点登录 → 手动复制 token」。
2. **token 有效期**：SPA 里有 `ssoTokenExpired` 重定向逻辑，说明会过期；过期后需重新取 token。

## 合规提醒

这是拿你自己的校园账号做本地自动化，凭证只留在本机。别把 `TOKEN` 写进仓库、别把监听地址改成 `0.0.0.0` 分享给别人——
那属于外泄校园身份凭证 + 二次分发学校采购的第三方服务，可能违反学校的信息系统使用规定。
