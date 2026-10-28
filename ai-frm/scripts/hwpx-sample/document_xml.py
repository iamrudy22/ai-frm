"""Build native-flow HWPX parts from immutable semantic blocks.

The Apache-2.0 python-hwpx 6.10.0 skeleton supplies section/header defaults.
Picture child order and one-cell table attributes follow its objects.py,
table.py and _document_primitives.py (see bundled license/provenance).
No line-position cache, financial calculation, filesystem or network is used.
Actual MYBOX layout acceptance is a separate, mandatory check.
"""
from __future__ import annotations

from collections.abc import Mapping
import copy
import io
import math
import re
import struct
import zlib
import xml.etree.ElementTree as ET

from package_io import NS, validate_parts
from report_projection import ImageBlock, MetricBlock, ReportDocument, SummaryBlock, TextBlock

# Semantic typography; no per-PDF-line geometry or fixed line-height estimates.
_STYLES = {
    'title': (16, True, 'CENTER', 0, 8),
    'date': (10, False, 'RIGHT', 0, 10),
    'body': (11, False, 'LEFT', 0, 6),
    'formula': (9, False, 'LEFT', 0, 8),
    'summary': (11, True, 'LEFT', 0, 0),
    'heading': (12, True, 'LEFT', 10, 6),
}
# Point values follow the existing report print tokens (CSS px × 72/96).
# Keep probe styles above unchanged: compatibility probes are byte-stable.
_REPORT_STYLES = {
    # Reserve bottom padding9pt plus the original header gap2(8px=6pt) in flow.
    'title': (18, True, 'CENTER', 0, 15),
    'date': (12, False, 'RIGHT', 0, 6),
    'body': (13, False, 'LEFT', 0, 3),
    'formula': (9, False, 'LEFT', 0, 3),
    'summary': (14, True, 'LEFT', 0, 0),
    'heading': (13.5, True, 'LEFT', 6, 3),
    'reference-header': (13, False, 'LEFT', 0, 6),
    'metric-body': (13, False, 'LEFT', 0, 3),
    'metric-note': (9, False, 'LEFT', 0, 3),
    'footer': (9, False, 'CENTER', 0, 0),
}
_TONES = {'ink': '#171717', 'blue': '#0088BF', 'crisis': '#FF3B16'}
_INLINE_POSITION = {
    'treatAsChar': '1', 'affectLSpacing': '0', 'flowWithText': '1',
    'allowOverlap': '0', 'holdAnchorAndSO': '0', 'vertRelTo': 'PARA',
    'horzRelTo': 'COLUMN', 'vertAlign': 'TOP', 'horzAlign': 'LEFT',
    'vertOffset': '0', 'horzOffset': '0',
}


def pt_to_hwp(value: float) -> int:
    value = float(value)
    if not math.isfinite(value) or value < 0:
        raise ValueError('point value must be finite and non-negative')
    return round(value * 100)


def mm_to_hwp(value: float) -> int:
    value = float(value)
    if not math.isfinite(value) or value < 0:
        raise ValueError('millimetre value must be finite and non-negative')
    return round(value * 7200 / 25.4)


def _tag(name):
    prefix, local = name.split(':')
    return '{'+NS[prefix]+'}'+local


def _add(parent, name, attrs=None):
    return ET.SubElement(parent, _tag(name), {key: str(value) for key, value in (attrs or {}).items()})


def _xml(root, namespaces):
    payload = ET.tostring(root, encoding='utf-8')
    end = payload.index(b'>')
    missing = [(' xmlns:'+prefix+'="'+uri+'"').encode() for prefix, uri in namespaces.items()
               if ('xmlns:'+prefix+'=').encode() not in payload[:end]]
    return b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'+payload[:end]+b''.join(missing)+payload[end:]


def _require_valid(parts):
    issues = validate_parts(parts)
    if issues:
        raise ValueError('; '.join(i.part+': '+i.code+': '+i.message for i in issues))


