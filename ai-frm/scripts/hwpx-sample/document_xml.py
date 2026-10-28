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
import xml.etree.ElementTree as ET

from package_io import NS, validate_parts
from report_projection import ImageBlock, MetricBlock, ReportDocument, TextBlock

# Semantic typography; no per-PDF-line geometry or fixed line-height estimates.
_STYLES = {
    'title': (16, True, 'CENTER', 0, 8),
    'date': (10, False, 'RIGHT', 0, 10),
    'body': (11, False, 'LEFT', 0, 6),
    'formula': (9, False, 'LEFT', 0, 8),
    'summary': (11, True, 'LEFT', 0, 0),
    'heading': (12, True, 'LEFT', 10, 6),
}
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


def _formats(header):
    """Clone valid header references; append distinct semantic formats."""
    chars = header.find('.//hh:charProperties', NS)
    paras = header.find('.//hh:paraProperties', NS)
    if chars is None or paras is None or len(chars) < 2 or not len(paras):
        raise ValueError('template lacks required base text formats')
    for font in header.findall('.//hh:font', NS):
        font.set('face', '맑은 고딕')
    char_base, para_base = chars[1], paras[0]
    next_char = max(int(e.get('id')) for e in chars)+1
    next_para = max(int(e.get('id')) for e in paras)+1
    result = {}
    for offset, (style, (size, bold, align, before, after)) in enumerate(_STYLES.items()):
        char, para = copy.deepcopy(char_base), copy.deepcopy(para_base)
        char_id, para_id = str(next_char+offset), str(next_para+offset)
        char.set('id', char_id)
        char.set('height', str(pt_to_hwp(size)))
        char.set('textColor', '#000000')
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
        breaks.set('keepWithNext', '1' if style in ('title','heading') else '0')
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
            spacing.attrib = {'type': 'PERCENT', 'value': '160', 'unit': 'HWPUNIT'}
        chars.append(char)
        paras.append(para)
        result[style] = (char_id, para_id)
    chars.set('itemCnt', str(len(chars)))
    paras.set('itemCnt', str(len(paras)))
    return result


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


def _summary(run, text, width, border_id, identifier, make_paragraph):
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
    _, inner_run = make_paragraph(sublist, 'summary')
    _append_text(inner_run, text)
    _add(cell, 'hp:cellAddr', {'colAddr':0,'rowAddr':0})
    _add(cell, 'hp:cellSpan', {'colSpan':1,'rowSpan':1})
    _add(cell, 'hp:cellSz', {'width':width,'height':282})
    _add(cell, 'hp:cellMargin', padding)


def build_parts(document: ReportDocument, template: Mapping[str, bytes], assets: Mapping[str, bytes]) -> dict[str, bytes]:
    """Compose probe text, inline images and summary cells in document order."""
    _require_valid(template)
    if not document.pages or any(not page.blocks for page in document.pages):
        raise ValueError('document requires non-empty semantic pages')
    used_roles = set()
    for page in document.pages:
        for block in page.blocks:
            if isinstance(block, TextBlock):
                if block.style not in _STYLES:
                    raise ValueError('unknown text style '+str(block.style))
                if not isinstance(block.text, str):
                    raise ValueError('native text must be a string')
            elif isinstance(block, ImageBlock):
                if not re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]*', block.role):
                    raise ValueError('invalid image role')
                if block.role in used_roles:
                    raise ValueError('duplicate image role '+block.role)
                used_roles.add(block.role)
                if block.role not in assets or not assets[block.role].startswith(b'\x89PNG\r\n\x1a\n'):
                    raise ValueError('missing or invalid PNG image '+block.role)
                if pt_to_hwp(block.width_pt) <= 0 or pt_to_hwp(block.height_pt) <= 0:
                    raise ValueError('image dimensions must be positive')
            elif isinstance(block, MetricBlock):
                raise ValueError('MetricBlock serialization awaits full report projection')
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
    width = int(page_pr.get('width'))-int(margin.get('left'))-int(margin.get('right'))
    height = int(page_pr.get('height'))-int(margin.get('top'))-int(margin.get('bottom'))
    formats = _formats(header)
    border_id = _summary_fill(header) if any(isinstance(b, TextBlock) and b.style == 'summary' for p in document.pages for b in p.blocks) else None
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
        return p, run

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
    for page_index, page in enumerate(document.pages):
        for block_index, block in enumerate(page.blocks):
            style = block.style if isinstance(block, TextBlock) else 'body'
            _, run = paragraph(section, style, page_index > 0 and block_index == 0)
            if isinstance(block, TextBlock):
                preview.append(block.text)
                if style == 'summary':
                    _summary(run, block.text, width, border_id, object_id, paragraph)
                    object_id += 1
                else:
                    _append_text(run, block.text)
            else:
                image_width, image_height = pt_to_hwp(block.width_pt), pt_to_hwp(block.height_pt)
                if image_width > width or image_height > height:
                    raise ValueError('image exceeds the template content area')
                target, binary_id = 'BinData/'+block.role+'.png', 'image_'+block.role
                if target in parts or binary_id in existing_ids:
                    raise ValueError('image target/ID collides with template')
                parts[target] = assets[block.role]
                _add(items, 'opf:item', {'id':binary_id,'href':target,'media-type':'image/png','isEmbeded':1})
                _picture(run, block.role, image_width, image_height, object_id)
                object_id += 1
    parts['Contents/header.xml'] = _xml(header, namespaces)
    parts['Contents/section0.xml'] = _xml(section, namespaces)
    parts['Contents/content.hpf'] = _xml(manifest, {})
    parts['Preview/PrvText.txt'] = '\n'.join(preview).encode('utf-8')
    parts.pop('Preview/PrvImage.png', None)
    _require_valid(parts)
    return parts
