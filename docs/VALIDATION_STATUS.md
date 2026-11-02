# 工程验证与复现

更新：2026-11-02。验证使用隔离目录、合成资料及显式测试接口，结果随提交和运行环境记录。

## 已验证的工程能力

| 检查 | 实际结果 | 覆盖内容 |
| --- | --- | --- |
| 公开网页回归 | 45项通过、0失败 | 资源生成、导入、会话隔离、日程确认与撤回、来源检索、响应式界面和大数据重开 |
| 电脑端本地测试 | 35项通过 | 聊天解析、原件字节、事务回滚、配对并发、同步冲突、模型协议与流式结束状态 |
| Agent 与归档契约 | 4组通过 | 任务引擎、消息归属、上下文回查、SHA/CRC 和 ZIP64 元数据 |
| 合成意图分类 | 50/50 | 本机路由标签 |
| 合成检索 | Recall@5 = 1.000；MRR = 0.9611 | 20份合成资料、30个问题；词汇检索、RRF 与轻量精排 |
| 来源版本与片段一致性 | 1.000 | 上述检索用例中返回片段与当前权威正文的一致性 |

45项网页回归的已完成运行：[9d5795f 对应的 GitHub Actions](https://github.com/jiajunlin949-stack/xixu-planner/actions/runs/41328004391)。最新提交由[持续集成](https://github.com/jiajunlin949-stack/xixu-planner/actions/workflows/ci.yml)分别执行网页与电脑端检查。

电脑端本地35项包含 Chroma 持久化用例；基础依赖环境会按可选组件是否安装选择该用例。检索指标对应上述合成数据和算法配置，衡量召回排序与来源一致性。

## 网页与 Agent

```powershell
npm ci
npx playwright install chromium
npm run ci
node work/verify-agent-engine.cjs --run
node work/verify-agent-ui-state.cjs --run
node work/verify-conversation-context.cjs --run
node work/verify-archive-streaming.cjs
```

网页回归输出 `outputs/ci/summary.json` 及逐项日志。Agent/归档契约与合成评测在 CI 中有独立步骤，结果写入对应运行日志。

## 电脑端

在 `companion/` 中执行：

```powershell
python -m pip install -r requirements-dev.txt
python -m pytest tests -q -ra
```

CI 在 Python 3.12 基础依赖环境执行接口与存储测试；可选向量组件通过专用适配契约核对。

## 合成评测

```powershell
node evaluation/evaluate-routing.cjs --run
python evaluation/evaluate_retrieval.py --run
```

数据集、指标定义和运行方法见 [评测说明](../evaluation/README.md)。HarmonyOS 的构建、签名和设备验证使用[原生构建流程](NATIVE_BUILD.md)，与网页、接口和合成检索结果分别记录。