def _append_text(run, text):
    if not isinstance(text, str):
        raise ValueError('native text must be a string')
    chunks = text.split('\n')
    target = _add(run, 'hp:t')
    target.text = chunks[0]
    for chunk in chunks[1:]:
        _add(target, 'hp:lineBreak').tail = chunk


def _formats(header, report=False):
    """Clone valid header references; append distinct semantic formats."""
    chars = header.find('.//hh:charProperties', NS)
    paras = header.find('.//hh:paraProperties', NS)
    if chars is None or paras is None or len(chars) < 2 or not len(paras):
        raise ValueError('template lacks required base text formats')
    for font in header.findall('.//hh:font', NS):
        font.set('face', 'Dotum' if report else '맑은 고딕')
    char_base, para_base = chars[1], paras[0]
    next_char = max(int(e.get('id')) for e in chars)+1
    next_para = max(int(e.get('id')) for e in paras)+1
    result = {}
    styles = _REPORT_STYLES if report else _STYLES
    for offset, (style, (size, bold, align, before, after)) in enumerate(styles.items()):
        char, para = copy.deepcopy(char_base), copy.deepcopy(para_base)
        char_id, para_id = str(next_char+offset), str(next_para+offset)
        char.set('id', char_id)
        char.set('height', str(pt_to_hwp(size)))
        char.set('textColor', _TONES['blue' if style == 'reference-header' else 'ink'] if report else '#000000')
        char.find('hh:fontRef', NS).attrib = dict.fromkeys(('hangul','latin','hanja','japanese','other','symbol','user'), '0')
        for child in char.findall('hh:bold', NS):
            char.remove(child)
        if bold:
            before_bold = {_tag('hh:'+name) for name in ('fontRef','ratio','spacing','relSz','offset','italic')}
            position = next((i for i, child in enumerate(char) if child.tag not in before_bold), len(char))
            char.insert(position, ET.Element(_tag('hh:bold')))
        para.set('id', para_id)
        para.set('snapToGrid', '0')
        para.find('hh:align', NS).set('horizontal', align)
        breaks = para.find('hh:breakSetting', NS)
        breaks.set('keepWithNext', '1' if style in ('title','heading','metric-body','metric-note') else '0')
        breaks.set('keepLines', '1')
        breaks.set('pageBreakBefore', '0')
        # Preserve Hancom's compatibility-unit convention: hp:default
        # margins are twice hp:case; a direct hh:margin uses the given value.
        fallback_margins = para.findall('hp:switch/hp:default/hh:margin', NS)
        for margin in para.findall('.//hh:margin', NS):
            scale = 2 if margin in fallback_margins else 1
            for item in margin:
                local = item.tag.split('}')[-1]
                item.set('value', str(pt_to_hwp(before if local == 'prev' else after if local == 'next' else 0)*scale))
                item.set('unit', 'HWPUNIT')
        for spacing in para.findall('.//hh:lineSpacing', NS):
            spacing.attrib = {'type': 'PERCENT', 'value': '150' if report else '160', 'unit': 'HWPUNIT'}
        chars.append(char)
        paras.append(para)
        result[style] = (char_id, para_id)
    if report:
        for style in ('summary', 'metric-body'):
            for tone in ('blue', 'crisis'):
                source_id, para_id = result[style]
                char = copy.deepcopy(next(entry for entry in chars if entry.get('id') == source_id))
                char_id = str(max(int(entry.get('id')) for entry in chars)+1)
                char.set('id', char_id)
                char.set('textColor', _TONES[tone])
                chars.append(char)
                result[style+':'+tone] = (char_id, para_id)
        for style, sides, color, weight in (
            ('title', ('top', 'bottom'), '#0088BF', '1.0 mm'),
            ('reference-header', ('bottom',), '#528FC6', '0.12 mm'),
        ):
            border_id = _paragraph_border(header, sides, color, weight)
            para_id = result[style][1]
            prop = next(entry for entry in paras if entry.get('id') == para_id)
            border = prop.find('hh:border', NS)
            border.set('borderFillIDRef', border_id)
            if style == 'title':
                # Original paddingBlock3 = spacing3(12px) × 72/96 = 9pt inside each rule.
                border.set('offsetTop', '900')
                border.set('offsetBottom', '900')
    chars.set('itemCnt', str(len(chars)))
    paras.set('itemCnt', str(len(paras)))
    return result


