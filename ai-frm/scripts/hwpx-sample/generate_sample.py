"""Local HWPX compatibility probes and legacy failure reproduction.

Probes serialize semantic native-flow blocks. The old coordinate-based report
mode remains solely to reproduce the failed sample until the MYBOX probe gate.
Neither path imports calculations or writes a business ledger.
Skeleton: python-hwpx 6.10.0, Apache-2.0 (template-provenance.json).
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import io
import json
import math
from pathlib import Path
import re
import xml.etree.ElementTree as ET
from package_io import read_package, build_package, write_atomic

ROOT = Path(__file__).parent
NS = {
    'hp': 'http://www.hancom.co.kr/hwpml/2011/paragraph',
    'hs': 'http://www.hancom.co.kr/hwpml/2011/section',
    'hc': 'http://www.hancom.co.kr/hwpml/2011/core',
    'hh': 'http://www.hancom.co.kr/hwpml/2011/head',
    'opf': 'http://www.idpf.org/2007/opf/',
    'ocf': 'urn:oasis:names:tc:opendocument:xmlns:container',
}
for _prefix, _uri in NS.items(): ET.register_namespace(_prefix, _uri)
METRIC_IDS = ('recovery', 'liquidity', 'construction', 'funding', 'cash')
IMAGE_IDS = (*METRIC_IDS, 'referenceRisk', 'referenceLcr')


def tag(name):
    prefix, local = name.split(':')
    return '{'+NS[prefix]+'}'+local


def element(parent, name, attrs=None):
    return ET.SubElement(parent, tag(name), {str(k): str(v) for k,v in (attrs or {}).items()})


def hwp(points):
    return str(round(float(points)*100))


def normalize(text):
    return ''.join(str(text).split())


def page_lines(page):
    """Use actual PDF line groups; keep old span input for the small unit fixture."""
    if 'lines' in page:return page['lines']
    groups=[]
    for span in sorted(page['texts'],key=lambda x:(round(x['yPt'],1),x['xPt'])):
        same=next((line for line in groups if abs(line['yPt']-span['yPt'])<.5),None)
        if same is None:
            groups.append({**span,'runs':[{**span}], '_right':span['xPt']+span['widthPt']})
        else:
            gap=span['xPt']-same['_right'];text=(' ' if gap>1.2 else '')+span['text']
            same['runs'].append({**span,'text':text});same['text']+=text
            same['_right']=max(same['_right'],span['xPt']+span['widthPt'])
            same['widthPt']=same['_right']-same['xPt']
            same['heightPt']=max(same['heightPt'],span['heightPt'])
    return groups


def page_messages(report):
    """Mirror only displayed PDF text, including the existing shortReason rule."""
    metrics = report['metrics']
    first = [report['title'], '('+report['generatedOn']+', 자금기획팀)', '□ 재무위험지수 종합']
    messages=first
    messages.extend('◇ '+m['title']+' ('+m['status']+')' for m in metrics)
    messages.append('□ 위험수준 측정결과')
    second=[]
    for metric in metrics:
        messages=first if metric['id'] in ('recovery','liquidity') else second
        if metric['id']=='cash':messages.append('□ 적정시재 산정결과')
        messages.append('○ '+metric['title']+' '+metric['value']+' ['+metric['status']+']')
        reason=metric['narrative']
        if metric['status'] in ('산출 불가','산출 중') and len(reason)>60:
            reason=reason[:59]+'… (상세는 HTML 참고)'
        messages.append('- '+reason)
        if metric['id']=='construction':messages.append('기준: '+metric['basis'])
        messages.append('* '+metric['formula'])
    third=['참고','□ 위험단계 기준','□ 적정시재 산정방식 (LCR 방식)']
    return [first+['1'],second+['2'],third+['3']]


def visible_messages(report):
    return [message for page in page_messages(report) for message in page]


def validate_inputs(report, layout):
    if report.get('isTemplate') or tuple(m['id'] for m in report.get('metrics',[]))!=METRIC_IDS:
        raise ValueError('a calculated five-metric report is required')
    pages=layout.get('pages',[])
    if len(pages)!=3:raise ValueError('exactly three page layouts are required')
    if set(layout.get('images',{}))!=set(IMAGE_IDS):raise ValueError('exactly seven images are required')
    width=float(layout.get('pageWidthPt',595.28));height=float(layout.get('pageHeightPt',841.89))
    allowed=normalize(' '.join(visible_messages(report)))
    flattened=normalize(' '.join(t['text'] for p in pages for t in page_lines(p)))
    for message in visible_messages(report):
        if normalize(message) not in flattened:raise ValueError('missing displayed text: '+message[:40])
    for page_index,page in enumerate(pages):
        page_flattened=normalize(' '.join(text['text'] for text in page_lines(page)))
        for message in page_messages(report)[page_index]:
            if normalize(message) not in page_flattened:raise ValueError('missing displayed text on expected page: '+message[:40])
        expected_page_text=normalize(' '.join(page_messages(report)[page_index]))
        if page_flattened!=expected_page_text:
            raise ValueError('unexpected text or duplicate displayed text on page '+str(page_index+1))
        for text in page_lines(page):
            if normalize(text['text']) not in allowed:raise ValueError('unexpected text: '+text['text'][:40])
            for key in ['xPt','yPt','widthPt','heightPt','fontSizePt']:
                if not math.isfinite(float(text[key])) or float(text[key])<0:raise ValueError('invalid text geometry')
            if float(text['xPt'])+float(text['widthPt'])>width+1 or float(text['yPt'])+float(text['heightPt'])>height+1:
                raise ValueError('text outside page')
            if normalize(''.join(run['text'] for run in text.get('runs',[text])))!=normalize(text['text']):raise ValueError('styled runs changed text')
            for run in text.get('runs',[text]):
                if not math.isfinite(float(run['fontSizePt'])) or float(run['fontSizePt'])<=0:raise ValueError('invalid font size')
                if not re.fullmatch(r'#[0-9A-Fa-f]{6}',run.get('color','#000000')):raise ValueError('invalid text color')
    for image_id,image in layout['images'].items():
        expected_page=1 if image_id in ('recovery','liquidity') else 3 if image_id.startswith('reference') else 2
        if image['page']!=expected_page:raise ValueError('image outside expected page')
        if not Path(image['path']).read_bytes().startswith(b'\x89PNG\r\n\x1a\n'):raise ValueError('original PNG image required')
        for key in ['xPt','yPt','widthPt','heightPt']:
            if not math.isfinite(float(image[key])) or float(image[key])<0:raise ValueError('invalid image geometry')
        if float(image['xPt'])+float(image['widthPt'])>width+1 or float(image['yPt'])+float(image['heightPt'])>height+1:
            raise ValueError('image outside page')


def picture(parent, image_id, image, index):
    width,height=hwp(image['widthPt']),hwp(image['heightPt'])
    pic=element(parent,'hp:pic',{'id':10000+index,'zOrder':index,'numberingType':'PICTURE','textWrap':'BEHIND_TEXT','textFlow':'BOTH_SIDES','lock':0,'dropcapstyle':'None','href':'','groupLevel':0,'instid':10000+index,'reverse':0})
    element(pic,'hp:offset',{'x':0,'y':0})
    element(pic,'hp:orgSz',{'width':width,'height':height});element(pic,'hp:curSz',{'width':width,'height':height})
    element(pic,'hp:flip',{'horizontal':0,'vertical':0})
    element(pic,'hp:rotationInfo',{'angle':0,'centerX':int(width)//2,'centerY':int(height)//2,'rotateimage':1})
    rendering=element(pic,'hp:renderingInfo')
    for key in ('transMatrix','scaMatrix','rotMatrix'):element(rendering,'hc:'+key,{'e1':1,'e2':0,'e3':0,'e4':0,'e5':1,'e6':0})
    rect=element(pic,'hp:imgRect')
    for i,(x,y) in enumerate([(0,0),(width,0),(width,height),(0,height)]):element(rect,'hc:pt'+str(i),{'x':x,'y':y})
    element(pic,'hp:imgClip',{'left':0,'right':width,'top':0,'bottom':height})
    element(pic,'hp:inMargin',dict.fromkeys(('left','right','top','bottom'),0))
    element(pic,'hp:imgDim',{'dimwidth':width,'dimheight':height})
    element(pic,'hc:img',{'binaryItemIDRef':image_id,'bright':0,'contrast':0,'effect':'REAL_PIC','alpha':0})
    element(pic,'hp:effects')
    element(pic,'hp:sz',{'width':width,'height':height,'widthRelTo':'ABSOLUTE','heightRelTo':'ABSOLUTE','protect':0})
    element(pic,'hp:pos',{'treatAsChar':0,'affectLSpacing':0,'flowWithText':0,'allowOverlap':1,'holdAnchorAndSO':0,'vertRelTo':'PAGE','horzRelTo':'PAGE','vertAlign':'TOP','horzAlign':'LEFT','vertOffset':hwp(image['yPt']),'horzOffset':hwp(image['xPt'])})
    element(pic,'hp:outMargin',dict.fromkeys(('left','right','top','bottom'),0))
    element(pic,'hp:shapeComment').text=image_id


def rectangle(parent, shape, index):
    """Native decorative vector; never converts body text into an image."""
    # Reuse the common geometry of an otherwise empty picture and replace only
    # its type-specific nodes with the HWPX rectangle drawing children.
    picture(parent,'decoration',shape,100+index)
    rect=parent[-1];rect.tag=tag('hp:rect');rect.set('numberingType','NONE');rect.set('ratio','0');rect.attrib.pop('reverse',None)
    rect.set('zOrder','0')
    for child in list(rect):
        if child.tag in {tag('hp:'+name) for name in ['imgRect','imgClip','inMargin','imgDim','effects','shapeComment']} or child.tag==tag('hc:img'):rect.remove(child)
    at=list(rect).index(rect.find('hp:sz',NS))
    stroke=shape.get('stroke')
    if stroke is not None and not re.fullmatch(r'#[0-9A-Fa-f]{6}',stroke):raise ValueError('invalid vector stroke color')
    stroke_width=float(shape.get('strokeWidthPt',.75)) if stroke is not None else 0
    if not math.isfinite(stroke_width) or stroke_width<0:raise ValueError('invalid vector stroke width')
    line=ET.Element(tag('hp:lineShape'),{'color':stroke or shape['fill'],'width':hwp(stroke_width),'style':'SOLID' if stroke is not None and stroke_width>0 else 'NONE','endCap':'FLAT','headStyle':'NORMAL','tailStyle':'NORMAL','headfill':'1','tailfill':'1','headSz':'SMALL_SMALL','tailSz':'SMALL_SMALL','outlineStyle':'NORMAL','alpha':'0'})
    brush=ET.Element(tag('hc:fillBrush'));element(brush,'hc:winBrush',{'faceColor':shape['fill'],'hatchColor':'#999999','alpha':0})
    width,height=hwp(shape['widthPt']),hwp(shape['heightPt'])
    points=[ET.Element(tag('hc:pt'+str(i)),{'x':str(x),'y':str(y)}) for i,(x,y) in enumerate([(0,0),(width,0),(width,height),(0,height)])]
    for offset,child in enumerate([line,brush,*points]):rect.insert(at+offset,child)


def xml_bytes(root, compatibility_namespaces=None):
    body=ET.tostring(root,encoding='utf-8',xml_declaration=False)
    if compatibility_namespaces:
        end=body.index(b'>')
        missing=[(' xmlns:'+prefix+'="'+uri+'"').encode() for prefix,uri in compatibility_namespaces.items() if ('xmlns:'+prefix+'=').encode() not in body[:end]]
        body=body[:end]+b''.join(missing)+body[end:]
    return b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'+body


def ensure_output_is_separate(output, inputs):
    """Only the file-reading boundary knows all input paths."""
    output=Path(output)
    for source in map(Path,inputs):
        if output.resolve()==source.resolve() or (output.exists() and source.exists() and output.samefile(source)):
            raise ValueError('output must not overwrite an input file: '+str(source))


def generate_sample(report, layout, output):
    ensure_output_is_separate(output,[ROOT/'blank.hwpx',ROOT/'template-provenance.json',
                                     *(image['path'] for image in layout.get('images',{}).values())])
    validate_inputs(report,layout)
    provenance=json.loads((ROOT/'template-provenance.json').read_text())
    blank=(ROOT/'blank.hwpx').read_bytes()
    if hashlib.sha256(blank).hexdigest()!=provenance['blankSha256']:raise ValueError('blank package changed')
    parts=read_package(blank)
    compatibility_namespaces=dict(value for _,value in ET.iterparse(io.BytesIO(parts['Contents/header.xml']),events=['start-ns']))
    for prefix,uri in compatibility_namespaces.items():ET.register_namespace(prefix,uri)
    header=ET.fromstring(parts['Contents/header.xml'])
    source_section=ET.fromstring(parts['Contents/section0.xml'])
    section=ET.Element(tag('hs:sec'))
    header.set('secCnt','1')
    for font in header.findall('.//hh:font',NS):font.set('face',layout.get('fontFamily','맑은 고딕'))
    properties=header.find('.//hh:charProperties',NS)
    base_character=copy.deepcopy(properties[1])
    para=header.find('.//hh:paraPr',NS)
    para.set('snapToGrid','0');para.find('hh:align',NS).set('horizontal','LEFT')
    for margin in para.findall('.//hh:margin',NS):
        for value in margin:value.set('value','0')
    for spacing in para.findall('.//hh:lineSpacing',NS):spacing.set('value','100')
    char_ids={}
    para_properties=header.find('.//hh:paraProperties',NS)
    def para_id(line,previous_bottom):
        entry=copy.deepcopy(para);idx=len(para_properties);entry.set('id',str(idx))
        for child in list(entry):
            if child.tag in (tag('hp:switch'),tag('hh:margin'),tag('hh:lineSpacing')):entry.remove(child)
        margin=element(entry,'hh:margin')
        values={'intent':0,'left':line['xPt'],'right':max(0,float(layout.get('pageWidthPt',595.28))-line['xPt']-line['widthPt']),'prev':max(0,line['yPt']-previous_bottom),'next':0}
        for key,value in values.items():element(margin,'hc:'+key,{'value':hwp(value),'unit':'HWPUNIT'})
        element(entry,'hh:lineSpacing',{'type':'FIXED','value':hwp(line['heightPt']),'unit':'HWPUNIT'})
        para_properties.append(entry)
        return idx
    def char_id(text):
        key=(float(text['fontSizePt']),bool(text.get('bold')),text.get('color','#000000'))
        if key not in char_ids:
            entry=copy.deepcopy(base_character);idx=len(properties);entry.set('id',str(idx));entry.set('height',hwp(key[0]));entry.set('textColor',key[2]);entry.find('hh:fontRef',NS).attrib=dict.fromkeys(('hangul','latin','hanja','japanese','other','symbol','user'),'0')
            for bold in entry.findall('hh:bold',NS):entry.remove(bold)
            if key[1]:element(entry,'hh:bold')
            properties.append(entry);char_ids[key]=idx
        return char_ids[key]
    paragraph_id=1
    for page_index,page in enumerate(layout['pages']):
        texts=page_lines(page)
        previous_bottom=0
        for text_index,text in enumerate(texts):
            p=element(section,'hp:p',{'id':paragraph_id,'paraPrIDRef':para_id(text,previous_bottom),'styleIDRef':0,'pageBreak':1 if page_index>0 and text_index==0 else 0,'columnBreak':0,'merged':0});paragraph_id+=1
            previous_bottom=text['yPt']+text['heightPt']
            runs=text.get('runs',[text]);run=element(p,'hp:run',{'charPrIDRef':char_id(runs[0])})
            if page_index==0 and text_index==0:
                sec_pr=copy.deepcopy(source_section.find('.//hp:secPr',NS));page_pr=sec_pr.find('hp:pagePr',NS);page_pr.set('width',hwp(layout.get('pageWidthPt',595.28)));page_pr.set('height',hwp(layout.get('pageHeightPt',841.89)))
                page_pr.find('hp:margin',NS).attrib=dict.fromkeys(('header','footer','gutter','left','right','top','bottom'),'0')
                run.append(sec_pr)
                ctrl=element(run,'hp:ctrl');element(ctrl,'hp:colPr',{'id':'','type':'NEWSPAPER','layout':'LEFT','colCount':1,'sameSz':1,'sameGap':0})
            element(run,'hp:t').text=runs[0]['text']
            first_run=run
            for item in runs[1:]:
                run=element(p,'hp:run',{'charPrIDRef':char_id(item)});element(run,'hp:t').text=item['text']
            if text_index==0:
                for shape_index,shape in enumerate(page.get('shapes',[])):rectangle(first_run,shape,page_index*100+shape_index)
                for image_index,image_id in enumerate(IMAGE_IDS):
                    image=layout['images'][image_id]
                    if image['page']==page_index+1:picture(first_run,image_id,image,image_index)
            lines=element(p,'hp:linesegarray')
            element(lines,'hp:lineseg',{'textpos':0,'vertpos':hwp(text['yPt']),'vertsize':hwp(text['heightPt']),'textheight':hwp(text['fontSizePt']),'baseline':hwp(text.get('baselinePt',float(text['fontSizePt'])*.85)),'spacing':0,'horzpos':hwp(text['xPt']),'horzsize':hwp(text['widthPt']),'flags':393216})
    properties.set('itemCnt',str(len(properties)))
    para_properties.set('itemCnt',str(len(para_properties)))
    parts['Contents/header.xml']=xml_bytes(header,compatibility_namespaces);parts['Contents/section0.xml']=xml_bytes(section,compatibility_namespaces)
    manifest=ET.fromstring(parts['Contents/content.hpf'])
    manifest.find('opf:metadata/opf:title',NS).text=report['title']
    for meta in manifest.findall('opf:metadata/opf:meta',NS):
        meta.text='AI-FRM synthetic sample' if meta.get('name') in ('creator','lastsaveby') else ''
    manifest_items=manifest.find('opf:manifest',NS)
    element(manifest_items,'opf:item',{'id':'version','href':'version.xml','media-type':'application/xml'})
    for image_id in IMAGE_IDS:
        path='BinData/'+image_id+'.png';parts[path]=Path(layout['images'][image_id]['path']).read_bytes()
        element(manifest_items,'opf:item',{'id':image_id,'href':path,'media-type':'image/png','isEmbeded':1})
    parts['Contents/content.hpf']=xml_bytes(manifest)
    parts['Preview/PrvText.txt']='\n'.join(visible_messages(report)).encode('utf-8')
    parts.pop('Preview/PrvImage.png',None)
    output=Path(output)
    payload=build_package(parts)
    write_atomic(output,payload)
    return {'declaredPageLayouts':3,'declaredPageBreaks':2,'editableTextParagraphs':paragraph_id-1,'images':7,'sha256':hashlib.sha256(output.read_bytes()).hexdigest()}


def make_probe_document(mode):
    """Synthetic semantic blocks for viewer QA; never a financial calculation."""
    from report_projection import TextBlock, ImageBlock, PageSpec, ReportDocument
    blocks=[TextBlock('문서 호환성 시험 (합성 자료)','title'),
            TextBlock('(2026.10.29, HWPX 검증)','date')]
    if mode=='probe-table':
        blocks.append(TextBlock('◇ 시험 지표 (정상)\n표 안의 본문도 편집 가능한 합성 자료입니다.','summary'))
    blocks.extend([
        TextBlock('□ 문단과 차트 흐름 확인','heading'),
        TextBlock('이 문서는 실제 업무 자료를 포함하지 않는 합성 자료입니다. 한글 문장이 문단 너비에 따라 자연스럽게 줄바꿈되고 다음 차트와 겹치지 않는지 확인합니다. 그림 뒤에 이어지는 산식과 문장도 순서대로 보존되어야 합니다. & < > 기호도 그대로 표시합니다.'),
    ])
    if mode!='probe-text':blocks.append(ImageBlock('chart',400,110))
    blocks.extend([TextBlock('* 시험 산식: (120 − 20) × 100 ÷ 200 = 50%, Σ = 100; × ÷ − Σ','formula'),
                   TextBlock('그림 다음 문장입니다. 본문·그림·산식이 같은 흐름을 유지하는지 확인합니다.')])
    return ReportDocument('2026/08','2026.10.29',(PageSpec(tuple(blocks)),))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode',choices=['probe-text','probe-image','probe-table','report'],default='report')
    parser.add_argument('--report',type=Path)
    parser.add_argument('--layout',type=Path,help='legacy failed-layout reproduction only; removed after MYBOX probe gate')
    parser.add_argument('--assets',type=Path,help='JSON mapping of image role to local PNG path')
    parser.add_argument('--output',required=True,type=Path)
    args=parser.parse_args()
    inputs=[ROOT/'blank.hwpx',ROOT/'template-provenance.json',
            *(path for path in [args.report,args.layout,args.assets] if path is not None)]
    ensure_output_is_separate(args.output,inputs)
    if args.mode=='report':
        if args.report is None or args.layout is None:
            parser.error('report mode currently requires --report and legacy --layout; native report awaits MYBOX probe acceptance')
        report=json.loads(args.report.read_text());report=report.get('json',report)
        layout=json.loads(args.layout.read_text())
        print(json.dumps(generate_sample(report,layout,args.output),ensure_ascii=False))
        return
    if args.report is not None or args.layout is not None:
        parser.error('synthetic probes do not accept report/layout inputs')
    paths=json.loads(args.assets.read_text()) if args.assets else {}
    if not isinstance(paths,dict) or not all(isinstance(role,str) and isinstance(path,str) for role,path in paths.items()):
        raise ValueError('assets must map image roles to local paths')
    # Relative paths belong to the asset manifest, not the process working directory.
    paths={role:Path(path) if Path(path).is_absolute() else args.assets.parent/path for role,path in paths.items()}
    ensure_output_is_separate(args.output,paths.values())
    assets={role:path.read_bytes() for role,path in paths.items()}
    provenance=json.loads((ROOT/'template-provenance.json').read_text())
    blank=(ROOT/'blank.hwpx').read_bytes()
    if hashlib.sha256(blank).hexdigest()!=provenance['blankSha256']:raise ValueError('blank package changed')
    from document_xml import build_parts
    document=make_probe_document(args.mode)
    payload=build_package(build_parts(document,read_package(blank),assets))
    write_atomic(args.output,payload)
    print(json.dumps({'mode':args.mode,'declaredPageLayouts':len(document.pages),
                      'images':len(assets),'sha256':hashlib.sha256(payload).hexdigest(),
                      'mybox':'not_run'},ensure_ascii=False))

if __name__=='__main__':main()
