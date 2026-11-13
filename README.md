# Tracegarden

面向个人开发者和小型 AI 团队的多模型 Agent 调试与评测工作台。当前为单人本地 MVP，适合搭建作品集、验证评测流程、接入 claudeapi / code0 或官方模型连接。

## 启动

需要 Node.js 24+。无需安装依赖、配置数据库或提供 API Key，即可体验演示。

```powershell
cd "C:\Users\Administrator\Documents\ChatGPT\个人网页\agent-lab"
npm start
```

打开 http://127.0.0.1:4318 。`npm run dev` 可在修改后自动重启服务。设置 `PORT` 可更换端口；`TRACEGARDEN_DATA_DIR` 可指定数据目录。

## 第一次体验

1. 保持默认 3 个 Demo 模型，点击「运行演示评测」。
2. 3 条用例 × 3 个模拟连接，共 9 项任务。预设 7 项通过、2 项未通过，用于演示 JSON 格式与工具未执行这两种失败。
3. 点击结果右侧 Trace 查看 Prompt、工具参数、工具结果、模型响应和规则判定。
4. 添加人工评分与评审备注，导出完整 JSON 报告。
5. 编辑测试集后重新运行，历史运行保留原用例与模型配置快照。

所有 Demo 响应、Token 数都是本地模拟，不能用于判断真实模型效果、速度、价格或来源。修改 Demo 用例后，输出仍然由固定示例生成，规则会按修改后的条件重新判定。

## 真实模型接入

在「模型连接」新建连接，填写渠道实际提供的模型 ID 和协议根地址：

| 协议 | Base URL 示例 | 后端追加的请求路径 |
| --- | --- | --- |
| OpenAI Chat Completions | `https://api.openai.com/v1` | `/chat/completions` |
| Anthropic Messages | `https://api.anthropic.com/v1` | `/messages` |
| Gemini generateContent | `https://generativelanguage.googleapis.com/v1beta` | `/models/{modelId}:generateContent` |

claudeapi、code0 使用平台提供的对应协议地址与模型 ID，不要直接照搬上述官方地址。首版 OpenAI 适配层使用 `max_completion_tokens`；选择兼容此字段和 Tool Use 的模型。

取消选中全部 Demo 连接，再选择真实模型。演示与真实连接不能在同一轮混跑。保存连接不会请求上游；点击 `Test connection` 会发送一条最小请求，验证 Key、Base URL、模型 ID 和当前 Tool Use 请求结构。真实运行会调用模型并产生 API 费用。每项最多 5 轮模型调用、单轮最多 8 次工具调用，并发数为 3，单请求超时为 45 秒。平台不做通用自动重试；仅当 OpenAI-compatible 网关明确返回 Function tools 与默认 `reasoning_effort` 冲突时，使用 `reasoning_effort: none` 兼容重试一次。

单价为手动配置的 **USD / 1M Tokens**。留空代表未知。平台显示简单输入/输出估算，不进行 code0 RMB 额度换算，不代表渠道账单。遇到 cache / thinking 等特殊用量时不估算价格。错误任务的计费可能不完整，显示未知；取消也无法撤回上游已产生的费用。

## 当前能力与边界

- 独立项目、测试用例增删改、模型连接增删改与连接可用性检测。
- 每次运行可选择 Dataset 子集，避免为了验证单个场景重复跑完整测试集。
- 三协议多轮 Tool Use、本地 `search_docs` / `calculate` 工具。
- `search_docs` 仅检索内置产品资料，不连接实际业务数据库或公网；`calculate` 仅接受两个数字与四则运算，不执行代码。
- 关键词 AND 规则、纯 JSON + 顶层必填字段、成功执行指定工具三类评测。
- JSON 规则不等于完整 JSON Schema 验证；Tool Use 规则不等于最终答案正确性验证。补充人工评分或更强规则后，才能作为业务验收标准。
- 运行进度、取消、服务重启中断恢复、历史快照、Trace、人工评分、JSON 导出。
- 结果按通过、规则未通过、请求错误筛选，并对鉴权、限流、超时、协议参数和连接配置错误做基础归因。
- 历史页展示通过率、请求错误、平均耗时；相同模型和用例组合会与更早的有效运行比较通过率与耗时。
- 暂未支持登录与团队权限、流式响应、任意工具配置、LLM Judge、用户指定 Baseline、CI Regression Gate、Bedrock 原生 SigV4、OpenAI Responses、Token 首字延迟。
- 模型来源、降智、混合路由等需要专项审计，不能从这几条示例用例得出结论。

## 数据与 Key

数据默认存放于 `data/`，已加入 Git 忽略：

- `workspace.sqlite`：项目、用例、连接、运行快照、Trace、评分；含 Prompt 和模型输出。
- `vault.key`：本机加密主密钥。
- 数据库 secrets 表：AES-256-GCM 加密后的 API Key。

后端不向浏览器返回已保存的 Key，不写入 localStorage；localStorage 只记录当前项目 ID。主密钥与数据库位于同一台机器，加密不防范已获得本机文件权限的人。请勿提交、分享或上传整个 data 目录。备份需同时保留数据库和主密钥；服务停止后再复制，避免漏掉 SQLite WAL 数据。

服务仅监听 `127.0.0.1`，检查 Host、Origin、JSON 请求类型，页面有 CSP。当前没有多用户鉴权、密钥托管和外部端点出站隔离，**不要直接公开部署或通过反向代理暴露公网**。如需上线，先增加登录、租户隔离、服务端密钥管理、出站域名策略及持久任务队列。

导出文件不含 API Key，但包含 Prompt、工具参数、模型输出和模型连接地址；分享前按实际数据需要检查。

## 验证

```powershell
npm run check
npm test
```

自动测试覆盖三种协议的工具往返、Gemini thought signature 保留、Token 累计、规则判定、错误/超时/取消、Agent 轮数上限、连接检测、Dataset 子集、运行摘要、Key 存取、同源限制、配置校验、历史快照和重启恢复。协议测试使用模拟上游，不请求真实付费模型。

`scripts/verify-ui.mjs` 用于浏览器端的开发验证，需要 Playwright（当前父项目已安装）。默认创建临时数据库，在隔离端口验证界面与交互，并输出截图到已忽略的 test-artifacts 目录，不污染实际工作区。

## 项目结构

```text
server.mjs          本地 HTTP API、任务调度、配置校验
lib/store.mjs       SQLite 持久化、Key 加密
lib/engine.mjs      协议适配、Agent 循环、工具、评测与成本
public/             独立 Web 界面（HTML / CSS / JavaScript）
test/               后端自动测试
scripts/            浏览器交互验证
```

不依赖个人网站的 Astro 构建，不修改个人网站路由和数据。首版选择 Node 原生能力减少安装成本；进入团队版开发时，再根据用户验证结果引入前端框架、PostgreSQL 和任务队列。

OpenAI Tool Use 字段参考：[官方 Function calling 文档](https://developers.openai.com/api/docs/guides/function-calling)。