def _paragraph_border(header, sides, color, weight):
    fills = header.find('.//hh:borderFills', NS)
    if fills is None or not len(fills):
        raise ValueError('template lacks border definitions')
    entry = copy.deepcopy(fills[0])
    identifier = str(max(int(e.get('id')) for e in fills)+1)
    entry.set('id', identifier)
    for side in ('left', 'right', 'top', 'bottom'):
        edge = entry.find('hh:'+side+'Border', NS)
        edge.attrib = {'type': 'SOLID' if side in sides else 'NONE', 'width': weight, 'color': color}
    fills.append(entry)
    fills.set('itemCnt', str(len(fills)))
    return identifier


def _validate_png_pixels(compressed, width, height, channels, role):
    """Bounded validation of 8-bit, non-interlaced native PNG scanlines."""
    row_size = width * channels + 1
    expected_size = row_size * height
    if expected_size > 64 * 1024 * 1024:
        raise ValueError('PNG decoded image exceeds 64 MiB limit '+role)
    decoder = zlib.decompressobj()
    try:
        pixels = decoder.decompress(compressed, expected_size + 1)
    except zlib.error as error:
        raise ValueError('malformed PNG deflate data '+role) from error
    if (len(pixels) != expected_size or not decoder.eof
            or decoder.unused_data or decoder.unconsumed_tail):
        raise ValueError('malformed PNG scanline size or incomplete/trailing deflate data '+role)
    # For 8-bit grayscale/truecolor, all byte values are legal samples and filters 0–4
    # are reversible. Validation needs no unfiltering, color conversion or encoding.
    if any(pixels[offset] > 4 for offset in range(0, expected_size, row_size)):
        raise ValueError('malformed PNG scanline filter '+role)


