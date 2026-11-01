# HarmonyOS 原生构建入口

应用工程位于 `xixu-harmony/`，使用 ArkTS、ArkUI 与 ArkWeb。网页资源由模块源码组合到原生 `rawfile`，原生桥接负责文件选择、模型请求、OCR 和系统提醒。

## 工具与资源

使用自己的 DevEco Studio、HarmonyOS SDK 和应用签名配置。在仓库根目录准备离线资源：

```powershell
node work/prepare-native.cjs
```

该命令组合模块并检查 JavaScript 语法，不代表原生编译或真机验收。

## Release 构建

默认 DevEco 路径为 `C:/Program Files/Huawei/DevEco Studio`。也可通过环境变量指定自己的安装位置：

```powershell
$env:XIXU_DEVECO_HOME = 'C:/Program Files/Huawei/DevEco Studio'
node xixu-harmony/build-release.cjs
```

构建入口调用 Hvigor 的 `assembleApp`；SDK 可通过 `XIXU_SDK_HOME` 指定。签名、证书及应用发布信息由自己的开发环境配置，不放入公开仓库。

若需要执行项目提供的网页检查与原生构建验证，可使用 `npm run ci:full`。具体结果应对应实际提交和工具链，见 [开发与验证记录](VALIDATION_STATUS.md)。

## 代码入口

- [原生工程配置](../xixu-harmony/build-profile.json5)
- [Release 构建脚本](../xixu-harmony/build-release.cjs)
- [模块与离线资源生成](../work/prepare-native.cjs)
- [回归与原生构建检查](../ci/Invoke-XixuCI.ps1)

源码更新、生成资源、完成签名、上传内测和提交审核分别记录；源码推送不会自动替换已安装的手机版本。
