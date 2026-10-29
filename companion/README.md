# 汐序个人知识库配套服务

此组件只为个人使用，不包含账号、聊天记录、笔记原件、模型密钥或手机签名材料。它是与手机 App 分离的可选电脑服务；不影响手机独立记录和本机检索。

本次按用户要求只继续完善代码，停止运行与测试。下列是代码提供的接口与操作说明，**不是全部已经过真机、真实账号或 Docker 联调的声明**。

## 两种个人使用方式

1. **手机本机模式**：在汐序中记录、导入备忘录、查看图片及检索本机资料。电脑关机也可使用。当前手机使用本机混合检索，并未内嵌 Python Chroma；有 API Key 时仍可按用户设置使用手机模型。
2. **电脑扩展模式**：手机配对个人电脑，确认后同步备忘录及原件，再结合电脑导入的 QQ、钉钉等资料检索。电脑可选 Milvus；Chroma 是电脑侧的可选轻量索引，不能称为鸿蒙手机本地 Chroma。

数据库与资料来源是独立选择。SQLite 保存权威正文、版本和来源时间；独立原件目录保存哈希校验后的文件。Milvus/Chroma 是可重新建立的检索索引，不替代原始资料。

## 启动说明（本轮未代用户执行）

使用 Python 3.12，在 `companion/` 中：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m xixu_hub serve --open
```

默认管理页仅监听 `127.0.0.1:8765`，不需要 Docker 或模型密钥；此时可确认导入和文字检索。`--open` 在本机打开管理页，管理凭据只置于 URL fragment，并立即从地址栏移除；界面内不持久保存。也可从本机 `data/access.token` 读取管理密钥填入管理页，勿发到聊天或仓库。

需要手机连接时加 `--lan`。HTTPS 端口固定为 8766，与原生桥接匹配；电脑本地管理端口仍为 8765。管理页生成五分钟配对信息，选可互通的电脑地址，粘贴到手机“设置 → 电脑扩展”。程序生成的 CA 只用于该 App 的配对，不安装系统根证书、不修改防火墙。

```powershell
.\.venv\Scripts\python.exe -m xixu_hub serve --lan --open
```

已有其他服务占用这些端口时先确认归属。本组件不自动停止其他程序、不读取旧私人知识库目录。两个进程不要同时写同一个 Chroma 本地目录。

## QQ 与钉钉接入范围

- 管理页：选择平台和文件 → 核对总条数、发言者、原始发送时间、附件缺失提示 → 确认导入。
- QQ：标准文本聊天导出 TXT，以及本项目约定的 JSON/CSV 消息结构。
- 钉钉：显式导出的 JSON/CSV，以及包含 `msgId/text.content/senderStaffId/senderNick/conversationId/createTime` 的消息记录。
- 可在管理页明确授权一个**专用导出文件夹**。服务每 30 秒读取其中新增/更新的支持文件；不递归扫描其他文件夹。文件删除、目录断开、解析失败均不删除之前导入的消息；停用目录保留已有记录。
- 这些是**文件接入与导出目录增量导入**，不等于登录账号、解密本地数据库、自动抓取全部历史或自动取得未导出的附件。官方机器人事件文件也只代表收到的事件，不等于个人账号的全部记录。
- 图片/语音/文件占位符与外部链接会保留在原始导出中，并明确标识为引用，**不会谎称已经导入媒体字节**。本组件不自动下载未知媒体链接。

跨平台统一 JSON 示例，全部为合成资料：

```json
{
  "conversation_id": "synthetic-group",
  "conversation_name": "演示小组",
  "account_id": "synthetic-account",
  "messages": [
    {
      "id": "synthetic-message-1",
      "sender_id": "synthetic-speaker",
      "sender_name": "演示同学",
      "timestamp": "2026-10-29T09:00:00+08:00",
      "text": "下周展示前整理图表。"
    }
  ]
}
```

CSV 可使用 `message_id,sender_id,sender_name,conversation_id,conversation_name,sent_at,text` 列，或代码列出的中文列别名。正文含换行/逗号时须正确引用。缺失的时间或发言者保持未知，不补造；未知格式或同一消息 ID 冲突时整批停止，不静默拼接。

每个文件最多 20 MiB、20000 条消息、总文字 400 万字符，单条最多 50000 字符；超限明确拒绝，不截断。确认前只保留暂存原件，不写入知识记录。来源包含平台、账号、会话、发言者、消息 ID、原始时间、文件 SHA-256；导入时间单独记录。

命令行也支持只预览/确认，默认不导入：

```powershell
.\.venv\Scripts\python.exe -m xixu_hub import-chat --platform qq --file "D:\ChatExports\演示.json"
.\.venv\Scripts\python.exe -m xixu_hub import-chat --platform qq --file "D:\ChatExports\演示.json" --confirm
```

平台参考：[腾讯 QQ 机器人文档](https://github.com/tencent-connect/bot-docs)、[钉钉开放平台](https://open.dingtalk.com/)。本项目 JSON/CSV 适配契约不代表所有 QQ/钉钉客户端都内置该格式导出功能；实际样本仍须核对。

## 手机备忘录同步

手机选择“电脑扩展 → 同步备忘录与原件”，先读取电脑状态，再确认。同步正文、真实提供的创建/编辑时间、独立导入时间、图片和导入原件。手机笔记和原件不会因为同步而删除。

长笔记先转 UTF-8 再分块，避免把 emoji/中文边界切坏；原件按 SHA-256 分块上传。全部块和引用原件核对后，正文、全文索引与快照版本在一个 SQLite 事务中提交。确认前不半写；重试同一提交保持幂等，过期版本冲突需重新核对。删除传播默认关闭，勾选后只作用于当前设备的已同步笔记，不删除其他设备或聊天资料。

上限：每次最多 5000 条笔记、单条序列化元数据 2 MiB、单个原件 20 MiB、一次同步暂存总量 1 GiB。缺原件或容量不足时停止，不宣称完成。原生桥接需更新后的 App 包；旧手机安装包不会因为修改 GitHub 源码自动升级。

## 向量检索

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-vectors.txt
docker compose up -d
.\.venv\Scripts\python.exe -m xixu_hub serve --backend milvus --semantic --lan --open
```