def _png_dimensions(payload, role):
    """Validate bounded 8-bit non-interlaced PNGs without rewriting encoded pixels.

    Supports grayscale, RGB, grayscale-alpha and RGBA. Indexed/packed/16-bit/
    interlaced PNGs are explicitly unsupported rather than accepted unverified.
    """
    if not isinstance(payload, bytes) or not payload.startswith(b'\x89PNG\r\n\x1a\n'):
        raise ValueError('missing or invalid PNG image '+role)
    offset, dimensions, palette, idat_closed = 8, None, None, False
    idat = []
    while offset+12 <= len(payload):
        length = int.from_bytes(payload[offset:offset+4], 'big')
        kind = payload[offset+4:offset+8]
        end = offset+12+length
        if end > len(payload) or not re.fullmatch(rb'[A-Za-z]{4}', kind) or kind[2] & 32:
            break
        data = payload[offset+8:offset+8+length]
        checksum = int.from_bytes(payload[offset+8+length:end], 'big')
        if zlib.crc32(kind+data) != checksum:
            break
        if offset == 8:
            if kind != b'IHDR' or length != 13:
                break
            width, height, depth, color, compression, filtering, interlace = struct.unpack('>IIBBBBB', data)
            depths = {0: (1,2,4,8,16), 2: (8,16), 3: (1,2,4,8), 4: (8,16), 6: (8,16)}
            if not (0 < width <= 2147483647 and 0 < height <= 2147483647
                    and depth in depths.get(color, ()) and compression == filtering == 0 and interlace in (0,1)):
                break
            dimensions = (width, height)
        elif kind == b'IHDR':
            break
        elif kind == b'PLTE':
            if (palette is not None or idat or color in (0,4) or not 0 < length <= 768
                    or length % 3 or color == 3 and length // 3 > 2 ** depth):
                raise ValueError('malformed PNG PLTE '+role)
            palette = data
        elif kind == b'IDAT':
            if idat_closed:
                raise ValueError('malformed PNG noncontiguous IDAT '+role)
            if color == 3 and palette is None:
                raise ValueError('malformed PNG PLTE is required '+role)
            if depth != 8 or color == 3 or interlace != 0:
                raise ValueError('unsupported PNG pixel format; require 8-bit non-interlaced grayscale/RGB/gray-alpha/RGBA '+role)
            idat.append(data)
        elif kind == b'IEND':
            if dimensions and idat and length == 0 and end == len(payload):
                channels = {0:1, 2:3, 4:2, 6:4}[color]
                _validate_png_pixels(b''.join(idat), width, height, channels, role)
                return dimensions
            break
        elif not kind[0] & 32:
            raise ValueError('unsupported PNG critical chunk '+kind.decode('ascii')+' '+role)
        if idat and kind != b'IDAT':
            idat_closed = True
        offset = end
    raise ValueError('malformed PNG image '+role)


def _image_size(block, pixels, width, height):
    if block.width_pt is None and block.height_pt is None:
        pixel_width, pixel_height = pixels
        scale = min(width / pixel_width, height / pixel_height)
        return max(1, round(pixel_width * scale)), max(1, round(pixel_height * scale))
    if block.width_pt is None or block.height_pt is None:
        raise ValueError('image dimensions must both be explicit or automatic')
    image_width, image_height = pt_to_hwp(block.width_pt), pt_to_hwp(block.height_pt)
    if image_width <= 0 or image_height <= 0:
        raise ValueError('image dimensions must be positive')
    if image_width > width or image_height > height:
        raise ValueError('image exceeds the template content area')
    return image_width, image_height


def _footer(run, width, make_paragraph, formats):
    """Native control story/field pair per python-hwpx section_format/story."""
    footer = _add(_add(run, 'hp:ctrl'), 'hp:footer', {'id': '0', 'applyPageType': 'BOTH'})
    sublist = _add(footer, 'hp:subList', {
        'id': '', 'textDirection': 'HORIZONTAL', 'lineWrap': 'BREAK', 'vertAlign': 'BOTTOM',
        'linkListIDRef': 0, 'linkListNextIDRef': 0, 'textWidth': width, 'textHeight': 1417,
        'hasTextRef': 0, 'hasNumRef': 0,
    })
    paragraph, auto_run = make_paragraph(sublist, 'footer')
    auto = _add(_add(auto_run, 'hp:ctrl'), 'hp:autoNum', {'num': 1, 'numType': 'PAGE'})
    _add(auto, 'hp:autoNumFormat', {'type': 'DIGIT', 'userChar': '', 'prefixChar': '', 'suffixChar': '', 'supscript': 0})
    page_run = _add(paragraph, 'hp:run', {'charPrIDRef': formats['footer'][0]})
    _add(_add(page_run, 'hp:ctrl'), 'hp:pageNum', {'pos': 'BOTTOM_CENTER', 'formatType': 'DIGIT', 'sideChar': ''})


def _summary_fill(header):
    fills = header.find('.//hh:borderFills', NS)
    if fills is None or not len(fills):
        raise ValueError('template lacks border definitions')
    entry = copy.deepcopy(fills[0])
    identifier = str(max(int(e.get('id')) for e in fills)+1)
    entry.set('id', identifier)
    for side in ('left','right','top','bottom'):
        entry.find('hh:'+side+'Border', NS).attrib = {'type':'SOLID','width':'0.2 mm','color':'#B9B9B9'}
    for brush in entry.findall('hc:fillBrush', NS):
        entry.remove(brush)
    _add(_add(entry, 'hc:fillBrush'), 'hc:winBrush', {'faceColor':'#FFFDD4','hatchColor':'#999999','alpha':0})
    fills.append(entry)
    fills.set('itemCnt', str(len(fills)))
    return identifier


def _picture(run, role, width, height, identifier):
    picture = _add(run, 'hp:pic', {
        'id':identifier,'zOrder':0,'numberingType':'PICTURE','textWrap':'SQUARE',
        'textFlow':'BOTH_SIDES','lock':0,'dropcapstyle':'None','href':'',
        'groupLevel':0,'instid':identifier,'reverse':0,
    })
    _add(picture, 'hp:offset', {'x':0,'y':0})
    _add(picture, 'hp:orgSz', {'width':width,'height':height})
    _add(picture, 'hp:curSz', {'width':width,'height':height})
    _add(picture, 'hp:flip', {'horizontal':0,'vertical':0})
    _add(picture, 'hp:rotationInfo', {'angle':0,'centerX':width//2,'centerY':height//2,'rotateimage':1})
    rendering = _add(picture, 'hp:renderingInfo')
    for name in ('transMatrix','scaMatrix','rotMatrix'):
        _add(rendering, 'hc:'+name, {'e1':1,'e2':0,'e3':0,'e4':0,'e5':1,'e6':0})
    rectangle = _add(picture, 'hp:imgRect')
    for i, (x, y) in enumerate(((0,0),(width,0),(width,height),(0,height))):
        _add(rectangle, 'hc:pt'+str(i), {'x':x,'y':y})
    _add(picture, 'hp:imgClip', {'left':0,'right':width,'top':0,'bottom':height})
    _add(picture, 'hp:inMargin', dict.fromkeys(('left','right','top','bottom'), 0))
    _add(picture, 'hp:imgDim', {'dimwidth':width,'dimheight':height})
    _add(picture, 'hc:img', {'binaryItemIDRef':'image_'+role,'bright':0,'contrast':0,'effect':'REAL_PIC','alpha':0})
    _add(picture, 'hp:effects')
    _add(picture, 'hp:sz', {'width':width,'height':height,'widthRelTo':'ABSOLUTE','heightRelTo':'ABSOLUTE','protect':0})
    _add(picture, 'hp:pos', _INLINE_POSITION)
    _add(picture, 'hp:outMargin', dict.fromkeys(('left','right','top','bottom'), 0))
    _add(picture, 'hp:shapeComment').text = role


def _summary(run, text, width, border_id, identifier, make_paragraph, make_run=None):
    table = _add(run, 'hp:tbl', {
        'id':identifier,'zOrder':0,'numberingType':'TABLE','textWrap':'TOP_AND_BOTTOM',
        'textFlow':'BOTH_SIDES','lock':0,'dropcapstyle':'None','pageBreak':'CELL',
        'repeatHeader':0,'rowCnt':1,'colCnt':1,'cellSpacing':0,
        'borderFillIDRef':border_id,'noAdjust':0,
    })
    # A native minimum row height, not a line/paragraph-height estimate.
    # Hancom grows the row to its editable content.
    _add(table, 'hp:sz', {'width':width,'height':282,'widthRelTo':'ABSOLUTE','heightRelTo':'ABSOLUTE','protect':0})
    _add(table, 'hp:pos', _INLINE_POSITION)
    _add(table, 'hp:outMargin', dict.fromkeys(('left','right','top','bottom'), 0))
    padding = {'left':510,'right':510,'top':141,'bottom':141}
    _add(table, 'hp:inMargin', padding)
    cell = _add(_add(table, 'hp:tr'), 'hp:tc', {
        'name':'','header':0,'hasMargin':0,'protect':0,'editable':0,'dirty':0,'borderFillIDRef':border_id,
    })
    sublist = _add(cell, 'hp:subList', {
        'id':'','textDirection':'HORIZONTAL','lineWrap':'BREAK','vertAlign':'CENTER',
        'linkListIDRef':0,'linkListNextIDRef':0,'textWidth':0,'textHeight':0,'hasTextRef':0,'hasNumRef':0,
    })
    inner, inner_run = make_paragraph(sublist, 'summary')
    if isinstance(text, str):
        _append_text(inner_run, text)
    else:
        for index, item in enumerate(text.items):
            label_run = inner_run if index == 0 else make_run(inner, 'summary')
            _append_text(label_run, ('◇ ' if index == 0 else '  ◇ ')+item.label+' ')
            _append_text(make_run(inner, 'summary', item.tone), '('+item.status+')')
    _add(cell, 'hp:cellAddr', {'colAddr':0,'rowAddr':0})
    _add(cell, 'hp:cellSpan', {'colSpan':1,'rowSpan':1})
    _add(cell, 'hp:cellSz', {'width':width,'height':282})
    _add(cell, 'hp:cellMargin', padding)


def build_parts(document: ReportDocument, template: Mapping[str, bytes], assets: Mapping[str, bytes]) -> dict[str, bytes]:
    """Compose semantic text, inline charts and native summary cells in order."""
    _require_valid(template)
    if not document.pages or any(not page.blocks for page in document.pages):
        raise ValueError('document requires non-empty semantic pages')
    if document.style_profile not in ('probe', 'report'):
        raise ValueError('unknown style profile '+str(document.style_profile))
    report = document.style_profile == 'report'
    styles = _REPORT_STYLES if report else _STYLES
    used_roles, pixels = set(), {}

    def validate_image(block):
        if not isinstance(block.role, str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]*', block.role):
            raise ValueError('invalid image role')
        if block.role in used_roles:
            raise ValueError('duplicate image role '+block.role)
        used_roles.add(block.role)
        payload = assets.get(block.role)
        if report or block.width_pt is None or block.height_pt is None:
            pixels[block.role] = _png_dimensions(payload, block.role)
        else:
            # Legacy explicit-size probes validated signature only. Preserve that
            # contract, including their original synthetic PNG container bytes.
            if not isinstance(payload, bytes) or not payload.startswith(b'\x89PNG\r\n\x1a\n'):
                raise ValueError('missing or invalid PNG image '+block.role)
            pixels[block.role] = None

    def validate_text(*values):
        if any(not isinstance(value, str) for value in values):
            raise ValueError('native text must be a string')

    def validate_tone(tone):
        if tone not in _TONES:
            raise ValueError('unknown text tone '+str(tone))

    for page in document.pages:
        for block in page.blocks:
            if isinstance(block, TextBlock):
                if block.style not in styles:
                    raise ValueError('unknown text style '+str(block.style))
                validate_text(block.text)
            elif isinstance(block, ImageBlock):
                validate_image(block)
            elif isinstance(block, MetricBlock):
                if not report:
                    raise ValueError('MetricBlock requires report profile')
                validate_text(block.title, block.value, block.status, block.narrative, block.formula)
                if block.basis is not None:
                    validate_text(block.basis)
                validate_tone(block.tone)
                validate_image(ImageBlock(block.image_role))
            elif isinstance(block, SummaryBlock) and report:
                for item in block.items:
                    validate_text(item.label, item.status)
                    validate_tone(item.tone)
            else:
                raise ValueError('unsupported semantic block')
    parts = dict(template)
    namespaces = dict(value for _, value in ET.iterparse(io.BytesIO(parts['Contents/header.xml']), events=['start-ns']))
    for prefix, uri in namespaces.items():
        ET.register_namespace(prefix, uri)
    header = ET.fromstring(parts['Contents/header.xml'])
    source = ET.fromstring(parts['Contents/section0.xml'])
    sec_pr = source.find('hp:p/hp:run/hp:secPr', NS)
    column_ctrl = source.find('hp:p/hp:run/hp:ctrl', NS)
    if header.get('secCnt') != '1' or sec_pr is None or column_ctrl is None:
        raise ValueError('single-section template with section/column controls is required')
    page_pr = sec_pr.find('hp:pagePr', NS)
    margin = page_pr.find('hp:margin', NS)
    if report:
        page_pr.set('width', '59528')
        page_pr.set('height', '84189')
        page_pr.set('landscape', 'WIDELY')
        margin.attrib = {'header':'1417', 'footer':'1417', 'gutter':'0',
                         'left':'3402', 'right':'3402', 'top':'2835', 'bottom':'2835'}
    width = int(page_pr.get('width'))-int(margin.get('left'))-int(margin.get('right'))
    height = int(page_pr.get('height'))-int(margin.get('top'))-int(margin.get('bottom'))
    formats = _formats(header, report)
    border_id = _summary_fill(header) if any(isinstance(b, SummaryBlock) or isinstance(b, TextBlock) and b.style == 'summary' for p in document.pages for b in p.blocks) else None
    section = ET.Element(_tag('hs:sec'))
    paragraph_id = 0
    object_id = 10000
    preview = []

    def paragraph(parent, style, page_break=False):
        nonlocal paragraph_id
        char_id, para_id = formats[style]
        p = _add(parent, 'hp:p', {
            'id':paragraph_id,'paraPrIDRef':para_id,'styleIDRef':0,
            'pageBreak':1 if page_break else 0,'columnBreak':0,'merged':0,
        })
        paragraph_id += 1
        run = _add(p, 'hp:run', {'charPrIDRef':char_id})
        if parent is section and len(section) == 1:
            run.append(copy.deepcopy(sec_pr))
            run.append(copy.deepcopy(column_ctrl))
            if report:
                _footer(run, width, paragraph, formats)
        return p, run

    def text_run(parent, style, tone='ink'):
        key = style if tone == 'ink' else style+':'+tone
        return _add(parent, 'hp:run', {'charPrIDRef': formats[key][0]})

    manifest = ET.fromstring(parts['Contents/content.hpf'])
    items = manifest.find('opf:manifest', NS)
    existing_ids = {item.get('id') for item in items}
    if not any(item.get('href') == 'version.xml' for item in items):
        version_id = 'version'
        suffix = 1
        while version_id in existing_ids:
            version_id = 'version_'+str(suffix)
            suffix += 1
        _add(items, 'opf:item', {'id':version_id,'href':'version.xml','media-type':'application/xml'})
        existing_ids.add(version_id)
    def image(run, block):
        nonlocal object_id
        image_width, image_height = _image_size(block, pixels[block.role], width, height)
        target, binary_id = 'BinData/'+block.role+'.png', 'image_'+block.role
        if target in parts or binary_id in existing_ids:
            raise ValueError('image target/ID collides with template')
        parts[target] = assets[block.role]
        _add(items, 'opf:item', {'id':binary_id,'href':target,'media-type':'image/png','isEmbeded':1})
        existing_ids.add(binary_id)
        _picture(run, block.role, image_width, image_height, object_id)
        object_id += 1

    for page_index, page in enumerate(document.pages):
        for block_index, block in enumerate(page.blocks):
            style = block.style if isinstance(block, TextBlock) else 'metric-body' if isinstance(block, MetricBlock) else 'body'
            p, run = paragraph(section, style, page_index > 0 and block_index == 0)
            if isinstance(block, TextBlock):
                preview.append(block.text)
                if style == 'summary':
                    _summary(run, block.text, width, border_id, object_id, paragraph)
                    object_id += 1
                else:
                    _append_text(run, block.text)
            elif isinstance(block, SummaryBlock):
                _summary(run, block, width, border_id, object_id, paragraph, text_run)
                object_id += 1
                preview.append('  '.join('◇ '+item.label+' ('+item.status+')' for item in block.items))
            elif isinstance(block, MetricBlock):
                label = '○ '+block.title+' '+block.value+' '
                status = '['+block.status+']'
                _append_text(run, label)
                _append_text(text_run(p, 'metric-body', block.tone), status)
                preview.append(label+status)
                for text, style in [('- '+block.narrative, 'metric-body'),
                                    *([('기준: '+block.basis, 'metric-note')] if block.basis is not None else []),
                                    ('* '+block.formula, 'metric-note')]:
                    _, child_run = paragraph(section, style)
                    _append_text(child_run, text)
                    preview.append(text)
                _, child_run = paragraph(section, 'body')
                image(child_run, ImageBlock(block.image_role))
            else:
                image(run, block)
    parts['Contents/header.xml'] = _xml(header, namespaces)
    parts['Contents/section0.xml'] = _xml(section, namespaces)
    parts['Contents/content.hpf'] = _xml(manifest, {})
    parts['Preview/PrvText.txt'] = '\n'.join(preview).encode('utf-8')
    parts.pop('Preview/PrvImage.png', None)
    _require_valid(parts)
    return parts
