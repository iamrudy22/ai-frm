"""Sample contract: data are already calculated; the writer must only serialize them."""
import copy
import importlib.util
from pathlib import Path
import tempfile
import unittest
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).parent
SPEC = importlib.util.spec_from_file_location('generate_sample', ROOT / 'generate_sample.py')
writer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(writer)

NS = {'hp': 'http://www.hancom.co.kr/hwpml/2011/paragraph', 'hc': 'http://www.hancom.co.kr/hwpml/2011/core', 'hh': 'http://www.hancom.co.kr/hwpml/2011/head', 'opf': 'http://www.idpf.org/2007/opf/'}
PNG = bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082')
IDS = ['recovery', 'liquidity', 'construction', 'funding', 'cash']

def fixture(folder):
    metrics = [{'id':key,'title':'지표 '+key,'value':str(i),'status':'정상','grade':'정상','narrative':'기존 문장 '+key,'formula':'기존 산식 '+key,'basis':'기존 기준 '+key,'source':'숨긴 출처 '+key,'historyNote':'숨긴 이력 '+key} for i,key in enumerate(IDS)]
    report = {'title':'합성 보고서 (2026/08)','reportMonth':'2026/08','generatedOn':'2026.10.27','isTemplate':False,'metrics':metrics,'warnings':['숨긴 경고']}
    metric_lines=lambda m:['○ '+m['title']+' '+m['value']+' ['+m['status']+']','- '+m['narrative']]+(['기준: '+m['basis']] if m['id']=='construction' else [])+['* '+m['formula']]
    messages=[[report['title'],'('+report['generatedOn']+', 자금기획팀)','□ 재무위험지수 종합']+['◇ '+m['title']+' ('+m['status']+')' for m in metrics]+['□ 위험수준 측정결과']+sum((metric_lines(m) for m in metrics[:2]),[])+['1'],sum(((['□ 적정시재 산정결과'] if m['id']=='cash' else [])+metric_lines(m) for m in metrics[2:]),[])+['2'],['참고','□ 위험단계 기준','□ 적정시재 산정방식 (LCR 방식)','3']]
    pages = []
    for subset in messages:
        pages.append({'texts':[{'text':message,'xPt':24,'yPt':20+15*i,'widthPt':500,'heightPt':14,'fontSizePt':10,'baselinePt':11} for i,message in enumerate(subset)]})
    images = {}
    for i,key in enumerate(IDS+['referenceRisk','referenceLcr']):
        path = folder/(key+'.png'); path.write_bytes(PNG)
        images[key] = {'path':str(path),'page':1 if i<2 else 2 if i<5 else 3,'xPt':24,'yPt':350+(i%3)*100,'widthPt':500,'heightPt':80}
    return report, {'pageWidthPt':595.28,'pageHeightPt':841.89,'fontFamily':'맑은 고딕','pages':pages,'images':images}

