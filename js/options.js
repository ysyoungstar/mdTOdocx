/* =============================================================
   options.js —— 选项表单渲染/读取，以及模板与图片资源管理
   ============================================================= */
(function (ns) {
  'use strict';

  /** 模板与图片资源（内存中保存 base64，随请求发送给 pandoc） */
  const assets = {
    referenceDoc: null,   // { name, base64, size }
    images: []            // [{ name, base64, dataUrl, size, inserted }]
  };
  ns.assets = assets;

  // pandoc 的 files 字段中，模板固定使用的路径名
  const REF_KEY = 'reference.docx';

  // “添加后自动插入引用”开关的持久化键名
  const AUTO_INSERT_KEY = 'md2docx.assets.autoInsert';

  /** 快捷取元素 */
  function $(id) { return document.getElementById(id); }

  /* ======================= 表单渲染 ======================= */

  /** 依据 OPTION_GROUPS 生成全部选项控件 */
  function renderForm() {
    const form = $('options-form');
    if (!form || form.dataset.rendered === '1') return;
    form.dataset.rendered = '1';

    ns.OPTION_GROUPS.forEach(function (group) {
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

    // 任何修改都立即持久化，并刷新预览
    form.addEventListener('input', onOptionChange);
    form.addEventListener('change', onOptionChange);
  }

  /** 创建单个字段的 DOM 结构 */
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
      control.rows = 3;
      control.placeholder = '{"wrap":"none"}';
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
      // 复选：控件在前，文字在后
      const text = document.createElement('span');
      text.textContent = field.label;
      wrap.appendChild(control);
      wrap.appendChild(text);
    } else {
      // 其他：标题在上，控件在下
      const label = document.createElement('span');
      label.className = 'field-label';
      label.textContent = field.label;
      wrap.appendChild(label);
      wrap.appendChild(control);
    }

    if (field.hint) {
      const hint = document.createElement('span');
      hint.className = 'field-hint';
      hint.textContent = field.hint;
      wrap.appendChild(hint);
    }
    return wrap;
  }

  /* ======================= 值收集与持久化 ======================= */

  /** 找出表单里所有字段控件 */
  function fieldControls() {
    return Array.prototype.slice.call(
      document.querySelectorAll('#options-form [data-field]')
    );
  }

  /** 按 key 查找字段定义 */
  function findField(key) {
    for (let i = 0; i < ns.OPTION_GROUPS.length; i++) {
      const fields = ns.OPTION_GROUPS[i].fields;
      for (let j = 0; j < fields.length; j++) {
        if (fields[j].key === key) return fields[j];
      }
    }
    return null;
  }

  /**
   * 生成 pandoc 请求体（不含 text 字段）
   * @param {string} [outputFormat] 输出格式，默认 docx；预览时传 html
   */
  function collectPayload(outputFormat) {
    const payload = { to: outputFormat || 'docx' };
    const metadata = {};

    fieldControls().forEach(function (control) {
      const field = findField(control.dataset.field);
      if (!field) return;

      let value;
      if (field.type === 'checkbox') {
        if (!control.checked) return;   // 未勾选则不发送，保持 pandoc 默认
        value = true;
      } else if (field.type === 'number') {
        const num = parseInt(control.value, 10);
        if (isNaN(num)) return;
        value = num;
      } else {
        value = (control.value || '').trim();
        if (value === '') return;       // 空值不发送，避免覆盖默认
      }

      // 附加字段：解析 JSON 后合并进请求体
      if (field.key === '__extraJson') {
        let extra;
        try {
          extra = JSON.parse(value);
        } catch (e) {
          throw new Error('“额外请求字段”不是合法的 JSON：' + e.message);
        }
        if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
          Object.keys(extra).forEach(function (k) { payload[k] = extra[k]; });
        }
        return;
      }

      if (field.meta) {
        // pandoc-types 的 MetaValue 采用 tagged 编码：{"t":"MetaString","c":"值"}
        metadata[field.key] = { t: 'MetaString', c: String(value) };
      } else {
        payload[field.key] = value;
      }
    });

    if (Object.keys(metadata).length) payload.metadata = metadata;

    // 把模板与图片统一放进 files 字段
    const files = {};
    if (assets.referenceDoc) {
      files[REF_KEY] = assets.referenceDoc.base64;
      payload['reference-doc'] = REF_KEY;
    }
    assets.images.forEach(function (img) { files[img.name] = img.base64; });
    if (Object.keys(files).length) payload.files = files;

    return payload;
  }

  /** 选项变化：持久化并请求刷新预览 */
  function onOptionChange() {
    persist();
    schedulePreview();
  }

  /** 请求刷新预览（preview 模块可能尚未初始化） */
  function schedulePreview() {
    if (ns.preview && typeof ns.preview.schedule === 'function') ns.preview.schedule();
  }

  /** 把当前表单值写入 localStorage */
  function persist() {
    try {
      const data = {};
      fieldControls().forEach(function (control) {
        data[control.dataset.field] =
          control.type === 'checkbox' ? control.checked : control.value;
      });
      localStorage.setItem(ns.CONFIG.settingsKey, JSON.stringify(data));
    } catch (e) {
      /* 隐私模式下可能写入失败，忽略即可 */
    }
  }

  /** 从 localStorage 恢复表单值 */
  function restore() {
    let data = null;
    try {
      const raw = localStorage.getItem(ns.CONFIG.settingsKey);
      data = raw ? JSON.parse(raw) : null;
    } catch (e) {
      data = null;
    }
    if (!data || typeof data !== 'object') return;

    fieldControls().forEach(function (control) {
      const key = control.dataset.field;
      if (!(key in data)) return;
      if (control.type === 'checkbox') control.checked = !!data[key];
      else control.value = data[key];
    });
  }

  /** 恢复为 config.js 中定义的默认值 */
  function resetToDefaults() {
    fieldControls().forEach(function (control) {
      const field = findField(control.dataset.field);
      if (!field) return;
      if (field.type === 'checkbox') control.checked = !!field.default;
      else if (field.type === 'number') control.value = field.default != null ? String(field.default) : '0';
      else if (field.type === 'select') control.value = field.default || '';
      else control.value = '';
    });
    persist();
  }

  /* ======================= 模板与图片资源 ======================= */

  /** 读取本地文件为 base64 资源对象 */
  function readAsAsset(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
        resolve({
          name: file.name,
          size: file.size,
          base64: ns.client.arrayBufferToBase64(reader.result)
        });
      };
      reader.onerror = function () { reject(new Error('读取文件失败：' + file.name)); };
      reader.readAsArrayBuffer(file);
    });
  }

  /** 图片重名时自动追加序号，同时避开模板固定路径名 */
  function uniqueImageName(name) {
    const used = assets.images.map(function (img) { return img.name; });
    if (used.indexOf(name) === -1 && name !== REF_KEY) return name;

    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    let index = 2;
    let candidate = base + '-' + index + ext;
    while (used.indexOf(candidate) !== -1) {
      index += 1;
      candidate = base + '-' + index + ext;
    }
    return candidate;
  }

  /** 选择 reference.docx 模板 */
  function onPickReference(fileList) {
    const file = fileList && fileList[0];
    if (!file) return;
    if (!/\.docx$/i.test(file.name)) {
      ns.bus.emit('toast', { type: 'warning', text: '请选择 .docx 格式的模板文件' });
      return;
    }
    readAsAsset(file).then(function (asset) {
      assets.referenceDoc = asset;
      updateReferenceState();
      ns.bus.emit('toast', { type: 'success', text: '已载入模板：' + asset.name });
    }).catch(function (err) {
      ns.bus.emit('toast', { type: 'error', text: err.message });
    });
  }

  /** 刷新模板状态提示 */
  function updateReferenceState() {
    const box = $('ref-state');
    const clearBtn = $('btn-clear-ref');
    if (assets.referenceDoc) {
      box.textContent = '已选择：' + assets.referenceDoc.name +
        '（' + ns.client.formatBytes(assets.referenceDoc.size) + '）';
      clearBtn.disabled = false;
    } else {
      box.textContent = '未选择模板，将使用 Pandoc 默认样式';
      clearBtn.disabled = true;
    }
  }

  /** 添加图片（支持多选） */
  function onPickImages(fileList) {
    const files = Array.prototype.slice.call(fileList || []).filter(function (f) {
      return /^image\//.test(f.type);
    });
    if (!files.length) return;

    Promise.all(files.map(readAsAsset)).then(function (list) {
      list.forEach(function (asset, i) {
        asset.name = uniqueImageName(asset.name);
        asset.dataUrl = 'data:' + (files[i].type || 'image/png') + ';base64,' + asset.base64;
        asset.inserted = false;   // 该图片的引用是否已经写进正文
        assets.images.push(asset);
      });
      renderImageList();
      // 自动把引用插入正文（可在“模板与图片”面板里关闭此行为）
      const autoIns = autoInsertEnabled();
      const refs = list.map(imageRef);
      if (autoIns && refs.length) insertImageRefs(list);
      ns.bus.emit('toast', {
        type: 'success',
        text: '已添加 ' + list.length + ' 张图片' + (autoIns
          ? '，引用已插入正文（位置不合适可在编辑器里调整）'
          : '，点击文件名可把引用插入正文')
      });
      schedulePreview();
    }).catch(function (err) {
      ns.bus.emit('toast', { type: 'error', text: err.message });
    });
  }

  /** 渲染图片列表；点击条目插入 Markdown 引用 */
  function renderImageList() {
    const list = $('image-list');
    list.innerHTML = '';
    $('btn-clear-img').disabled = assets.images.length === 0;

    if (!assets.images.length) {
      const li = document.createElement('li');
      li.className = 'muted';
      li.textContent = '尚未添加图片';
      list.appendChild(li);
      return;
    }

    assets.images.forEach(function (img) {
      const li = document.createElement('li');
      li.className = 'asset-item';
      li.title = '点击插入引用：![](' + img.name + ')';

      const thumb = document.createElement('img');
      thumb.src = img.dataUrl;
      thumb.alt = img.name;

      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = img.name;

      const size = document.createElement('span');
      size.className = 'size';
      size.textContent = ns.client.formatBytes(img.size);

      li.appendChild(thumb);
      li.appendChild(name);
      li.appendChild(size);

      // 状态徽标：提示该图片是否已经在正文里有引用
      const state = document.createElement('span');
      state.className = 'asset-item-state' + (img.inserted ? ' is-in' : '');
      state.textContent = img.inserted ? '已在正文' : '未插入';
      li.appendChild(state);
      li.addEventListener('click', function () {
        // 引用写法与发送给 pandoc 的文件名保持一致
        ns.bus.emit('insert-text', imageRef(img));
        img.inserted = true;
        renderImageList();
      });
      list.appendChild(li);
    });
  }

  /* ======================= 图片引用与标准模板 ======================= */

  /** 生成 Markdown 图片引用；文件名含空格、括号等字符时用 <...> 包裹 */
  function imageRef(img) {
    const name = String(img && img.name ? img.name : '');
    const caption = name.replace(/\.[^.]+$/, '');
    const needWrap = /[\s()<>]/.test(name);
    return '![' + caption + '](' + (needWrap ? '<' + name + '>' : name) + ')';
  }

  /** 把图片引用插入正文并标记状态（自动插入与手动点击共用同一套逻辑） */
  function insertImageRefs(list) {
    const items = (list || []).filter(Boolean);
    if (!items.length) return;
    ns.bus.emit('insert-text', items.map(imageRef).join('\n'));
    items.forEach(function (img) { img.inserted = true; });
    renderImageList();
  }

  /** 读取“添加后自动插入引用”开关（默认开启） */
  function autoInsertEnabled() {
    const box = $('auto-insert-images');
    if (box) return !!box.checked;
    try {
      const raw = localStorage.getItem(AUTO_INSERT_KEY);
      return raw === null ? true : raw === '1';
    } catch (e) {
      return true;
    }
  }

  /** 生成一份含 Pandoc 标准样式的 docx，供用户改字体/页边距/样式后当模板 */
  async function exportReferenceTemplate() {
    // docx 的 MIME 类型（与 pandoc-client 下载时保持一致）
    const docxMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const sample = [
      '# 标题 1 示例',
      '',
      '正文段落示例：请在这里修改字体、字号、行距与页边距。',
      '',
      '## 标题 2 示例',
      '',
      '- 列表项示例',
      '',
      '| 表头 | 说明 |',
      '| --- | --- |',
      '| 单元格 | 内容 |'
    ].join('\n');
    try {
      const result = await ns.client.convert({
        to: 'docx',
        from: 'markdown',
        text: sample,
        standalone: true
      });
      ns.client.downloadBlob(ns.client.base64ToBlob(result.output, docxMime),
        'pandoc-标准模板.docx');
      ns.bus.emit('toast', {
        type: 'success',
        text: '已生成 pandoc-标准模板.docx：用 Word 改好字体/页边距/样式后，再用“选择模板”载入'
      });
    } catch (err) {
      ns.bus.emit('toast', { type: 'error', text: '生成模板失败：' + err.message });
    }
  }

  /* ======================= 初始化 ======================= */

  function init() {
    renderForm();
    restore();                 // 恢复上次保存的选项（与 persist() 成对出现）
    updateReferenceState();
    renderImageList();

    const inputRef = $('file-ref');
    const inputImg = $('file-img');

    $('btn-open-ref').addEventListener('click', function () { inputRef.click(); });

    // “下载标准模板”按钮：生成含 Pandoc 标准样式的模板
    const btnMakeRef = $('btn-make-ref');
    if (btnMakeRef) btnMakeRef.addEventListener('click', exportReferenceTemplate);

    // “添加后自动插入引用”开关：从本地存储恢复，变化时保存
    const autoBox = $('auto-insert-images');
    if (autoBox) {
      try {
        const raw = localStorage.getItem(AUTO_INSERT_KEY);
        autoBox.checked = raw === null ? true : raw === '1';
      } catch (e) {
        autoBox.checked = true;
      }
      autoBox.addEventListener('change', function () {
        try { localStorage.setItem(AUTO_INSERT_KEY, autoBox.checked ? '1' : '0'); } catch (e) { /* 忽略 */ }
      });
    }
    inputRef.addEventListener('change', function () {
      onPickReference(inputRef.files);
      inputRef.value = '';
    });
    $('btn-clear-ref').addEventListener('click', function () {
      assets.referenceDoc = null;
      inputRef.value = '';
      updateReferenceState();
      ns.bus.emit('toast', { type: 'info', text: '已移除模板' });
    });

    $('btn-open-img').addEventListener('click', function () { inputImg.click(); });
    inputImg.addEventListener('change', function () {
      onPickImages(inputImg.files);
      inputImg.value = '';
    });
    $('btn-clear-img').addEventListener('click', function () {
      assets.images = [];
      inputImg.value = '';
      renderImageList();
      ns.bus.emit('toast', { type: 'info', text: '已移除全部图片' });
      schedulePreview();
    });
  }

  ns.options = {
    init: init,
    collectPayload: collectPayload,
    resetToDefaults: resetToDefaults,
    // 供 app.js / 控制台复用：生成标准模板、生成图片引用
    exportReferenceTemplate: exportReferenceTemplate,
    imageRef: imageRef,
    insertImageRefs: insertImageRefs,
    // 便于自测/调试：按文件列表添加图片（与“添加图片”按钮走同一套逻辑）
    addImages: onPickImages,
    refreshAssets: function () {
      updateReferenceState();
      renderImageList();
    }
  };
})(window.MD2DOCX);
