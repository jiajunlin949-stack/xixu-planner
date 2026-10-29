# 汐序 · Xixu Planner

[![Public regression](https://github.com/jiajunlin949-stack/xixu-planner/actions/workflows/ci.yml/badge.svg)](https://github.com/jiajunlin949-stack/xixu-planner/actions/workflows/ci.yml)

面向 HarmonyOS 的校园日程与个人知识整理应用：把课表、待办、备忘录和对话式助手放在同一个工作空间。

**阶段：早期内测。** 当前公开的是经过隐私清理的开发快照，不是已验证适配所有手机的正式发行版。首次公开提交不包含原私有开发历史、个人课表、备忘录或签名材料。

完整的功能验收、手机/电脑知识库边界和分阶段交付标准见 [需求验收与下一版计划](docs/PROJECT_STATUS_AND_PLAN.md)。未实现的适配、真实设备测试和路线图不会标为已交付。

## 功能

- 今天视图、月历、每周课表、个人计划与到期事项。
- Excel / PDF 课表导入、导入前核对与确认；原生 OCR 路径需要 HarmonyOS 环境。
- 自然语言安排和调课：支持本地规则处理部分指令，写入前预览确认。
- 多会话助手、独立会话草稿、历史切换与来源引用。
- 本地混合检索：关键词、BM25 风格评分、词汇特征哈希重排与上下文预算。
- 备忘录、碎片记录、编辑时间，以及保留原件的华为 HTML 图文导入入口。
- 蓝紫珠光主题、液态玻璃导航、减少动态效果与透明度降级。

## 先了解这些限制

- **华为 `.hdoc` 正文与图片解码尚未实现。** 能识别格式并给出诊断，不等于能迁移内容；不能承诺 74 条真实备忘录已全量无损迁移。
- HTML 图文原件独立保存。JSON 备份不包含这些外部原件；请另外保留全部源 HTML，不能仅导出 JSON 后卸载应用。
- 当前本地检索不是真正的学习型 Embedding，也未使用 Chroma、LangChain 或 LlamaIndex。详见 [检索架构](xixu-harmony/RAG_ARCHITECTURE.md)。
- 联网模型需用户自行配置。原生请求不是 SSE 流式输出；离线规则回复不代表已连接大模型。
- 可选知识服务只包含客户端桥接；这个仓库不包含配套服务端，不保证脱离服务端即可使用远程知识功能。
- 浏览器回归和桥接模拟不等于真机测试。HarmonyOS 7 的文件选择、帧率和原生能力仍需设备验证。

## 本地预览与测试

建议使用 Node.js 22、Windows PowerShell 和 Chromium / Edge。

```powershell
npm install
npx playwright install chromium
node work/prepare-native.cjs
node work/serve-native-preview.cjs
```

打开 `http://127.0.0.1:8767/`。仅监听本机，不向局域网公开个人资料。浏览器预览不能替代 HarmonyOS 原生文件、提醒或密钥存储能力。

```powershell
npm run ci
```

公开 CI 运行 41 个独立回归脚本和资源/合成 PDF 生成步骤，不需要个人文件或模型密钥。三项依赖私人课表或早期含预置数据原型的历史测试没有公开，也不计入公开 CI 通过数。测试生成的图片、日志和备份仅用于隔离测试，不应当作为用户数据迁移证据。

## 原生开发

在 DevEco Studio 中打开 `xixu-harmony`。源码使用 API 26 工具链、兼容 API 12；请安装相应 HarmonyOS SDK。仓库的构建配置不含签名；运行或上架前需使用**自己的**包名、设备配置和签名材料，不能使用原应用的身份。

Windows 脚本可通过环境变量指定安装位置：

```powershell
$env:XIXU_DEVECO_HOME = 'C:/Program Files/Huawei/DevEco Studio'
node xixu-harmony/build-release.cjs
```

`npm run ci:full` 需要原生工具链。公开 GitHub 工作流只运行无签名网页回归，不连接个人自托管执行器或发布应用。

## 目录

```text
xixu-harmony/web/                 模块化网页界面、交互、检索与本地逻辑
xixu-harmony/entry/src/main/ets/  ArkTS 外壳、原生桥接和桌面卡片
work/prepare-native.cjs          由模块生成离线资源
work/check-*.cjs                 公开回归脚本
ci/                             测试与可选本地构建验证
```

## 许可与来源

项目自有源码以 **GPL-3.0-only** 发布，版权声明见 [COPYRIGHT](COPYRIGHT)，完整条款见 [LICENSE](LICENSE)。这允许按许可证使用、修改和商用；分发受覆盖的衍生版本时需履行相应源码及许可义务。

Hyalite 液态玻璃、PDF.js、SheetJS、Lucide、Nunito 等第三方组件保留各自许可证，不应改称为本项目原创。详见 [第三方声明](THIRD_PARTY_NOTICES.md)。许可证不授予冒充官方汐序应用或维护者的权利，也不授予项目名称、图标的商标使用许可。

欢迎提交可复现的问题与改进；请勿在公开 Issue、PR 或截图中上传私人笔记、课表、密钥或签名文件。参见 [贡献说明](CONTRIBUTING.md) 和 [安全说明](SECURITY.md)。