class SampleContract(unittest.TestCase):
    def test_native_flow_groups_pdf_spans_into_styled_runs_with_real_paragraph_margins(self):
        with tempfile.TemporaryDirectory() as td:
            report,layout=fixture(Path(td));line=layout['pages'][0]['texts'][0]
            first={**line,'text':'합성 보고서','widthPt':70,'bold':True}
            second={**line,'text':'(2026/08)','xPt':98,'widthPt':90,'color':'#245678'}
            layout['pages'][0]['texts']=[first,second,*layout['pages'][0]['texts'][1:]]
            output=Path(td)/'native.hwpx';writer.generate_sample(report,layout,output)
            with zipfile.ZipFile(output) as z:
                section=ET.fromstring(z.read('Contents/section0.xml'));header=ET.fromstring(z.read('Contents/header.xml'))
                paragraph=section.find('hp:p',NS)
                self.assertEqual(len(paragraph.findall('hp:run',NS)),2)
                para_id=paragraph.get('paraPrIDRef');prop=header.find('.//hh:paraPr[@id="'+para_id+'"]',NS)
                margin=prop.find('.//hh:margin',NS)
                self.assertEqual(margin.find('hc:left',NS).get('value'),'2400')
                self.assertEqual(margin.find('hc:prev',NS).get('value'),'2000')
                self.assertEqual(prop.find('.//hh:lineSpacing',NS).get('type'),'FIXED')

    def test_rejects_non_finite_font_and_outside_a4_geometry(self):
        with tempfile.TemporaryDirectory() as td:
            for key,value in [('fontSizePt',float('nan')),('xPt',-1),('widthPt',900)]:
                report,layout=fixture(Path(td));layout['pages'][0]['texts'][0][key]=value
                with self.assertRaises(ValueError):writer.generate_sample(report,layout,Path(td)/'bad.hwpx')

    def test_decorative_vectors_keep_seven_images_and_do_not_keep_picture_only_attributes(self):
        with tempfile.TemporaryDirectory() as td:
            report,layout=fixture(Path(td));layout['pages'][0]['shapes']=[{'xPt':24,'yPt':10,'widthPt':500,'heightPt':3,'fill':'#0088BF'}]
            output=Path(td)/'vector.hwpx';writer.generate_sample(report,layout,output)
            with zipfile.ZipFile(output) as z:
                section=ET.fromstring(z.read('Contents/section0.xml'))
                self.assertEqual(len(section.findall('.//hp:pic',NS)),7)
                rect=section.find('.//hp:rect',NS)
                self.assertIsNotNone(rect)
                self.assertNotIn('reverse',rect.attrib)
                self.assertEqual(rect.find('hc:fillBrush/hc:winBrush',NS).get('faceColor'),'#0088BF')
                self.assertEqual(rect.find('hp:lineShape',NS).get('style'),'NONE')

    def test_native_summary_border_uses_measured_stroke_color_and_point_width(self):
        with tempfile.TemporaryDirectory() as td:
            report,layout=fixture(Path(td))
            layout['pages'][0]['shapes']=[{'xPt':24,'yPt':10,'widthPt':500,'heightPt':64.5,'fill':'#FFFDD4','stroke':'#B9B9B9','strokeWidthPt':.75}]
            output=Path(td)/'border.hwpx';writer.generate_sample(report,layout,output)
            with zipfile.ZipFile(output) as z:
                section=ET.fromstring(z.read('Contents/section0.xml'))
                line=section.find('.//hp:rect/hp:lineShape',NS)
                self.assertEqual(line.get('style'),'SOLID')
                self.assertEqual(line.get('color'),'#B9B9B9')
                self.assertEqual(line.get('width'),'75')
                self.assertEqual(len(section.findall('.//hp:pic',NS)),7)

    def test_rejects_duplicate_visible_text_even_when_all_expected_text_is_present(self):
        with tempfile.TemporaryDirectory() as td:
            report,layout=fixture(Path(td));output=Path(td)/'duplicate.hwpx'
            first=layout['pages'][0]['texts'][0]
            layout['pages'][0]['texts'].append({**first,'yPt':300})
            with self.assertRaisesRegex(ValueError,'duplicate'):
                writer.generate_sample(report,layout,output)
            self.assertFalse(output.exists())

    def test_self_contained_editable_three_pages_and_seven_original_images(self):
        with tempfile.TemporaryDirectory() as td:
            report, layout = fixture(Path(td)); before=copy.deepcopy(report)
            output=Path(td)/'sample.hwpx'
            writer.generate_sample(report,layout,output)
            self.assertEqual(report,before)
            with zipfile.ZipFile(output) as z:
                self.assertEqual(z.infolist()[0].filename,'mimetype')
                self.assertEqual(z.infolist()[0].compress_type,zipfile.ZIP_STORED)
                self.assertEqual(z.read('mimetype'),b'application/hwp+zip')
                for part in ['Contents/header.xml','Contents/section0.xml']:
                    raw=z.read(part).decode()
                    self.assertTrue('standalone="yes"' in raw,part+' standalone declaration')
                    for prefix in ['ha','hp','hp10','hs','hc','hh','hhs','hm','hpf','dc','opf','ooxmlchart','hwpunitchar','epub','config']:
                        self.assertTrue('xmlns:'+prefix+'=' in raw,part+' namespace '+prefix)
                self.assertIn('href="version.xml"',z.read('Contents/content.hpf').decode())
                section=ET.fromstring(z.read('Contents/section0.xml'))
                self.assertEqual(len(section.findall('hp:p[@pageBreak="1"]',NS)),2)
                self.assertEqual(len(section.findall('.//hp:pic',NS)),7)
                for key,image in layout['images'].items():
                    self.assertEqual(z.read('BinData/'+key+'.png'),Path(image['path']).read_bytes())
                text=''.join(section.itertext())
                for metric in report['metrics']:
                    self.assertIn(metric['narrative'],text)
                    self.assertIn(metric['formula'],text)
                    self.assertIn(metric['value']+' ['+metric['status']+']',text)
                for hidden in ['숨긴 출처','숨긴 이력','숨긴 경고']: self.assertNotIn(hidden,text)
                self.assertGreater(len(section.findall('.//hp:t',NS)),20)
                manifest=ET.fromstring(z.read('Contents/content.hpf'))
                for item in manifest.findall('.//opf:item',NS): self.assertIn(item.get('href'),z.namelist())
                declared={item.get('id') for item in manifest.findall('.//opf:item',NS)}
                for image in section.findall('.//hc:img',NS): self.assertIn(image.get('binaryItemIDRef'),declared)
                header=ET.fromstring(z.read('Contents/header.xml'))
                chars={p.get('id') for p in header.findall('.//hh:charPr',NS)}
                paras={p.get('id') for p in header.findall('.//hh:paraPr',NS)}
                for p in section.findall('.//hp:p',NS): self.assertIn(p.get('paraPrIDRef'),paras)
                for run in section.findall('.//hp:run',NS): self.assertIn(run.get('charPrIDRef'),chars)

    def test_refuses_unmapped_text_missing_original_image_and_changed_body(self):
        with tempfile.TemporaryDirectory() as td:
            report,layout=fixture(Path(td));out=Path(td)/'bad.hwpx'
            layout['pages'][0]['texts'].append({'text':'불필요한 설명','xPt':24,'yPt':10,'widthPt':400,'heightPt':10,'fontSizePt':10})
            with self.assertRaisesRegex(ValueError,'unexpected text'):writer.generate_sample(report,layout,out)
            self.assertFalse(out.exists())
            report,layout=fixture(Path(td)); del layout['images']['funding']
            with self.assertRaisesRegex(ValueError,'seven images'):writer.generate_sample(report,layout,out)
            report,layout=fixture(Path(td));layout['pages'][0]['texts']=[]
            with self.assertRaisesRegex(ValueError,'missing displayed'):writer.generate_sample(report,layout,out)

    def test_uses_existing_short_reason_code_point_rule_without_recalculation(self):
        with tempfile.TemporaryDirectory() as td:
            report,_=fixture(Path(td));report['metrics'][0]['status']='산출 불가';report['metrics'][0]['narrative']='가'*70
            messages=writer.visible_messages(report)
            self.assertIn('- '+'가'*59+'… (상세는 HTML 참고)',messages)
            self.assertNotIn('- '+'가'*70,messages)

    def test_deterministic_bytes_and_xml_escape(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);report,layout=fixture(root);report['title']='합성 <보고서> & 검토';layout['pages'][0]['texts'][0]['text']=report['title']
            a=root/'a.hwpx';b=root/'b.hwpx';writer.generate_sample(report,layout,a);writer.generate_sample(report,layout,b)
            self.assertEqual(a.read_bytes(),b.read_bytes())
            with zipfile.ZipFile(a) as z:self.assertIn('&lt;보고서&gt; &amp;',z.read('Contents/section0.xml').decode())

if __name__=='__main__':unittest.main()
