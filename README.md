# mdTOdocx —— Markdown 转 Word 可视化工具

一个纯前端的可视化页面，调用**本机安装的 Pandoc**把 Markdown 转成 Word（docx），支持实时预览、模板、目录、图片与批量选项。

## 一、功能概览

- 拖拽或选择 `.md` 文件载入，也可直接粘贴；多个文件会按顺序合并
- 右侧实时预览（Pandoc 渲染 HTML，输入停止 0.5 秒后自动刷新）
- 转换选项面板：文档标题/副标题/作者/日期、目录与目录深度、章节编号、标题层级偏移、输入格式、代码高亮样式、图片默认扩展名、每行宽度
- 模板支持：选择自定义 `reference.docx` 控制字体、页边距与样式
- 图片支持：添加本地图片后，点击图片名即可把引用插入正文，转换时图片随请求一起发送
- 一键下载 docx，并显示 Pandoc 的警告/信息、转换耗时、体积与历史记录
- 深色/浅色主题、可拖拽分栏、快捷键（Ctrl+Enter 或 Ctrl+S 转换，Ctrl+O 打开文件）

## 二、环境要求

- Windows 系统，已安装 Pandoc 3.x（`pandoc --version` 可正常输出；需带 `+server` 特性，官方发行版自带）
- 可选：Python 3（用于提供静态页面服务，建议安装；未安装时脚本会改用 `file://` 直接打开页面）
- 现代浏览器（Edge / Chrome / Firefox 均可）

## 三、快速开始

1. 双击 `start-server.bat`
   - 它会启动 `pandoc server`（端口 3030）与页面静态服务（端口 8080），并自动打开浏览器
   - 若浏览器未自动打开，请手动访问 `http://127.0.0.1:8080/`
   - 若自动打开浏览器不可用，请关闭后手动打开index.html文件
2. 在页面里载入或粘贴 Markdown
3. 按需调整右侧选项
4. 点击“转换为 DOCX”，浏览器会下载生成的 Word 文件
5. 结束后可双击 `stop-server.bat` 停止服务

> 说明：页面右上角的状态灯显示 Pandoc 服务是否可用；点击它可以重新检测。

## 四、界面说明

- 左栏：Markdown 源文件编辑区，底部显示字符数、行数与文件来源
- 中栏：实时预览（“自动”开关可关闭自动刷新，改用手动“刷新”按钮）
- 右栏三个标签页：
  - 转换选项：所有 Pandoc 参数
  - 模板与图片：选择 `reference.docx` 模板、添加图片资源
  - 日志与历史：本次转换消息、历史记录、错误详情

## 五、目录结构

```
mdTOdocx/
├─ index.html            页面结构
├─ css/
│  ├─ base.css           变量与主题
│  ├─ layout.css         分栏布局与响应式
│  └─ components.css     按钮、表单、列表等组件样式
├─ js/
│  ├─ config.js          全局配置与选项元数据
│  ├─ pandoc-client.js   与 pandoc server 通信（/version、转换、下载）
│  ├─ options.js         选项表单渲染与模板/图片资源管理
│  ├─ preview.js         HTML 预览渲染
│  ├─ editor.js          Markdown 输入区交互
│  ├─ history.js         历史记录持久化
│  └─ app.js             入口：状态检测、转换流程、日志
├─ assets/sample.md      示例文档
├─ start-server.bat      启动服务并打开页面
├─ stop-server.bat       停止服务
└─ README.md             本说明
```

## 六、高级用法

“转换选项 → 高级 → 额外请求字段”可以直接填写 JSON，字段会合并进 Pandoc 请求体。例如：

```
{"wrap":"none","resource-path":["."]}
```

模板与图片必须放在 `files` 字段中，页面已自动处理：模板固定使用 `reference.docx` 这个路径名，图片使用你选择的原始文件名，因此正文里可以写 `![](图片名.png)`。

## 七、常见问题

**1. 状态灯显示“服务未启动”**
请确认 `start-server.bat` 窗口中的 `pandoc-server` 子窗口仍在运行，或手动执行：

```
pandoc server -p 3030 -t 60
```

**2. 端口被占用**
修改 `start-server.bat` 顶部的 `PANDOC_PORT`（默认 3030）与 `WEB_PORT`（默认 8080），并同步修改 `js/config.js` 中的 `serverBase`。

**3. 大文档转换超时**
脚本已把 Pandoc 超时设为 60 秒，可在 `start-server.bat` 中把 `PANDOC_TIMEOUT` 调得更大。

**4. 图片在 Word 里没显示**
请确认正文中的文件名与“模板与图片”列表中显示的完全一致（点击列表项会自动插入正确的引用）。

**5. 勾选了“生成目录”，打开 Word 却是空目录**
Pandoc 写入的是 Word 的目录域（TOC field），需要 Word 计算后才会显示条目。请在目录处右键选择“更新域”，或按 `Ctrl+A` 后按 `F9` 更新全部域，目录条目就会显示出来。

## 八、已知限制

- `pandoc server` 运行在 PandocPure 沙箱中：**不能导出 PDF、不支持 Lua/自定义滤镜、不能读取本地磁盘路径**，因此模板与图片都通过 base64 走 `files` 字段
- 页面本身不执行任何文档中的脚本：预览使用 `sandbox` 的 iframe 渲染
- 转换在本机完成，文档内容不会上传到外部服务器
