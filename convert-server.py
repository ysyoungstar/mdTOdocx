#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
convert-server.py —— mdTOdocx 本机桥接服务（HTML / DOCX → Markdown）

为什么需要它：
    浏览器页面（127.0.0.1:8080）既不能读取本地任意文件，也不能把 pandoc 提取出来的
    图片写回磁盘。因此这里提供一个只监听回环地址（127.0.0.1）的小服务，用 Python
    标准库调用本机 pandoc 命令行完成转换，并把 docx 内嵌图片导出到本地文件夹。

接口：
    GET  /version   返回 {"bridge": "1.0", "pandoc": "3.12.1"}
    GET  /health    返回 {"ok": true}
    POST /convert   请求体为 JSON，见 run_convert() 的说明

安全约定：
    1. 只绑定 127.0.0.1，不对外提供任何服务；
    2. 所有产物都写在 --output-dir 指定目录（默认脚本同级 output/）内；
    3. 用户提供的文件名一律做安全化处理，防止路径穿越；
    4. 只调用固定形式的 pandoc 命令，绝不执行文档里的脚本或代码。
"""

import argparse
import base64
import binascii
import io
import json
import os
import re
import shutil
import subprocess
import sys
import time
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# ---------------------------------------------------------------- 常量配置

BRIDGE_VERSION = '1.0'
DEFAULT_PORT = 3040
DEFAULT_TIMEOUT = 120
MAX_BODY_BYTES = 80 * 1024 * 1024          # 单次请求体上限（base64 膨胀后仍有余量）
MAX_MEDIA_BYTES = 200 * 1024 * 1024        # 导出图片总量上限

# 允许的输入来源
ALLOWED_SOURCES = ('docx', 'html')

# 允许的输出格式：markdown 家族（可带扩展，例如 markdown+pipe_tables）
TO_PATTERN = re.compile(
    r'^(markdown|markdown_strict|markdown_phpextra|markdown_mmd|'
    r'gfm|commonmark|commonmark_x)([+-][a-z0-9_+-]+)*$'
)

# 允许透传给 pandoc 的选项白名单
VALUE_OPTIONS = {                          # 取值必须在候选列表中
    'wrap': ('--wrap', ('none', 'auto', 'preserve')),
    'markdown-headings': ('--markdown-headings', ('atx', 'setext')),
    'track-changes': ('--track-changes', ('accept', 'reject', 'all')),
}
INT_OPTIONS = {                            # 整数取值 + 范围
    'columns': ('--columns', 1, 1000),
    'shift-heading-level-by': ('--shift-heading-level-by', -5, 5),
}
FLAG_OPTIONS = {                           # 布尔开关
    'strip-comments': '--strip-comments',
}

# 不允许用户通过“额外参数”覆盖的关键参数（避免破坏输出约定）
EXTRA_ARGS_BLACKLIST = ('-o', '--output', '--extract-media')


class BridgeError(Exception):
    """业务错误：错误信息会原样返回给页面显示。"""


# ---------------------------------------------------------------- 基础工具

def parse_args(argv=None):
    """解析命令行参数。"""
    parser = argparse.ArgumentParser(
        description='mdTOdocx bridge server (HTML/DOCX -> Markdown)')
    parser.add_argument('--port', type=int, default=DEFAULT_PORT,
                        help='监听端口，默认 3040')
    parser.add_argument('--timeout', type=int, default=DEFAULT_TIMEOUT,
                        help='单次转换超时秒数，默认 120')
    parser.add_argument('--output-dir', default='',
                        help='输出根目录，默认脚本同级的 output')
    parser.add_argument('--host', default='127.0.0.1',
                        help='监听地址，默认仅回环 127.0.0.1')
    return parser.parse_args(argv)


def base_dir():
    """脚本所在目录（直接运行与打包均适用）。"""
    return os.path.dirname(os.path.abspath(__file__))


def pandoc_path():
    """返回本机 pandoc 可执行文件路径，找不到时返回空字符串。"""
    return shutil.which('pandoc') or ''


def pandoc_version():
    """读取 pandoc 版本号（取 --version 第一行末段），失败返回空串。"""
    exe = pandoc_path()
    if not exe:
        return ''
    try:
        out = subprocess.run([exe, '--version'], stdout=subprocess.PIPE,
                             stderr=subprocess.DEVNULL, timeout=15)
        first = out.stdout.decode('utf-8', 'replace').splitlines()[0]
        return first.split()[-1].strip()
    except Exception:                      # 版本探测失败不影响主流程
        return ''


def sanitize_name(name):
    """把用户文件名安全化为可用的名字（去掉路径与非法字符）。"""
    name = os.path.basename(str(name or '').replace('\\', '/'))
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', name).strip(' .')
    if not name:
        name = 'document'
    stem, ext = os.path.splitext(name)
    stem = stem[:60] or 'document'
    return stem + ext[:10]


def make_work_dir(raw_name, output_root):
    """为一次转换创建独立工作目录：<output_root>/<名字>-<时间戳>[-n]/。"""
    safe = sanitize_name(raw_name)
    stamp = time.strftime('%Y%m%d-%H%M%S')
    base = os.path.join(output_root, '{0}-{1}'.format(safe, stamp))
    candidate = base
    index = 2
    while os.path.exists(candidate):
        candidate = '{0}-{1}'.format(base, index)
        index += 1
    os.makedirs(os.path.join(candidate, 'media'), exist_ok=True)
    return candidate


def split_extra_args(text):
    """把“额外命令行参数”文本拆成列表（支持用引号包裹含空格的参数）。"""
    tokens = re.findall(r'"([^"]*)"|\'([^\']*)\'|(\S+)', str(text or ''))
    return [a or b or c for a, b, c in tokens]


def build_option_args(options):
    """把页面传来的选项对象翻译成 pandoc 命令行参数（白名单校验）。"""
    args = []
    if not isinstance(options, dict):
        return args

    for key, (flag, allowed) in VALUE_OPTIONS.items():
        value = options.get(key)
        if value in (None, ''):
            continue
        value = str(value)
        if value not in allowed:
            raise BridgeError('选项 {0} 的取值不合法：{1}'.format(key, value))
        args.append('{0}={1}'.format(flag, value))

    for key, (flag, low, high) in INT_OPTIONS.items():
        value = options.get(key)
        if value in (None, ''):
            continue
        try:
            number = int(value)
        except (TypeError, ValueError):
            raise BridgeError('选项 {0} 必须是整数'.format(key))
        if number < low or number > high:
            raise BridgeError('选项 {0} 超出范围 {1}~{2}'.format(key, low, high))
        # 标题层级偏移为 0 时无需传参
        if number != 0 or key == 'columns':
            args.append('{0}={1}'.format(flag, number))

    for key, flag in FLAG_OPTIONS.items():
        if options.get(key):
            args.append(flag)

    # 额外参数：过滤关键参数后原样追加，便于临时试验其它 pandoc 开关
    for token in split_extra_args(options.get('__extraArgs')):
        if token in EXTRA_ARGS_BLACKLIST:
            continue
        args.append(token)

    return args


def run_pandoc(cmd, work_dir, timeout):
    """执行 pandoc，返回 (返回码, stdout 文本, stderr 文本)。"""
    creationflags = 0
    if os.name == 'nt':
        creationflags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
    proc = subprocess.run(
        cmd, cwd=work_dir, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        timeout=timeout, creationflags=creationflags,
    )
    return (proc.returncode,
            proc.stdout.decode('utf-8', 'replace'),
            proc.stderr.decode('utf-8', 'replace'))


def collect_media(work_dir, keep_names):
    """收集工作目录里的导出文件（图片等），返回 (列表, 总字节数)。"""
    items = []
    total = 0
    for root, _dirs, files in os.walk(work_dir):
        for name in files:
            full = os.path.join(root, name)
            rel = os.path.relpath(full, work_dir).replace('\\', '/')
            if rel in keep_names:            # 输入副本与转换结果不算媒体
                continue
            size = os.path.getsize(full)
            total += size
            if total > MAX_MEDIA_BYTES:
                return items, total
            with open(full, 'rb') as fh:
                data = fh.read()
            items.append({
                'name': rel,
                'base64': base64.b64encode(data).decode('ascii'),
                'size': size,
            })
    return items, total


def build_zip(items):
    """把导出文件打包成 zip，返回 base64 字符串（无文件时返回空串）。"""
    if not items:
        return ''
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
        for item in items:
            zf.writestr(item['name'], base64.b64decode(item['base64']))
    return base64.b64encode(buffer.getvalue()).decode('ascii')


# ---------------------------------------------------------------- 核心转换

def run_convert(payload, timeout, output_root):
    """
    执行一次 HTML/DOCX → Markdown 转换。

    请求体字段：
        source   'docx' | 'html'                        必填
        data     docx 为 base64 字符串；html 为源码文本   必填
        filename 原始文件名（仅用于输出目录命名），可选
        to       输出格式，默认 markdown
        options  转换选项对象（wrap / columns / markdown-headings /
                 track-changes / strip-comments / shift-heading-level-by /
                 __extraArgs）

    返回字典：output（Markdown 文本）、mediaFiles（导出的图片）、
    zipBase64（图片打包）、outDir（本地输出目录）、messages（pandoc 警告）。
    """
    source = str(payload.get('source') or '').strip().lower()
    if source not in ALLOWED_SOURCES:
        raise BridgeError('source 只能是 docx 或 html')

    to_format = str(payload.get('to') or 'markdown').strip()
    if not TO_PATTERN.match(to_format):
        raise BridgeError('不支持的输出格式：' + to_format)

    data = payload.get('data')
    if not isinstance(data, str) or not data.strip():
        raise BridgeError('缺少 data 字段（docx 需 base64，html 需源码文本）')

    exe = pandoc_path()
    if not exe:
        raise BridgeError('未找到 pandoc，请先安装并确保它在 PATH 中')

    raw_name = payload.get('filename') or ('input.' + source)
    work_dir = make_work_dir(raw_name, output_root)

    # 1) 源文件落盘（统一使用固定文件名，避开中文与编码问题）
    input_name = 'input.' + source
    input_path = os.path.join(work_dir, input_name)
    if source == 'docx':
        try:
            blob = base64.b64decode(data, validate=False)
        except (binascii.Error, ValueError):
            raise BridgeError('docx 内容不是合法的 base64 数据')
        if not blob:
            raise BridgeError('docx 内容为空')
        with open(input_path, 'wb') as fh:
            fh.write(blob)
    else:
        with open(input_path, 'w', encoding='utf-8', newline='\n') as fh:
            fh.write(data)

    # 2) 执行 pandoc：--extract-media=. 让图片落到 media/ 子目录，
    #    生成的 Markdown 引用正好是 media/xxx.png，与磁盘结构一致
    cmd = [exe, input_name, '-f', source, '-t', to_format,
           '-o', 'output.md', '--extract-media=.']
    cmd.extend(build_option_args(payload.get('options')))

    started = time.time()
    try:
        code, _out, err = run_pandoc(cmd, work_dir, timeout)
    except subprocess.TimeoutExpired:
        raise BridgeError('转换超时（{0} 秒），文档可能过大'.format(timeout))

    messages = [{'verbosity': 'WARNING', 'message': line}
                for line in err.splitlines() if line.strip()]

    # 3) 读取转换结果
    output_path = os.path.join(work_dir, 'output.md')
    if not os.path.exists(output_path):
        detail = '；'.join(m['message'] for m in messages) or 'pandoc 未产生输出'
        raise BridgeError('转换失败：' + detail)

    with open(output_path, 'r', encoding='utf-8', errors='replace') as fh:
        output = fh.read()

    media, media_bytes = collect_media(work_dir, {input_name, 'output.md'})
    return {
        'ok': True,
        'output': output,
        'mediaFiles': media,
        'zipBase64': build_zip(media),
        'outDir': work_dir,
        'messages': messages,
        'pandocExitCode': code,
        'mediaBytes': media_bytes,
        'ms': int((time.time() - started) * 1000),
    }


# ---------------------------------------------------------------- HTTP 服务

class BridgeHandler(BaseHTTPRequestHandler):
    """只提供 /version、/health、/convert 三个端点。"""

    server_version = 'md2docx-bridge/' + BRIDGE_VERSION
    protocol_version = 'HTTP/1.1'
    timeout = 600                              # 单个连接的空闲超时

    def log_message(self, fmt, *args):
        """精简日志：写到标准输出，方便在服务窗口里查看（管道断开时忽略）。"""
        try:
            sys.stdout.write('[bridge] {0} {1}\n'.format(
                self.address_string(), fmt % args))
            sys.stdout.flush()
        except Exception:                  # 输出不可用时不能影响响应发送
            pass

    # ---- 响应辅助 ----
    def _send_cors(self):
        # 页面运行在 8080，属于跨域；本服务只绑回环地址，因此允许任意来源
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def _send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self._send_cors()
        self.end_headers()
        self.wfile.write(body)

    # ---- 路由 ----
    def do_OPTIONS(self):
        """跨域预检请求。"""
        self.send_response(204)
        self._send_cors()
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_GET(self):
        path = self.path.split('?')[0].rstrip('/') or '/'
        if path in ('/', '/health'):
            self._send_json({'ok': True, 'bridge': BRIDGE_VERSION,
                             'pandoc': pandoc_version()})
        elif path == '/version':
            self._send_json({'bridge': BRIDGE_VERSION, 'pandoc': pandoc_version()})
        else:
            self._send_json({'error': 'not found'}, 404)

    def do_POST(self):
        path = self.path.split('?')[0].rstrip('/') or '/'
        if path != '/convert':
            self._send_json({'error': 'not found'}, 404)
            return
        try:
            payload = self._read_json()
            cfg = self.server.config            # 由 main() 注入
            result = run_convert(payload, cfg['timeout'], cfg['output_root'])
            self._send_json(result)
        except BridgeError as err:
            self._send_json({'ok': False, 'error': str(err)})
        except Exception as err:                # 兜底：任何异常都转成可读错误
            self._send_json({'ok': False,
                             'error': '服务内部错误：{0}'.format(err)})

    def _read_json(self):
        """读取并解析请求体（带体积保护）。"""
        try:
            length = int(self.headers.get('Content-Length') or 0)
        except ValueError:
            raise BridgeError('请求头 Content-Length 不合法')
        if length <= 0:
            raise BridgeError('请求体为空')
        if length > MAX_BODY_BYTES:
            raise BridgeError('请求体过大（上限 {0} MB）'.format(
                MAX_BODY_BYTES // 1024 // 1024))
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode('utf-8'))
        except (UnicodeDecodeError, ValueError):
            raise BridgeError('请求体不是合法的 JSON')
        if not isinstance(data, dict):
            raise BridgeError('请求体必须是 JSON 对象')
        return data


def main(argv=None):
    """启动桥接服务。"""
    args = parse_args(argv)
    output_root = args.output_dir or os.path.join(base_dir(), 'output')
    os.makedirs(output_root, exist_ok=True)

    server = ThreadingHTTPServer((args.host, args.port), BridgeHandler)
    server.daemon_threads = True
    server.config = {'timeout': max(5, args.timeout), 'output_root': output_root}

    print('[bridge] md2docx bridge {0} on http://{1}:{2}'.format(
        BRIDGE_VERSION, args.host, args.port))
    print('[bridge] pandoc: {0}'.format(pandoc_version() or 'NOT FOUND'))
    print('[bridge] output dir: {0}'.format(output_root))
    sys.stdout.flush()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('[bridge] stopped by keyboard interrupt')
    finally:
        server.server_close()
    return 0


if __name__ == '__main__':
    sys.exit(main())

FLAG_OPTIONS = {                           # 布尔开关
    'strip-comments': '--strip-comments',
}

# 不允许用户通过“额外参数”覆盖的关键参数（避免破坏输出约定）
EXTRA_ARGS_BLACKLIST = ('-o', '--output', '--extract-media')


class BridgeError(Exception):
    """业务错误：错误信息会原样返回给页面显示。"""
