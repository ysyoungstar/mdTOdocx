#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
serve-pages.py —— 本地静态页面服务器（仅用于本工具的开发/自用场景）

为什么要单独写这个脚本：
  python -m http.server 不发送任何 Cache-Control 头，浏览器会对 index.html /
  *.css / *.js 做启发式缓存。前端改动后刷新页面时，浏览器可能仍在使用旧脚本
  （典型症状：新按钮看得到但点了没反应）。本脚本对所有静态响应强制 no-store，
  刷新即生效，无需手动强刷。

用法：
  python serve-pages.py [端口] [绑定IP]
  例如：python serve-pages.py 8080 127.0.0.1

说明：
  只读地提供脚本所在目录下的文件；不接收上传、不写文件。
"""

import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

# 以本脚本所在目录作为网站根目录
ROOT_DIR = os.path.dirname(os.path.abspath(__file__))


class NoCacheHandler(SimpleHTTPRequestHandler):
    """标准静态文件处理 + 强制禁用浏览器缓存。"""

    def __init__(self, *args, **kwargs):
        # directory 固定为脚本目录，避免受启动工作目录影响
        super().__init__(*args, directory=ROOT_DIR, **kwargs)

    def end_headers(self):
        """在响应头结束前追加禁缓存指令（关键点）。"""
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        """静默访问日志，避免服务窗口刷屏。"""
        return


def main():
    """解析参数并启动服务。"""
    port = 8080
    host = '127.0.0.1'

    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            print('invalid port: %s' % sys.argv[1])
            return 1
    if len(sys.argv) > 2:
        host = sys.argv[2]

    # 端口被快速重启时避免 TIME_WAIT 占用
    ThreadingHTTPServer.allow_reuse_address = True

    try:
        httpd = ThreadingHTTPServer((host, port), NoCacheHandler)
    except OSError as err:
        print('cannot bind %s:%d - %s' % (host, port, err))
        return 1

    print('page server (no-cache) listening on http://%s:%d/' % (host, port))
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
