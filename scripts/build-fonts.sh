#!/usr/bin/env bash
#
# build-fonts.sh — 生成站点自托管的 Maple Mono 子集（woff2）。
#
#   bash scripts/build-fonts.sh
#
# 产物（都在 blog/public/fonts/，浏览器按需下载）：
#   maple-mono-nf-latin.woff2     拉丁 + 标点 + 箭头/制表/几何/盲文，约 45 KB
#   maple-mono-nf-cn-cjk.woff2    GB2312 全集（7445 汉字）+ 全角标点，约 1.7 MB
#
# 为什么要拆两份：代码块里绝大多数页面只用到拉丁字符，45 KB 那份先到先显示；
# root.css 的 @font-face 用 unicode-range 声明中文那份的覆盖范围，浏览器只
# 在页面上真的出现汉字时才去取 1.7 MB —— 不需要任何 JavaScript。
#
# 依赖：fonttools（pyftsubset）与 brotli
#   python3 -m pip install --user fonttools brotli
#
# 字体来源：Maple Mono NF CN（SIL OFL 1.1），
#   https://github.com/subframe7536/maple-font
#   可用 MAPLE_TTF 指定其它路径的 TTF/OTF。
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="$ROOT/blog/public/fonts"
SRC=${MAPLE_TTF:-/usr/share/fonts/maple-mono-nf-cn/MapleMono-NF-CN-Regular.ttf}
PYFTSUBSET=${PYFTSUBSET:-pyftsubset}

# 代码里会出现的非汉字字符：ASCII、Latin-1、通用标点、货币、类字母符号、
# 箭头、数学运算符、制表符与方块、几何图形、盲文（进度条之类）。
LATIN_RANGES="U+0020-007E,U+00A0-00FF,U+2000-206F,U+20A0-20BF,U+2100-214F,U+2190-21FF,U+2200-22FF,U+2500-257F,U+25A0-25FF,U+2600-27BF,U+2800-28FF"
# 汉字之外还要全角标点（《》，。：等）和 CJK 标点（、。「」等）。
CJK_PUNCT="U+3000-303F,U+FF00-FFEF"

if [ ! -f "$SRC" ]; then
  echo "找不到字体文件：$SRC" >&2
  echo "先安装 Maple Mono NF CN，或用 MAPLE_TTF=/path/to/MapleMono-NF-CN-Regular.ttf 指定。" >&2
  exit 1
fi

if ! command -v "$PYFTSUBSET" >/dev/null 2>&1; then
  echo "缺少 pyftsubset：python3 -m pip install --user fonttools brotli" >&2
  exit 1
fi

mkdir -p "$OUT"
CHARS=$(mktemp)
trap 'rm -f "$CHARS"' EXIT

# GB2312 全集：把两字节编码逐段解码，得到 7445 个汉字（含次常用字）。
python3 - "$CHARS" <<'PY'
import sys

chars = set()
for high in range(0xA1, 0xF8):
    for low in range(0xA1, 0xFF):
        try:
            decoded = bytes([high, low]).decode("gb2312")
        except UnicodeDecodeError:
            continue
        if len(decoded) == 1:
            chars.add(decoded)
open(sys.argv[1], "w", encoding="utf-8").write("".join(sorted(chars)))
print(f"[fonts] GB2312 汉字：{len(chars)}")
PY

# --layout-features='*' 保留连字（calt 等），否则 Maple Mono 的 ->、!= 等
# 编程连字会消失。--drop-tables+=meta 只是去掉一个用不上的元数据表。
"$PYFTSUBSET" "$SRC" \
  --unicodes="$LATIN_RANGES" \
  --layout-features='*' --drop-tables+=meta \
  --flavor=woff2 \
  --output-file="$OUT/maple-mono-nf-latin.woff2"

"$PYFTSUBSET" "$SRC" \
  --text-file="$CHARS" \
  --unicodes="$CJK_PUNCT" \
  --layout-features='*' --drop-tables+=meta \
  --flavor=woff2 \
  --output-file="$OUT/maple-mono-nf-cn-cjk.woff2"

echo "[fonts] 已生成："
ls -lh "$OUT"/*.woff2
