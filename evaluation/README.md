# 可复现的合成评测

评测使用仓库内固定的合成数据，在临时数据库中运行，输出逐题结果与汇总指标。

| 评测 | 数据与配置 | 2026-11-02 运行结果 |
| --- | --- | --- |
| 意图路由 | 50条用例；应用同源的 `routing-policy.js` | 50/50 标签匹配 |
| 检索排序 | 20份资料、30个问题；词汇召回、RRF、轻量精排 | Recall@5 1.000；MRR 0.9611 |
| 来源一致性 | 按当前文档版本和片段范围核对每条命中 | 1.000 |

## 运行

在仓库根目录执行：

```powershell
node evaluation/evaluate-routing.cjs --run
python evaluation/evaluate_retrieval.py --run
```

意图结果衡量分类标签；检索结果衡量固定合成数据上的召回与排序。来源一致性校验片段字节与文档版本。模型回答的引用支持率使用独立字段，当前评测将其设为 `null`。

## 资料与输出

- `routing-cases.json`：包含明确安排、多轮续接、查询、取消与记录请求。
- `retrieval-fixture.json`：包含相近主题、旧/新通知与文档说明，并给出相关文档标识。
- `evaluate-routing.cjs`：输出逐条期望/实际标签及汇总匹配率。
- `evaluate_retrieval.py`：输出 Recall@5、MRR、来源版本与片段一致性。

路由评测、电脑检索评测与功能回归在持续集成中分别运行。环境和结果说明见 [工程验证](../docs/VALIDATION_STATUS.md)。