仓库的 Compose 使用独立命名卷，Milvus 端口仅绑定电脑本机。**本轮未启动或验证该 Docker 配置**。已有 Milvus 时可设置进程级 `XIXU_MILVUS_URI` 指向它，不必重复启动。

不使用 Docker 时，电脑端可选：

```powershell
.\.venv\Scripts\python.exe -m xixu_hub serve --backend chroma --semantic --lan --open
```

语义模型为本地 `BAAI/bge-small-zh-v1.5`、512 维；首次可能下载模型。语义索引失败时仍保留权威记录并返回文字检索提示，不冒充向量检索成功。两库使用同一适配契约；索引状态按后端隔离，切换后端不会复用“已索引”标记。命中向量 ID 后重新核对 SQLite 当前版本，避免旧向量带回已修改/删除原文。

Chroma 适配参考：[客户端](https://docs.trychroma.com/reference/python)、[集合 API](https://docs.trychroma.com/reference/python/collection)。手机独立模式不依赖此 Python 服务。

## 原件备份

```powershell
.\.venv\Scripts\python.exe -m xixu_hub backup --output "D:\Backups\xixu-personal-knowledge.zip"
```

备份包含 SQLite 读快照中的权威文档、来源元数据、笔记完整结构以及被引用的原文件/图片。逐一校验原件后发布 ZIP，已有目标文件拒绝覆盖。它不包含模型密钥、设备访问令牌、私有签名或待确认暂存。**这是电脑知识库资料备份，不是手机全部课表/日程数据的完整替代，也尚无手机一键回迁界面。**

保留 `data/`。其中的 `originals/` 是原件，不是可随意清理的模型缓存。手机已有的 JSON 索引备份仍不包含独立原件。

## 运行验证边界

本次前半程做过合成资料的局部检查；用户随后要求停止运行/测试。后续接口、目录导入、错误显示和文档等变更没有重新完整运行。没有真实 QQ/钉钉账号接入、没有真实聊天资料迁移、没有 Milvus Docker 联调、没有鸿蒙新包真机验收。项目状态文档和本节优先于旧版本 CI 成功记录。
