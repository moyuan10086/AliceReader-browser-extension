# AliceReader Browser Extension

AliceReader 是一个 Chrome/Edge Manifest V3 浏览器扩展，用于朗读网页中选中的文本。

## 支持渠道

- MiniMax T2A：音色、`language_boost`、`emotion`、语速、音量、音调等 MiniMax 参数。
- 豆包 Speech：模型、`speaker` 音色和采样率等豆包参数。
- 阿里百炼：Qwen3-TTS 和 CosyVoice，分别使用各自的音色、语言和指令参数。

设置页会根据当前渠道隐藏不适用的参数，避免跨平台音色或情绪 ID 混用。

## 安装

1. 打开 `chrome://extensions/` 或 `edge://extensions/`。
2. 开启“开发者模式”。
3. 选择“加载已解压的扩展”。
4. 选择本目录 `AliceReader划线朗读插件`。
5. 点击扩展图标打开设置页，填写对应渠道的 API Key。

API Key 只保存在浏览器扩展的本地存储中，不会写入源码。

## 使用

- 在网页中选中文本，点击浮动播放器的朗读按钮。
- 也可以使用右键菜单“Read selected text aloud”。
- 快捷键：`Alt+Shift+S`。
- 测试页面：打开 `test-page.html` 验证扩展交互。

## 注意事项

- 阿里百炼 CosyVoice 使用北京地域的 `SpeechSynthesizer` HTTP API，音色必须选择 CosyVoice 音色 ID。
- 部分浏览器内置页面、扩展商店页面和 PDF 内置阅读器不允许内容脚本运行。
- 请不要把 API Key 提交到 Git 仓库。
