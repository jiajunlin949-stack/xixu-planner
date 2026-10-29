# 汐序 · Xixu Planner

[![Public regression](https://github.com/jiajunlin949-stack/xixu-planner/actions/workflows/ci.yml/badge.svg)](https://github.com/jiajunlin949-stack/xixu-planner/actions/workflows/ci.yml)

面向 HarmonyOS 的校园日程与个人知识整理应用：把课表、待办、备忘录和对话式助手放在同一个工作空间。

**阶段：早期内测。** 当前公开的是经过隐私清理的开发快照，不是已验证适配所有手机的正式发行版。首次公开提交不包含原私有开发历史、个人课表、备忘录或签名材料。

**稳定源码标签：`v0.8.11-source.1`；当前 main 为后续开发代码。** 新增双模式、文档原件导入与电脑配套服务；用户要求停止继续运行/测试，因此当前新增代码尚未完整回归，也未生成新手机发行包。参见 [版本记录](CHANGELOG.md)、[本次交付边界](companion/IMPLEMENTATION_STATUS.md) 和 [五分钟演示](docs/DEMO.md)。

手机本机模式的记录与本机检索**不依赖电脑、Docker 或 Milvus**。新增 [companion/](companion/README.md) 为可选个人电脑服务，提供聊天导出文件/目录接入、笔记与原件同步、Milvus/Chroma适配；不包含真实资料、私有数据库、账号凭据或原私人服务的完整历史代码。

完整的功能验收、手机/电脑知识库边界和分阶段交付标准见 [需求验收与下一版计划](docs/PROJECT_STATUS_AND_PLAN.md)。未实现的适配、真实设备测试和路线图不会标为已交付。

## 功能

- 今天视图、月历、每周课表、个人计划与到期事项。
- Excel / PDF 课表导入、导入前核对与确认；原生 OCR 路径需要 HarmonyOS 环境。
- 自然语言安排和调课：支持本地规则处理部分指令，写入前预览确认。
- 多会话助手、独立会话草稿、历史切换与来源引用。
- 本地混合检索：关键词、BM25 风格评分、词汇特征哈希重排与上下文预算。
- 备忘录、碎片记录与来源编辑时间；新增 TXT/Markdown/CSV/HTML/特定JSON/DOCX/PDF/PNG/JPEG/WebP 原件归档导入，另保留华为HTML专用入口。
- 手机本机/电脑扩展模式；确认后向个人电脑同步笔记、来源时间、图片及原文件。
- 电脑侧 QQ标准TXT、钉钉/QQ JSON/CSV 文件适配和明确授权导出目录的后台增量导入。
- 蓝紫珠光主题、液态玻璃导航、减少动态效果与透明度降级。

## 先了解这些限制

- **华为 `.hdoc` 正文与图片解码尚未实现。** 能识别格式并给出诊断，不等于能迁移内容；不能承诺实际备忘录已全量无损迁移。
- 文档原件独立保存。手机JSON备份不包含这些外部原件；请另外保留源文档，不能仅导出JSON后卸载应用。电脑配套服务提供包含被引用原件的本地资料ZIP备份，尚不是手机一键回迁。
- 手机本机检索不是学习型Embedding，也未内嵌Chroma。电脑服务可选真正的本地Embedding及Milvus/Chroma；当前向量库部署位置不同，不能混称。详见 [配套服务](companion/README.md)。
- 联网模型需用户自行配置。原生请求不是 SSE 流式输出；离线规则回复不代表已连接大模型。
- QQ/钉钉目前为导出文件及目录接入，不代表登录账号、自动获取全部历史或恢复未提供的附件；实际客户端的可用导出格式须核对。电脑扩展需要单独启动配套服务，手机独立模式不需要。
- 浏览器回归和桥接模拟不等于真机测试。HarmonyOS 7 的文件选择、帧率和原生能力仍需设备验证。

## 本地预览与测试

建议使用 Node.js 22、Windows PowerShell 和 Chromium / Edge。

```powershell
npm ci
npx playwright install chromium
node work/prepare-native.cjs
node work/serve-native-preview.cjs
```

打开 `http://127.0.0.1:8767/`。仅监听本机，不向局域网公开个人资料。浏览器预览不能替代 HarmonyOS 原生文件、提醒或密钥存储能力。

```powershell
npm run ci
```

脚本会自动发现公开回归文件并生成隔离资料；电脑服务的验证说明在 companion/。当前main新增代码按用户要求未运行完整CI，旧标签的绿色结果不代表新增功能已验收。三项依赖私人课表或早期预置原型的历史测试未公开，也不计入公开通过数。

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
companion/                      可选个人电脑知识库、来源适配与同步接口
```

## 许可与来源

项目自有源码以 **GPL-3.0-only** 发布，版权声明见 [COPYRIGHT](COPYRIGHT)，完整条款见 [LICENSE](LICENSE)。这允许按许可证使用、修改和商用；分发受覆盖的衍生版本时需履行相应源码及许可义务。

Hyalite 液态玻璃、PDF.js、SheetJS、Lucide、Nunito 等第三方组件保留各自许可证，不应改称为本项目原创。详见 [第三方声明](THIRD_PARTY_NOTICES.md)。许可证不授予冒充官方汐序应用或维护者的权利，也不授予项目名称、图标的商标使用许可。

欢迎提交可复现的问题与改进；请勿在公开 Issue、PR 或截图中上传私人笔记、课表、密钥或签名文件。参见 [贡献说明](CONTRIBUTING.md) 和 [安全说明](SECURITY.md)。
