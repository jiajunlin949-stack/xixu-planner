# 离线评测资产（未运行）

按当前用户要求，本轮只编写源码、合成数据与说明，**没有执行以下脚本，没有实际成绩**。构建与 CI 不会自动调用它们。不能把这份数据集称为已经通过的 50/30 项测试。

- `routing-cases.json`：50 条意图用例；直接使用 App 的 `routing-policy.js`。只测意图标签，不测时间槽位、多轮状态机、写入正确性、隐私门或模型。
- `retrieval-fixture.json`：20 份无个人数据的合成记录、30 个查询，有相近通知、旧/新日期与文档说明。脚本仅在临时 SQLite 中测当前词汇召回、RRF 和轻量精排；不启动 Chroma/Milvus，不加载 Embedding。
- `evaluate-routing.cjs`：输出意图准确率与逐条期望/实际标签。
- `evaluate_retrieval.py`：输出 Recall@5、MRR、当前源版本与片段范围一致率；后者**不是回答引用语义正确率**。没有模型回答，所以回答引用正确率明确为 `null`。

用户以后决定运行时，在仓库根目录显式执行：

```text
node evaluation/evaluate-routing.cjs --run
python evaluation/evaluate_retrieval.py --run
```

结果需连同提交 SHA、环境、数据集版本、日期一起记录。不得在 README 填预期数字冒充实测。下一轮质量验证应另加无日期/多事项/来源被改/取消流/损坏备份/并发修改等端到端情境，以及单独标注的真实设备与语义检索评测；现有合成数据不能代表它们。
