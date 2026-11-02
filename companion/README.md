# 汐序个人知识库服务

与手机协同的可选电脑服务：将主动导入的笔记与聊天资料保存在本机，通过带来源的检索、分块同步和核对后的模型请求连接到汐序。

**SQLite 权威正文 · SHA-256 原件 · FTS5 / RRF · 可选 Chroma / Milvus · 多模型协议 · HTTPS 配对**

## 使用方式

| 方式 | 配置 | 能力 |
| --- | --- | --- |
| 手机本机 | 直接使用 App | 课程、日程、备忘录、碎片记录、本机规则与词汇检索 |
| 电脑文字检索 | 默认启动本服务 | SQLite/FTS5、手动导入、来源和版本查询 |
| 电脑语义扩展 | 选择 Chroma 或 Milvus 并启用语义检索 | 本地 Embedding、RRF、精排与更多资料检索 |

SQLite 保存权威正文与来源，独立目录保存原件；向量库保存可重建的检索投影。手机与电脑分别管理模型连接，检索资料进入模型前提供逐段核对。

## 启动

使用 Python 3.12，在 `companion/` 中执行：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m xixu_hub serve --open
```

管理页监听 `127.0.0.1:8765`。`--open` 使用 URL fragment 传递本机管理凭据，界面读取后移除地址栏中的凭据；也可在本机读取 `data/access.token` 填入管理页。

需要连接手机时：

```powershell
.\.venv\Scripts\python.exe -m xixu_hub serve --lan --open
```

电脑管理仍使用8765端口，手机配对使用独立 HTTPS 8766端口。在管理页生成五分钟有效的配对信息，选择可互通的电脑地址，填入手机“设置 → 电脑扩展”。配对证书由应用管理；一次性配对码、尝试计数和设备创建通过同一 SQLite 写事务保护。

## 手动导入聊天资料

管理页的流程为 **选择平台与文件 → 核对条数、发言者与原始时间 → 确认导入**。

- QQ：标准 TXT，以及约定的 JSON/CSV 消息结构。
- 钉钉：约定 JSON/CSV，兼容 `msgId`、`text.content`、`senderId`、`conversationId` 等事件字段。
- 微信：约定 JSON/CSV，采用同一来源与版本结构。

字段示例：

```json
{
  "messages": [{
    "id": "synthetic-message-1",
    "text": "11月5日前提交开题报告",
    "sender_id": "synthetic-speaker",
    "sender_name": "示例发言者",
    "conversation_id": "synthetic-group",
    "conversation_name": "示例讨论组",
    "timestamp": "2026-10-29T09:00:00+08:00"
  }]
}
```

消息身份包含平台、账号、会话与消息标识；来源保存发言者、原始时间、导入时间和文件 SHA-256。相关解析契约见 [chat_exports.py](xixu_hub/chat_exports.py)。

命令行支持同样的预览与确认流程：

```powershell
.\.venv\Scripts\python.exe -m xixu_hub import-chat --platform qq --file "D:\ChatExports\演示.json"
.\.venv\Scripts\python.exe -m xixu_hub import-chat --platform qq --file "D:\ChatExports\演示.json" --confirm
```

## 手机备忘录同步

在手机选择“电脑扩展 → 同步备忘录与原件”。同步以批次方式核对版本，正文、图片、来源时间与独立原件分块传输；哈希校验完成后提交 SQLite 快照。同一批次可核对回执，冲突时保留当前权威资料。

## 可选语义检索

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-vectors.txt
.\.venv\Scripts\python.exe -m xixu_hub serve --mode notes --backend chroma --semantic --open
```

Chroma 使用本机持久化目录；Milvus 通过 `XIXU_MILVUS_URI` 配置服务地址，默认 `http://127.0.0.1:19530`。两种后端采用共用向量契约，索引状态按后端隔离，命中后核对 SQLite 当前文档版本。

可选 CrossEncoder 使用 `requirements-rerank.txt` 安装依赖，并由 `XIXU_RERANKER_PATH` 指向已有本地模型。候选按 **RRF Top20 → 本地精排 → 来源去重与上下文预算 → Top5** 处理。

## 模型、隐私与公开搜索

管理页配置供应商、HTTPS 地址、模型、协议及能力项。支持 Chat Completions、Responses、Claude Messages，流式结果统一为正文增量和完成事件。

电脑检索先返回来源与发送预览，用户可编辑问题、修改或移除片段。单次审批票据绑定设备、模型配置与来源版本。隐藏词表在本机维护，模型和搜索服务密钥通过本机安全存储管理。

公开网页搜索使用独立 Brave Search 配置，核对搜索词后调用并返回摘要来源。搜索词与个人知识库片段分别处理。

## 资料备份

```powershell
.\.venv\Scripts\python.exe -m xixu_hub backup --output "D:\Backups\xixu-personal-knowledge.zip"
```

备份携带电脑知识库的 SQLite 读快照、来源元数据、笔记结构与被引用原件。原件逐项核对后发布 ZIP。`data/originals/` 保存实际资料，建议连同备份一起妥善保存。手机完整业务备份由 App 内“完整备份”入口管理。

## 开发验证

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest tests -q -ra
```

测试覆盖解析身份、原件、事务回滚、同步与来源版本、并发配对，以及三类模型协议。数据与结果见 [工程验证](../docs/VALIDATION_STATUS.md)，整体任务链见 [Agent 架构](../docs/SUPER_AGENT_ADAPTATION.md)。
