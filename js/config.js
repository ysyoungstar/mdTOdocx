/* =============================================================
   config.js —— 全局配置与选项元数据（无构建，直接挂在 window 上）
   ============================================================= */
window.MD2DOCX = window.MD2DOCX || {};

(function (ns) {
  'use strict';

  /** 基础运行配置 */
  ns.CONFIG = {
    // 本机 pandoc server 地址（由 start-server.bat 启动）
    serverBase: 'http://127.0.0.1:3030',
    // 本机桥接服务地址（HTML / DOCX → Markdown，由 convert-server.py 提供）
    bridgeBase: 'http://127.0.0.1:3040',
    // 反向转换：单个文件体积上限（MB，超过会提示）
    maxUploadMB: 30,
    // 预览防抖时间（毫秒）
    previewDebounce: 500,
    // localStorage 键名
    settingsKey: 'md2docx.settings.v1',
    reverseSettingsKey: 'md2docx.reverse.settings.v1',
    historyKey: 'md2docx.history.v1',
    themeKey: 'md2docx.theme',
    // 历史记录上限
    maxHistory: 12
  };

  /** Markdown 输入格式候选（值即 pandoc 的 from 参数） */
  ns.INPUT_FORMATS = [
    { value: 'markdown', label: 'markdown（Pandoc 默认扩展）' },
    { value: 'gfm', label: 'gfm（GitHub 风格）' },
    { value: 'commonmark', label: 'commonmark' },
    { value: 'markdown_strict', label: 'markdown_strict（原始 Markdown）' },
    { value: 'markdown+emoji+tex_math_dollars', label: 'markdown + emoji + $公式$' }
  ];

  /** 代码高亮样式（pandoc --highlight-style 支持的值） */
  ns.HIGHLIGHT_STYLES = [
    'pygments', 'tango', 'espresso', 'zenburn',
    'kate', 'monochrome', 'breezedark', 'haddock', 'atom-one'
  ];

  /**
   * 选项面板的元数据定义：
   * key      —— 最终写入 pandoc 请求体的字段名
   * meta     —— 为 true 时写入 metadata 子对象
   * type     —— text | number | checkbox | select | textarea
   */
  ns.OPTION_GROUPS = [
    {
      id: 'docinfo',
      title: '文档信息',
      fields: [
        { key: 'title', label: '文档标题', type: 'text', meta: true, placeholder: '留空则不设置' },
        { key: 'subtitle', label: '副标题', type: 'text', meta: true, placeholder: '留空则不设置' },
        { key: 'author', label: '作者', type: 'text', meta: true, placeholder: '多个作者用分号分隔' },
        { key: 'date', label: '日期', type: 'text', meta: true, placeholder: '留空则由 Pandoc 使用当天日期' }
      ]
    },
    {
      id: 'structure',
      title: '文档结构',
      fields: [
        // 注意：pandoc server 的字段名与 defaults 文件一致，
        // 生成目录的字段是 table-of-contents（toc 会被静默忽略）
        { key: 'table-of-contents', label: '生成目录', type: 'checkbox', default: false },
        { key: 'toc-depth', label: '目录深度', type: 'number', default: 3, min: 1, max: 6 },
        { key: 'number-sections', label: '章节自动编号', type: 'checkbox', default: false },
        { key: 'shift-heading-level-by', label: '标题层级偏移', type: 'number', default: 0, min: -3, max: 3 }
      ]
    },
    {
      id: 'parse',
      title: '解析与排版',
      fields: [
        { key: 'from', label: '输入格式', type: 'select', options: ns.INPUT_FORMATS, default: 'markdown' },
        {
          key: 'highlight-style',
          label: '代码高亮样式',
          type: 'select',
          default: 'tango',
          options: ns.HIGHLIGHT_STYLES.map(function (s) { return { value: s, label: s }; })
        },
        {
          key: 'default-image-extension',
          label: '图片默认扩展名',
          type: 'select',
          default: '',
          options: [
            { value: '', label: '自动（不指定）' },
            { value: '.png', label: '.png' },
            { value: '.jpg', label: '.jpg' },
            { value: '.svg', label: '.svg' }
          ]
        },
        { key: 'columns', label: '每行字符宽度', type: 'number', default: 72, min: 20, max: 300, hint: '影响 HTML 预览的换行宽度' }
      ]
    },
    {
      id: 'advanced',
      title: '高级',
      fields: [
        {
          key: '__extraJson',
          label: '额外请求字段（JSON）',
          type: 'textarea',
          hint: '会合并进 pandoc 请求体，例如 {"wrap":"none"}；留空表示不使用'
        }
      ]
    }
  ];
  /** 反向转换（HTML / DOCX → Markdown）可选的输出风格，值即 pandoc 的 to 参数 */
  ns.MARKDOWN_OUTPUT_FORMATS = [
    { value: 'markdown', label: 'markdown（Pandoc 默认）' },
    { value: 'gfm', label: 'gfm（GitHub 风格，管道表格）' },
    { value: 'commonmark', label: 'commonmark' },
    { value: 'markdown_strict', label: 'markdown_strict（原始 Markdown）' }
  ];

  /**
   * 反向转换的选项元数据（结构与 OPTION_GROUPS 一致）：
   * 其中 to 用于请求的 to 字段，其余字段会放进请求的 options 对象。
   */
  ns.REVERSE_OPTION_GROUPS = [
    {
      id: 'rev-output',
      title: '输出格式',
      fields: [
        { key: 'to', label: 'Markdown 风格', type: 'select', options: ns.MARKDOWN_OUTPUT_FORMATS, default: 'markdown' },
        {
          key: 'wrap',
          label: '换行方式',
          type: 'select',
          default: 'none',
          options: [
            { value: 'none', label: '不自动换行（推荐，一段一行）' },
            { value: 'auto', label: '按宽度自动换行' },
            { value: 'preserve', label: '保留源文件换行' }
          ]
        },
        { key: 'columns', label: '自动换行宽度', type: 'number', default: 100, min: 20, max: 300, hint: '仅“自动换行”时生效' },
        {
          key: 'markdown-headings',
          label: '标题风格',
          type: 'select',
          default: 'atx',
          options: [
            { value: 'atx', label: 'ATX（# 标题）' },
            { value: 'setext', label: 'Setext（=== / ---）' }
          ]
        },
        { key: 'shift-heading-level-by', label: '标题层级偏移', type: 'number', default: 0, min: -3, max: 3 }
      ]
    },
    {
      id: 'rev-docx',
      title: 'DOCX 专用',
      fields: [
        {
          key: 'track-changes',
          label: '修订标记处理',
          type: 'select',
          default: 'accept',
          options: [
            { value: 'accept', label: '接受修订（推荐）' },
            { value: 'reject', label: '拒绝修订' },
            { value: 'all', label: '全部保留（含修订标记）' }
          ]
        },
        { key: 'strip-comments', label: '去掉批注', type: 'checkbox', default: false }
      ]
    },
    {
      id: 'rev-advanced',
      title: '高级',
      fields: [
        {
          key: '__extraArgs',
          label: '额外命令行参数',
          type: 'textarea',
          hint: '会原样追加给 pandoc，例如 --reference-links；留空表示不使用'
        }
      ]
    }
  ];

  /** 简单事件总线：用于模块间解耦（如“点击图片名插入引用”） */
  ns.bus = {
    handlers: {},
    on: function (type, fn) {
      (this.handlers[type] = this.handlers[type] || []).push(fn);
    },
    emit: function (type, payload) {
      (this.handlers[type] || []).forEach(function (fn) { fn(payload); });
    }
  };
})(window.MD2DOCX);
