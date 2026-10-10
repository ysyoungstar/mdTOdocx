/* =============================================================
   reverse.js —— 反向转换：HTML / DOCX → Markdown
   依赖：config.js（选项元数据）、bridge-client.js、pandoc-client.js、history.js
   说明：本模块自带选项表单渲染，不改动主选项模块（options.js），
        以把回归风险降到最低。
   ============================================================= */
(function (ns) {
  'use strict';

  let sourceText = null;      // HTML 源码输入框
  let outputBox = null;       // 结果 Markdown
  let fileBadge = null;       // 已选文件名徽标
  let statusEl = null;        // 结果区状态提示
  let mediaListEl = null;     // 导出图片列表
  let outDirEl = null;        // 输出目录提示
  let frame = null;           // 渲染预览 iframe
  let textPanel = null;       // 文本面板
  let previewPanel = null;    // 预览面板

  /** 当前输入源：{ type:'docx'|'html', name, base64, size } */
  let source = { type: '', name: '', base64: '', size: 0 };

  /** 最近一次转换结果（用于下载图片包等） */
  let lastResult = { zipBase64: '', mediaFiles: [], outDir: '' };

  function $(id) { return document.getElementById(id); }

  /* ======================= 选项表单（反向） ======================= */

  /** 依据 REVERSE_OPTION_GROUPS 渲染反向选项表单 */
  function renderForm() {
    const form = $('options-form-reverse');
    if (!form || form.dataset.rendered === '1') return;
    form.dataset.rendered = '1';

    ns.REVERSE_OPTION_GROUPS.forEach(function (group) {
      const box = document.createElement('div');
      box.className = 'field-group';

      const title = document.createElement('h3');
      title.className = 'group-title';
      title.textContent = group.title;
      box.appendChild(title);

      group.fields.forEach(function (field) {
        box.appendChild(createField(field));
      });
      form.appendChild(box);
    });

    restoreOptions();
    // 选项变化后立即保存，下次打开仍是上次的选择
    form.addEventListener('change', persistOptions);
  }

  /** 创建单个字段的 DOM（结构与主选项面板保持一致，复用同一套样式） */
  function createField(field) {
    const isCheck = field.type === 'checkbox';
    const wrap = document.createElement(isCheck ? 'label' : 'div');
    wrap.className = isCheck ? 'check-field' : 'field';

    let control;
    if (field.type === 'select') {
      control = document.createElement('select');
      (field.options || []).forEach(function (opt) {
        const option = document.createElement('option');
        option.value = opt.value;
        option.textContent = opt.label;
        control.appendChild(option);
      });
      control.value = field.default || '';
    } else if (field.type === 'textarea') {
      control = document.createElement('textarea');
      control.rows = 2;
      control.placeholder = '--reference-links';
    } else if (isCheck) {
      control = document.createElement('input');
      control.type = 'checkbox';
      control.checked = !!field.default;
    } else if (field.type === 'number') {
      control = document.createElement('input');
      control.type = 'number';
      if (field.min != null) control.min = String(field.min);
      if (field.max != null) control.max = String(field.max);
      control.value = field.default != null ? String(field.default) : '0';
    } else {
      control = document.createElement('input');
      control.type = 'text';
      if (field.placeholder) control.placeholder = field.placeholder;
    }

    control.dataset.field = field.key;
    control.className = 'field-control';

    if (isCheck) {
      const text = document.createElement('span');
      text.textContent = field.label;
      wrap.appendChild(control);
      wrap.appendChild(text);
    } else {
      const label = document.createElement('span');
      label.className = 'field-label';
      label.textContent = field.label;
      wrap.appendChild(label);
      wrap.appendChild(control);
    }

    if (field.hint) {
      const hint = document.createElement('span');
      hint.className = 'hint';
      hint.textContent = field.hint;
      wrap.appendChild(hint);
    }

    return wrap;
  }

  /** 读取反向表单：{ to, options }（to 用于请求的 to 字段） */
  function collectOptions() {
    const form = $('options-form-reverse');
    const data = { to: 'markdown', options: {} };
    if (!form) return data;

    Array.prototype.forEach.call(form.querySelectorAll('[data-field]'), function (control) {
      const key = control.dataset.field;
      if (key === 'to') {
        data.to = control.value || 'markdown';
        return;
      }
      if (key === '__extraArgs') {
        const text = String(control.value || '').trim();
        if (text) data.options.__extraArgs = text;
        return;
      }
      if (control.type === 'checkbox') {
        data.options[key] = control.checked;
        return;
      }
      const value = String(control.value || '').trim();
      if (value !== '') data.options[key] = value;
    });

    return data;
  }

  /** 保存反向选项到 localStorage */
  function persistOptions() {
    try {
      localStorage.setItem(ns.CONFIG.reverseSettingsKey, JSON.stringify(collectOptions()));
    } catch (e) {
      /* 隐私模式下写入失败，忽略 */
    }
  }

  /** 从 localStorage 恢复反向选项 */
  function restoreOptions() {
    const form = $('options-form-reverse');
    if (!form) return;

    let saved = null;
    try {
      const raw = localStorage.getItem(ns.CONFIG.reverseSettingsKey);
      saved = raw ? JSON.parse(raw) : null;
    } catch (e) {
      saved = null;
    }
    if (!saved) return;

    const values = Object.assign({ to: saved.to }, saved.options || {});
    Array.prototype.forEach.call(form.querySelectorAll('[data-field]'), function (control) {
      const key = control.dataset.field;
      if (!(key in values)) return;
      if (control.type === 'checkbox') control.checked = !!values[key];
      else control.value = String(values[key]);
    });
  }

  /* ======================= 输入源处理 ======================= */

  /** 读取文本文件（HTML 用） */
  function readTextFile(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result)); };
      reader.onerror = function () { reject(new Error('读取失败：' + file.name)); };
      reader.readAsText(file, 'utf-8');
    });
  }

  /** 选择 / 拖入文件：按扩展名自动判定 docx 或 html */
  async function onPickFiles(fileList) {
    const file = fileList && fileList[0];
    if (!file) return;

    const name = file.name || '';
    const isDocx = /\.docx$/i.test(name);
    const isHtml = /\.html?$/i.test(name);

    if (!isDocx && !isHtml) {
      toast('warning', '只支持 .docx 与 .html / .htm 文件');
      return;
    }

    const limitMb = ns.CONFIG.maxUploadMB || 30;
    if (file.size > limitMb * 1024 * 1024) {
      toast('warning', '文件超过 ' + limitMb + ' MB，建议直接用 pandoc 命令行处理');
      return;
    }

    try {
      if (isDocx) {
        const base64 = await ns.bridge.readFileAsBase64(file);
        setSource('docx', name, base64, file.size, '');
      } else {
        const text = await readTextFile(file);
        setSource('html', name, '', file.size, text);
      }
      toast('success', '已载入 ' + name + '（' + ns.client.formatBytes(file.size) + '）');
    } catch (err) {
      toast('error', err.message);
    }
  }

  /** 设置当前输入源并刷新界面 */
  function setSource(type, name, base64, size, text) {
    source = { type: type, name: name, base64: base64 || '', size: size || 0 };

    if (type === 'html') {
      sourceText.readOnly = false;
      sourceText.placeholder = '在此粘贴 HTML 源码，或把 .html 文件拖到这里…';
      sourceText.value = text || '';
    } else {
      // docx 是二进制文件：源码框只用来展示文件信息，不允许手动修改
      sourceText.readOnly = true;
      sourceText.value = '';
      sourceText.placeholder = '已选择 DOCX 文件：' + name + '（' +
        ns.client.formatBytes(size) + '）\n转换时文件内容会交给本机 pandoc，内嵌图片会导出到输出目录。';
    }

    if (fileBadge) {
      fileBadge.hidden = !name;
      fileBadge.textContent = name ? (name + ' · ' + ns.client.formatBytes(size)) : '';
    }
    updateInputHint();
  }

  /** 更新“当前输入类型”提示 */
  function updateInputHint() {
    const hint = $('reverse-input-hint');
    if (!hint) return;
    if (!source.type) {
      hint.textContent = '尚未选择文件；也可以直接在左侧粘贴 HTML 源码。';
      return;
    }
    hint.textContent = source.type === 'docx'
      ? '输入类型：DOCX（内嵌图片会自动导出）'
      : '输入类型：HTML 源码';
  }

  /** 清空输入与结果 */
  function clearAll() {
    source = { type: '', name: '', base64: '', size: 0 };
    sourceText.readOnly = false;
    sourceText.value = '';
    sourceText.placeholder = '在此粘贴 HTML 源码，或把 .html / .docx 文件拖到这里…';
    if (fileBadge) { fileBadge.hidden = true; fileBadge.textContent = ''; }
    outputBox.value = '';
    lastResult = { zipBase64: '', mediaFiles: [], outDir: '' };
    renderMedia([]);
    if (outDirEl) outDirEl.textContent = '';
    updateInputHint();
    updateStats();
    setStatus('等待转换');
    if (frame) frame.srcdoc = '';
  }

  /** 当前输入类型：未显式选文件时，只要 HTML 文本框有内容就按 HTML 处理 */
  function currentType() {
    if (source.type) return source.type;
    return sourceText && sourceText.value.trim() ? 'html' : '';
  }

  /* ======================= 转换流程 ======================= */

  /** 执行反向转换：HTML / DOCX → Markdown */
  async function convert() {
    const type = currentType();
    if (!type) {
      toast('warning', '请先选择 DOCX 文件，或粘贴 HTML 源码');
      return;
    }

    let data = '';
    if (type === 'docx') {
      if (!source.base64) { toast('warning', '请先选择 DOCX 文件'); return; }
      data = source.base64;
    } else {
      data = sourceText.value;
      if (!data.trim()) { toast('warning', '请先粘贴 HTML 源码或选择 HTML 文件'); return; }
    }

    const picked = collectOptions();
    const btn = $('btn-convert');
    const started = performance.now();
    if (btn) { btn.disabled = true; btn.classList.add('is-busy'); }
    setStatus('转换中…');
    ns.app.setFooter('正在转换为 Markdown…');

    try {
      const result = await ns.bridge.convert({
        source: type,
        data: data,
        filename: source.name || ('input.' + type),
        to: picked.to,
        options: picked.options
      });

      renderResult(result);
      const elapsed = Math.round(performance.now() - started);
      ns.app.renderMessages(result.messages, mdName(), result.output.length);
      ns.app.refreshHistory(ns.history.add({
        time: Date.now(),
        file: (source.name || 'input.' + type) + ' → ' + mdName(),
        size: result.output.length,
        ms: elapsed,
        ok: true,
        messageCount: result.messages.length
      }));
      toast('success', '已生成 ' + mdName() + '（用时 ' + elapsed + ' ms' +
        (result.mediaFiles.length ? '，导出 ' + result.mediaFiles.length + ' 个图片' : '') + '）');
      ns.app.setFooter('转换完成，用时 ' + elapsed + ' ms');
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      const elapsed = Math.round(performance.now() - started);
      setStatus('转换失败：' + message.split('\n')[0], 'error');
      ns.app.showError(message);
      ns.app.renderMessages([{ message: message, verbosity: 'ERROR' }], null, 0);
      ns.app.refreshHistory(ns.history.add({
        time: Date.now(),
        file: (source.name || 'input.' + type) + ' → ' + mdName() + '（失败）',
        size: 0,
        ms: elapsed,
        ok: false,
        messageCount: 1
      }));
      toast('error', '转换失败：' + message.split('\n')[0]);
      ns.app.setFooter('转换失败');
      ns.app.detectServer(false);
    } finally {
      if (btn) { btn.disabled = false; btn.classList.remove('is-busy'); }
    }
  }

  /** 渲染转换结果 */
  function renderResult(result) {
    outputBox.value = result.output;
    lastResult = {
      zipBase64: result.zipBase64 || '',
      mediaFiles: result.mediaFiles || [],
      outDir: result.outDir || ''
    };

    renderMedia(result.mediaFiles || []);
    if (outDirEl) {
      outDirEl.textContent = result.outDir ? ('输出已保存到：' + result.outDir) : '';
      outDirEl.title = result.outDir || '';
    }
    updateStats();
    showPanel('text');
    setStatus('转换完成 · ' + clockText() + ' · ' + result.ms + ' ms', 'ok');
  }

  /** 渲染导出的图片列表（点击单个图片即可下载） */
  function renderMedia(list) {
    if (!mediaListEl) return;
    mediaListEl.innerHTML = '';

    const btnMedia = $('btn-download-media');
    if (btnMedia) btnMedia.disabled = !list.length;

    if (!list.length) {
      const li = document.createElement('li');
      li.className = 'muted';
      li.textContent = '没有导出图片';
      mediaListEl.appendChild(li);
      return;
    }

    list.forEach(function (item) {
      const li = document.createElement('li');
      li.className = 'asset-item';

      const thumb = document.createElement('img');
      thumb.src = 'data:image/*;base64,' + item.base64;
      thumb.alt = item.name;

      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = item.name;

      const size = document.createElement('span');
      size.className = 'size';
      size.textContent = ns.client.formatBytes(item.size);

      li.title = '点击下载该图片：' + item.name;
      li.appendChild(thumb);
      li.appendChild(name);
      li.appendChild(size);
      li.addEventListener('click', function () {
        ns.client.downloadBlob(
          ns.client.base64ToBlob(item.base64, mimeOf(item.name)),
          item.name.replace(/^.*\//, '')
        );
      });
      mediaListEl.appendChild(li);
    });
  }

  /** 按扩展名猜 mime（仅用于下载与预览） */
  function mimeOf(name) {
    const ext = String(name).toLowerCase().replace(/^.*\./, '');
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
    if (ext === 'gif') return 'image/gif';
    if (ext === 'svg') return 'image/svg+xml';
    if (ext === 'emf' || ext === 'wmf' || ext === 'tiff') return 'application/octet-stream';
    return 'image/png';
  }

  /** 更新结果统计 */
  function updateStats() {
    const text = outputBox ? outputBox.value : '';
    const chars = $('stat-reverse-chars');
    const lines = $('stat-reverse-lines');
    if (chars) chars.textContent = text.length + ' 字符';
    if (lines) lines.textContent = (text ? text.split('\n').length : 0) + ' 行';
  }

  /** 输出文件名：把源文件名换成 .md */
  function mdName() {
    const base = (source.name || 'output').replace(/\.[^.]+$/, '');
    return (base || 'output') + '.md';
  }

  /** 当前时间 HH:MM:SS */
  function clockText() {
    const d = new Date();
    const pad = function (n) { return String(n).padStart(2, '0'); };
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  /** 更新结果区状态提示 */
  function setStatus(text, kind) {
    if (!statusEl) return;
    statusEl.textContent = text;
    if (kind) statusEl.dataset.kind = kind;
    else statusEl.removeAttribute('data-kind');
  }

  /* ======================= 结果操作 ======================= */

  /** 下载结果 Markdown */
  function downloadMd() {
    const text = outputBox.value;
    if (!text) { toast('warning', '还没有可下载的内容'); return; }
    ns.client.downloadBlob(new Blob([text], { type: 'text/markdown;charset=utf-8' }), mdName());
    toast('success', '已下载 ' + mdName());
  }

  /** 下载图片压缩包（由桥接服务打包好的 zip） */
  function downloadMedia() {
    if (!lastResult.zipBase64) { toast('warning', '本次转换没有导出图片'); return; }
    ns.bridge.downloadZip(lastResult.zipBase64,
      mdName().replace(/\.md$/, '') + '-media.zip');
    toast('success', '已下载图片压缩包');
  }

  /** 复制结果 Markdown */
  async function copyMd() {
    const text = outputBox.value;
    if (!text) { toast('warning', '还没有可复制的内容'); return; }
    try {
      await navigator.clipboard.writeText(text);
      toast('success', 'Markdown 已复制到剪贴板');
    } catch (e) {
      // 剪贴板不可用（非 https / 未授权）时退化为选中文本
      outputBox.select();
      toast('warning', '当前浏览器不允许自动复制，已选中全部内容，请按 Ctrl+C');
    }
  }

  /** 复制输出目录路径（便于到资源管理器里找图片） */
  async function copyOutDir() {
    if (!lastResult.outDir) { toast('warning', '本次转换没有输出目录'); return; }
    try {
      await navigator.clipboard.writeText(lastResult.outDir);
      toast('success', '输出目录路径已复制');
    } catch (e) {
      toast('warning', '复制失败，请手动记录：' + lastResult.outDir);
    }
  }

  /* ======================= 结果预览 ======================= */

  /** 在“文本 / 预览”之间切换 */
  function showPanel(name) {
    const isText = name !== 'preview';
    if (textPanel) textPanel.hidden = !isText;
    if (previewPanel) previewPanel.hidden = isText;
    const btnText = $('btn-view-text');
    const btnPreview = $('btn-view-preview');
    if (btnText) btnText.classList.toggle('is-active', isText);
    if (btnPreview) btnPreview.classList.toggle('is-active', !isText);
  }

  /** 把结果 Markdown 渲染成 HTML 预览（复用 pandoc 服务的 markdown → html） */
  async function renderPreview() {
    if (!frame) return;
    const text = outputBox.value;
    if (!text.trim()) {
      frame.srcdoc = '';
      setStatus('没有可预览的内容', 'error');
      return;
    }
    setStatus('渲染预览中…');
    try {
      const result = await ns.client.convert({
        to: 'html', from: 'markdown', text: text, standalone: true
      }, 30000);
      frame.srcdoc = buildPreviewDocument(extractBody(result.output));
      setStatus('预览已更新 · ' + clockText(), 'ok');
    } catch (err) {
      setStatus('预览失败：' + String(err.message).split('\n')[0], 'error');
    }
  }

  /** 从 standalone HTML 中取出 body 内容（与主预览面板保持一致的处理方式） */
  function extractBody(html) {
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      return doc.body ? doc.body.innerHTML : html;
    } catch (e) {
      return html;
    }
  }

  /** 组装预览文档（复用主预览的样式表，保证观感一致并跟随主题） */
  function buildPreviewDocument(bodyHtml) {
    const css = (ns.preview && typeof ns.preview.currentCss === 'function')
      ? ns.preview.currentCss() : '';
    return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><style>' +
      css + '</style></head><body class="pandoc-body">' + bodyHtml + '</body></html>';
  }

  /** 统一的轻提示（转发到 app 模块） */
  function toast(type, text) {
    if (ns.app && typeof ns.app.toast === 'function') ns.app.toast(type, text);
  }

  /* ======================= 初始化 ======================= */

  /** 绑定反向面板的所有交互 */
  function init() {
    sourceText = $('reverse-source-text');
    outputBox = $('reverse-output');
    fileBadge = $('reverse-file-badge');
    statusEl = $('reverse-status');
    mediaListEl = $('reverse-media-list');
    outDirEl = $('reverse-outdir');
    frame = $('reverse-preview-frame');
    textPanel = $('reverse-text-panel');
    previewPanel = $('reverse-preview-panel');

    if (!sourceText || !outputBox) return;   // 页面没有反向面板时直接跳过

    renderForm();
    showPanel('text');

    // 输入区：粘贴 HTML 内容时更新提示与统计
    sourceText.addEventListener('input', function () {
      if (source.type === 'docx') return;    // docx 模式下输入框只读
      updateInputHint();
      updateStats();
    });

    // 拖放载入（.docx / .html）
    const dropZone = $('reverse-drop');
    if (dropZone) {
      ['dragenter', 'dragover'].forEach(function (type) {
        dropZone.addEventListener(type, function (e) {
          e.preventDefault();
          dropZone.classList.add('is-dragover');
        });
      });
      dropZone.addEventListener('dragleave', function (e) {
        if (dropZone.contains(e.relatedTarget)) return;
        dropZone.classList.remove('is-dragover');
      });
      dropZone.addEventListener('drop', function (e) {
        e.preventDefault();
        dropZone.classList.remove('is-dragover');
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
          onPickFiles(e.dataTransfer.files);
        }
      });
    }

    // 选择文件
    const input = $('file-reverse');
    const btnOpen = $('btn-open-reverse');
    if (btnOpen && input) {
      btnOpen.addEventListener('click', function () { input.click(); });
      input.addEventListener('change', function (e) {
        onPickFiles(e.target.files);
        e.target.value = '';
      });
    }

    // 清空
    const btnClear = $('btn-reverse-clear');
    if (btnClear) {
      btnClear.addEventListener('click', function () {
        clearAll();
        toast('info', '已清空输入与结果');
      });
    }

    // 结果操作
    const btnDownload = $('btn-download-md');
    if (btnDownload) btnDownload.addEventListener('click', downloadMd);

    const btnCopy = $('btn-copy-md');
    if (btnCopy) btnCopy.addEventListener('click', copyMd);

    const btnMedia = $('btn-download-media');
    if (btnMedia) btnMedia.addEventListener('click', downloadMedia);

    const btnOutDir = $('btn-copy-outdir');
    if (btnOutDir) btnOutDir.addEventListener('click', copyOutDir);

    // 文本 / 预览 切换
    const btnText = $('btn-view-text');
    if (btnText) btnText.addEventListener('click', function () { showPanel('text'); });

    const btnPreview = $('btn-view-preview');
    if (btnPreview) {
      btnPreview.addEventListener('click', function () {
        showPanel('preview');
        renderPreview();
      });
    }

    outputBox.addEventListener('input', updateStats);

    updateInputHint();
    updateStats();
    setStatus('等待转换');
  }

  /** 主题切换后重绘结果预览（仅在预览已渲染过时重绘） */
  function refreshTheme() {
    if (!frame || !frame.srcdoc) return;
    renderPreview();
  }

  ns.reverse = {
    init: init,
    convert: convert,
    clearAll: clearAll,
    refreshTheme: refreshTheme,
    isReady: function () { return !!sourceText; }
  };
})(window.MD2DOCX);
