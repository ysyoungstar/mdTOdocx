/* =============================================================
   app.js —— 应用入口：状态检测、主题、转换流程、日志与历史
   ============================================================= */
(function (ns) {
  'use strict';

  let pandocVersion = '';

  function $(id) { return document.getElementById(id); }

  document.addEventListener('DOMContentLoaded', init);

  /** 启动时初始化各模块 */
  function init() {
    applyTheme(readTheme());
    ns.options.init();
    ns.preview.init();
    ns.editor.init();
    ns.reverse.init();          // 反向转换面板（Word / HTML → Markdown）

    bindTabs();
    bindActions();
    bindBus();
    bindSplitter();
    bindModeSwitch();
    renderHistory();

    detectServer(true);
    // 定期复查服务状态，服务重启后界面能自动恢复
    setInterval(function () { detectServer(false); }, 30000);
  }

  /* ======================= 服务状态 ======================= */

  /** 探测 pandoc server 是否可用 */
  async function detectServer(notify) {
    const pill = $('server-status');
    const text = $('server-status-text');
    pill.dataset.state = 'unknown';
    text.textContent = '检测中…';

    try {
      pandocVersion = await ns.client.checkVersion();
      pill.dataset.state = 'online';
      text.textContent = 'Pandoc ' + pandocVersion;
      $('footer-version').textContent = 'Pandoc 版本：' + pandocVersion;
      setFooter('服务就绪');
    } catch (err) {
      pill.dataset.state = 'offline';
      text.textContent = '服务未启动';
      $('footer-version').textContent = 'Pandoc 版本：未知';
      setFooter('未连接 Pandoc 服务');
      if (notify) {
        toast('warning', '未检测到 Pandoc 服务，请先双击 start-server.bat 启动本地服务');
      }
    }
    // 同时检测反向转换桥接服务（Word / HTML → Markdown）
    detectBridge();
  }

  /** 检测本机桥接服务（convert-server.py，端口 3040） */
  async function detectBridge() {
    const el = $('footer-bridge');
    if (!el) return;
    try {
      const info = await ns.bridge.checkVersion();
      el.textContent = '桥接：可用' + (info.bridge ? ' v' + info.bridge : '');
      el.dataset.state = 'online';
    } catch (err) {
      el.textContent = '桥接：未启动（反向转换不可用）';
      el.dataset.state = 'offline';
    }
  }

  /* ======================= 主题 ======================= */

  function readTheme() {
    try {
      return localStorage.getItem(ns.CONFIG.themeKey) || 'light';
    } catch (e) {
      return 'light';
    }
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(ns.CONFIG.themeKey, theme); } catch (e) { /* 忽略 */ }
    // 预览 iframe 里的样式是脚本生成的，必须重绘才能跟随主题变色
    if (ns.preview && typeof ns.preview.refreshTheme === 'function') ns.preview.refreshTheme();
    if (ns.reverse && typeof ns.reverse.refreshTheme === 'function') ns.reverse.refreshTheme();
  }

  /* ======================= 轻提示 ======================= */

  /** 显示一条右下角提示 */
  function toast(type, text) {
    const stack = $('toast-stack');
    const item = document.createElement('div');
    item.className = 'toast' + (type && type !== 'info' ? ' ' + type : '');
    item.textContent = text;
    stack.appendChild(item);
    setTimeout(function () {
      item.classList.add('is-leaving');
      setTimeout(function () { item.remove(); }, 250);
    }, 3400);
  }

  /* ======================= 右侧标签页 ======================= */

  function bindTabs() {
    const tabs = document.querySelectorAll('.side-tabs .tab');
    Array.prototype.forEach.call(tabs, function (tab) {
      tab.addEventListener('click', function () {
        Array.prototype.forEach.call(tabs, function (t) { t.classList.remove('is-active'); });
        tab.classList.add('is-active');
        ['options', 'assets', 'log'].forEach(function (name) {
          $('tab-' + name).hidden = name !== tab.dataset.tab;
        });
      });
    });
  }

  /* ======================= 事件绑定 ======================= */

  function bindActions() {
    $('btn-theme').addEventListener('click', function () {
      const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      applyTheme(next);
    });

    $('server-status').addEventListener('click', function () { detectServer(true); });
    // 主按钮按当前模式分发：转换为 DOCX 或 转换为 Markdown
    $('btn-convert').addEventListener('click', onPrimaryAction);
    $('btn-sample').addEventListener('click', loadSample);
    $('btn-clear-history').addEventListener('click', function () {
      renderHistory(ns.history.clear());
      toast('info', '历史记录已清空');
    });

    // 快捷键：Ctrl+Enter 转换，Ctrl+S 下载（等同于转换）
    document.addEventListener('keydown', function (e) {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === 'Enter') {
        e.preventDefault();
        onPrimaryAction();
      } else if (ctrl && e.key.toLowerCase() === 's') {
        e.preventDefault();
        convert();
      } else if (ctrl && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        $('file-md').click();
      }
    });
  }

  /** 订阅各模块发出的提示事件 */
  function bindBus() {
    ns.bus.on('toast', function (payload) {
      if (payload && payload.text) toast(payload.type, payload.text);
    });
  }

  /* ======================= 转换方向切换 ======================= */

  /** 当前转换方向：toDocx（默认）或 toMarkdown */
  let currentMode = 'toDocx';

  /** 应用转换方向：切换 body[data-mode]，同步主按钮文案 */
  function applyMode(mode) {
    currentMode = mode === 'toMarkdown' ? 'toMarkdown' : 'toDocx';
    document.body.dataset.mode = currentMode;

    Array.prototype.forEach.call(
      document.querySelectorAll('.mode-switch .mode-btn'),
      function (btn) {
        btn.classList.toggle('is-active', btn.dataset.target === currentMode);
      }
    );

    const main = $('btn-convert');
    if (main) {
      if (currentMode === 'toMarkdown') {
        main.textContent = '转换为 Markdown';
        main.title = '把 DOCX / HTML 转换为 Markdown (Ctrl+Enter)';
      } else {
        main.textContent = '转换为 DOCX';
        main.title = '转换为 DOCX (Ctrl+Enter)';
      }
    }

    // 反向模式没有“模板与图片”，若正停留在该页则切回选项页
    const activeTab = document.querySelector('.side-tabs .tab.is-active');
    if (currentMode === 'toMarkdown' && activeTab && activeTab.dataset.tab === 'assets') {
      const optionsTab = document.querySelector('.side-tabs .tab[data-tab="options"]');
      if (optionsTab) optionsTab.click();
    }
  }

  /** 绑定转换方向切换按钮 */
  function bindModeSwitch() {
    const box = $('mode-switch');
    if (!box) return;
    Array.prototype.forEach.call(box.querySelectorAll('.mode-btn'), function (btn) {
      btn.addEventListener('click', function () {
        if (btn.dataset.target === currentMode) return;
        applyMode(btn.dataset.target);
        toast('info', currentMode === 'toMarkdown'
          ? '已切换到 Word / HTML → Markdown'
          : '已切换到 Markdown → Word');
      });
    });
  }

  /** 主按钮与快捷键的统一入口：按当前模式分发 */
  function onPrimaryAction() {
    if (currentMode === 'toMarkdown') ns.reverse.convert();
    else convert();
  }

  /* ======================= 左右分栏拖拽 ======================= */

  function bindSplitter() {
    const splitter = $('splitter');
    const main = $('app-main');
    let dragging = false;

    splitter.addEventListener('mousedown', function (e) {
      if (window.innerWidth <= 1180) return;   // 窄屏为上下堆叠，不启用拖拽
      dragging = true;
      splitter.classList.add('is-dragging');
      e.preventDefault();
    });

    window.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      const rect = main.getBoundingClientRect();
      const max = rect.width - 700;            // 给预览与侧栏留出空间
      const width = Math.min(Math.max(e.clientX - rect.left - 10, 240), Math.max(max, 240));
      main.style.gridTemplateColumns = width + 'px 6px minmax(260px, 1fr) 340px';
    });

    window.addEventListener('mouseup', function () {
      if (!dragging) return;
      dragging = false;
      splitter.classList.remove('is-dragging');
    });
  }

  /* ======================= 载入示例 ======================= */

  // 离线时的内置示例（在线时优先读取 assets/sample.md）
  const DEFAULT_SAMPLE = [
    '# Markdown 转 Word 示例',
    '',
    '这是一份**示例文档**，用于验证排版、目录与代码块。',
    '',
    '## 二级标题',
    '',
    '- 支持列表、*斜体*、`行内代码`',
    '- 支持表格与引用',
    '',
    '> 引用块示例：Pandoc 会把 Markdown 转成 Word 原生样式。',
    '',
    '| 项目 | 说明 |',
    '| --- | --- |',
    '| 转换引擎 | Pandoc 3.x（本机） |',
    '| 输出格式 | docx |',
    '',
    '```js',
    '// 代码块示例',
    'function hello(name) {',
    '  return "Hello, " + name;',
    '}',
    '```'
  ].join('\n');

  /** 载入示例文档 */
  async function loadSample() {
    try {
      const res = await fetch('assets/sample.md', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      ns.editor.setValue(await res.text(), 'sample.md');
      toast('success', '已载入示例文档 assets/sample.md');
    } catch (err) {
      ns.editor.setValue(DEFAULT_SAMPLE, 'sample.md');
      toast('info', '已载入内置示例文本');
    }
  }

  /* ======================= 转换主流程 ======================= */

  // docx 的 MIME 类型
  const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  /** 根据已载入的文件名或时间戳生成输出文件名 */
  function buildFileName() {
    const source = ns.editor.getFileName();
    if (source && /\.(md|markdown|mdown|mkd|txt)$/i.test(source)) {
      return source.replace(/\.(md|markdown|mdown|mkd|txt)$/i, '') + '.docx';
    }
    const now = new Date();
    const pad = function (n) { return String(n).padStart(2, '0'); };
    const stamp = now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) +
      '-' + pad(now.getHours()) + pad(now.getMinutes());
    return 'document-' + stamp + '.docx';
  }

  /** 收集内容与选项 → 调用 pandoc → 下载 docx */
  async function convert() {
    const text = ns.editor.getValue();
    if (!text.trim()) {
      toast('warning', '请先输入或载入 Markdown 内容');
      return;
    }

    const btn = $('btn-convert');
    btn.disabled = true;
    btn.classList.add('is-busy');
    setFooter('正在转换…');

    const started = performance.now();
    try {
      const payload = ns.options.collectPayload('docx');
      payload.from = payload.from || 'markdown';
      payload.text = text;

      const result = await ns.client.convert(payload);
      const blob = ns.client.base64ToBlob(result.output, DOCX_MIME);
      const filename = buildFileName();
      ns.client.downloadBlob(blob, filename);

      const elapsed = Math.round(performance.now() - started);
      showError('无');
      renderMessages(result.messages, filename, blob.size);
      renderHistory(ns.history.add({
        time: Date.now(),
        file: filename,
        size: blob.size,
        ms: elapsed,
        ok: true,
        messageCount: result.messages.length
      }));
      toast('success', '已生成 ' + filename + '（' + ns.client.formatBytes(blob.size) +
        '，用时 ' + elapsed + ' ms）');
      setFooter('转换完成，用时 ' + elapsed + ' ms');
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      const elapsed = Math.round(performance.now() - started);
      showError(message);
      renderMessages([{ message: message, verbosity: 'ERROR' }], null, 0);
      renderHistory(ns.history.add({
        time: Date.now(),
        file: buildFileName() + '（失败）',
        size: 0,
        ms: elapsed,
        ok: false,
        messageCount: 1
      }));
      toast('error', '转换失败：' + message.split('\n')[0]);
      setFooter('转换失败，用时 ' + elapsed + ' ms');
      // 失败可能因为服务中断，顺手复查一次服务状态
      detectServer(false);
    } finally {
      btn.disabled = false;
      btn.classList.remove('is-busy');
    }
  }

  /* ======================= 日志与历史渲染 ======================= */

  /** 渲染本次转换的消息（含结果摘要） */
  function renderMessages(messages, filename, size) {
    const list = $('message-list');
    list.innerHTML = '';

    const items = [];
    if (filename) {
      items.push({
        message: '已生成 ' + filename + '（' + ns.client.formatBytes(size) + '）',
        verbosity: 'OK'
      });
    }
    (messages || []).forEach(function (m) { items.push(m); });

    if (!items.length) {
      const li = document.createElement('li');
      li.className = 'muted';
      li.textContent = '转换成功，Pandoc 未输出警告';
      list.appendChild(li);
      return;
    }

    items.forEach(function (item) {
      const li = document.createElement('li');
      const level = String(item.verbosity || '').toUpperCase();
      if (level === 'WARNING') li.className = 'is-warning';
      else if (level === 'ERROR' || level === 'ERRORS') li.className = 'is-error';
      else if (level === 'OK') li.className = 'is-ok';

      li.textContent = (level && level !== 'OK' ? '[' + level + '] ' : '') + item.message;
      list.appendChild(li);
    });
  }

  /** 渲染历史记录列表 */
  function renderHistory(list) {
    const box = $('history-list');
    const items = list || ns.history.read();
    box.innerHTML = '';

    if (!items.length) {
      const li = document.createElement('li');
      li.className = 'muted';
      li.textContent = '暂无历史';
      box.appendChild(li);
      return;
    }

    items.forEach(function (item) {
      const li = document.createElement('li');
      const title = document.createElement('strong');
      title.textContent = item.ok ? item.file : '失败：' + item.file;
      if (!item.ok) title.style.color = 'var(--danger)';

      const meta = document.createElement('span');
      meta.className = 'hist-time';
      meta.textContent = ns.history.formatTime(item.time) +
        (item.ok
          ? ' · ' + ns.client.formatBytes(item.size) + ' · ' + item.ms + ' ms'
          : ' · ' + item.ms + ' ms');

      li.appendChild(title);
      li.appendChild(meta);
      box.appendChild(li);
    });
  }

  /** 在“错误详情”区域显示文本 */
  function showError(text) {
    $('error-box').textContent = text || '无';
  }

  /** 更新底部状态栏 */
  function setFooter(text) {
    $('footer-message').textContent = text;
  }

  // 暴露给控制台调试使用
  ns.app = {
    convert: convert,
    toast: toast,
    detectServer: detectServer,
    // 以下接口供 reverse.js 复用日志、历史与状态栏能力
    renderMessages: renderMessages,
    refreshHistory: function (list) { renderHistory(list); },
    showError: showError,
    setFooter: setFooter
  };
})(window.MD2DOCX);
