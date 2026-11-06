# 模型溯源探针报告

- 时间: 2026-10-10T14:57:04.664Z
- 上游: https://aiservice.ly-sky.com
- 问题: 你好，请用一句话介绍你自己
- 事件总数: 118

## SSE 事件全部字段（含去重取值）

| 字段 | 出现取值（去重，最多 8 个） |
| --- | --- |
| `docNames` | `[array]` |
| `reasoningContent` | `` / `<think>` / `
` / `嗯，` / `用户让我` / `用一句话` / `介绍自己` / `。作为` |
| `replySource` | `DOC_QA` |
| `sessionId` | `46826c1a-541b-49a9-a152-ea653dfc477c` |
| `type` | `Running` / `End` |
| `data` | `你好` / `！我是` / `武汉科技大学` / `校园助手` / `，知识` / `丰富、` / `乐于助` / `人，` |
| `recordId` | `1001791644213157000040000000001` |

## 疑似模型标识字段

**SSE 事件里没有任何含 `model` 的字段。**

## 首尾事件原文（截断 1200 字）

```json
{
  "docNames": [],
  "reasoningContent": "",
  "replySource": "DOC_QA",
  "sessionId": "46826c1a-541b-49a9-a152-ea653dfc477c",
  "type": "Running"
}
```

```json
{
  "recordId": "1001791644213157000040000000001",
  "replySource": "DOC_QA",
  "sessionId": "46826c1a-541b-49a9-a152-ea653dfc477c",
  "type": "End"
}
```
