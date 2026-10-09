/* =============================================================
   editor.js —— Markdown 输入区交互（载入文件、统计、插入文本）
   ============================================================= */
(function (ns) {
  'use strict';

  let textarea = null;
  let fileBadge = null;
  let currentFileName = '';   // 已载入的文件名，用于推导输出文件名

  function $(id) { return document.getElementById(id); }

  /** 读取单个文本文件 */
  function readText(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result)); };
      reader.onerror = function () { reject(new Error('读取失败：' + file.name)); };
      reader.readAsText(file, 'utf-8');
    });
  }

  /** 载入一批本地 Markdown 文件 */
  async function loadFiles(fileList) {
    const files = Array.prototype.slice.call(fileList || []).filter(function (f) {
      return /\.(md|markdown|mdown|mkd|txt)$/i.test(f.name) || f.type === 'text/plain';
    });
    if (!files.length) {
      ns.bus.emit('toast', { type: 'warning', text: '未找到可读的 Markdown 文件' });
      return;
    }

    try {
      const contents = await Promise.all(files.map(readText));
      // 多文件依次拼接，便于合并成一份 Word 文档
      const merged = contents.map(function (text) { return text.trim(); }).join('\n\n');
      setValue(merged, files.length === 1 ? files[0].name : files.length + ' 个文件');
      ns.bus.emit('toast', {
        type: 'success',
        text: files.length === 1 ? ('已载入 ' + files[0].name) : ('已载入 ' + files.length + ' 个文件')
      });
    } catch (err) {
      ns.bus.emit('toast', { type: 'error', text: err.message });
    }
  }

  /** 设置编辑器内容与文件名 */
  function setValue(text, fileName) {
    textarea.value = text;
    currentFileName = fileName || '';
    if (fileBadge) {
      fileBadge.hidden = !currentFileName;
      fileBadge.textContent = currentFileName;
    }
    updateStats();
    ns.preview.schedule();
  }

  /** 在光标处插入文本（用于图片引用、快捷键等） */
  function insertText(text) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const value = textarea.value;
    const before = value.slice(0, start);
    const after = value.slice(end);
    // 自动补一个换行，避免与已有文字粘连
    const prefix = before && !before.endsWith('\n') ? '\n' : '';
    textarea.value = before + prefix + text + after;
    const caret = (before + prefix + text).length;
    textarea.focus();
    textarea.setSelectionRange(caret, caret);
    updateStats();
    ns.preview.schedule();
  }

  /** 更新字符/行数统计 */
  function updateStats() {
    const text = textarea.value;
    $('stat-chars').textContent = text.length + ' 字符';
    $('stat-lines').textContent = (text ? text.split('\n').length : 0) + ' 行';
    $('stat-ingest').textContent = currentFileName ? ('来源：' + currentFileName) : '未载入文件';
  }

  /** 事件绑定 */
  function init() {
    textarea = $('markdown-input');
    fileBadge = $('file-badge');

    textarea.addEventListener('input', function () {
      updateStats();
      ns.preview.schedule();
    });

    // Tab 插入两个空格，保持列表缩进
    textarea.addEventListener('keydown', function (e) {
      if (e.key === 'Tab') {
        e.preventDefault();
        insertText('  ');
      }
    });

    // 拖拽高亮与释放
    const dropZone = $('editor-drop');
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
        loadFiles(e.dataTransfer.files);
      }
    });

    // 打开文件按钮
    $('btn-open-md').addEventListener('click', function () { $('file-md').click(); });
    $('file-md').addEventListener('change', function (e) {
      loadFiles(e.target.files);
      e.target.value = '';
    });

    // 清空按钮
    $('btn-clear').addEventListener('click', function () {
      setValue('', '');
      ns.preview.render();
      ns.bus.emit('toast', { type: 'info', text: '已清空编辑器' });
    });

    // 其他模块发起的插入请求（点击图片名）
    ns.bus.on('insert-text', function (text) { insertText(text); });

    updateStats();
  }

  ns.editor = {
    init: init,
    getValue: function () { return textarea ? textarea.value : ''; },
    setValue: setValue,
    getFileName: function () { return currentFileName; },
    insertText: insertText
  };
})(window.MD2DOCX);
