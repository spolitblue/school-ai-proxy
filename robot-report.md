# 机器人配置探针报告（模型溯源的物证）

- 时间: 2026-10-10T14:57:36.502Z
- 上游: https://aiservice.ly-sky.com
- accessLayerId: 1001740878824427000660000000001

## robot baseInfo（按 id 取机器人配置）

- URL: `POST /ly-ai/application/api/mRobot/baseInfo/1001740878824427000660000000001`
- HTTP: 200

（无 model 相关字段）

<details><summary>原始响应（截断 2000 字）</summary>

```json
{"code":200,"message":"ok","data":0}
```
</details>

## helloMsg

- URL: `POST /ly-ai/application/api/mRobot/baseInfo/helloMsg`
- HTTP: 200

### 含 model / 机器人标识的字段

- `data.robotName` = "武科大校园助手"
- `data.isEnableLargeModel` = "1"
- `data.modelType` = ["LianYi"]
- `data.modelName` = "DeepSeek-R1"
- `data.permissionList.0.tenantId` = "wust"
- `data.permissionList.1.tenantId` = "wust"
- `data.permissionList.2.tenantId` = "wust"
- `data.permissionList.3.tenantId` = "wust"
- `data.permissionList.4.tenantId` = "wust"

<details><summary>原始响应（截断 2000 字）</summary>

```json
{"code":200,"message":"ok","data":{"userInfo":{"userName":"刘泽弈","helloMsg":"#username#老师你好，我是Deepseek武科大专属版，很高兴见到你！","englishHelloMsg":"","suggestedQuestions":null},"toWebConsole":null,"robotAvatar":"","robotId":"o81562","robotName":"武科大校园助手","successCardList":[],"smallCardList":[],"quickPhrasesVoList":[],"userType":"2","isEnableLargeModel":"1","modelType":["LianYi"],"modelName":"DeepSeek-R1","todoData":null,"commonIsOpen":false,"translateIsOpen":false,"enableEnglish":false,"warnData":null,"scheduleData":null,"suggestedQuestionVos":null,"filePreviewIsOpen":"1","todoMoreIsOpen":null,"scheduleMoreIsOpen":null,"permissionList":[{"id":null,"robotId":"o81562","tenantId":"wust","cardType":"guess_question","cardTypeName":"猜你想问","showStatus":1,"sort":1,"createTime":null,"updateTime":null},{"id":null,"robotId":"o81562","tenantId":"wust","cardType":"hot_question","cardTypeName":"热门问题","showStatus":1,"sort":2,"createTime":null,"updateTime":null},{"id":null,"robotId":"o81562","tenantId":"wust","cardType":"tips","cardTypeName":"AI秘籍","showStatus":1,"sort":3,"createTime":null,"updateTime":null},{"id":null,"robotId":"o81562","tenantId":"wust","cardType":"quick_service","cardTypeName":"快捷服务","showStatus":1,"sort":4,"createTime":null,"updateTime":null},{"id":null,"robotId":"o81562","tenantId":"wust","cardType":"is_enter_dialogue","cardTypeName":"是否进入对话页","showStatus":1,"sort":5,"createTime":null,"updateTime":null}],"questionCount":null,"subRobotListOld":null,"documentList":null,"subRobotList":null,"completedTaskVoPageListVo":null}}
```
</details>

## getEnableClassifyList

- URL: `POST /ly-ai/application/api/mRobot/baseInfo/getEnableClassifyList`
- HTTP: 200

（无 model 相关字段）

<details><summary>原始响应（截断 2000 字）</summary>

```json
{"code":200,"message":"ok","data":[{"classifyId":"1001741082769925000660000000001","classifyName":"图书馆"}]}
```
</details>
