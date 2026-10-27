import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildFinancialReport } from './report-model';
import type { ManualEntryDraftDto } from '@/domain/report-history/manual-entry';

async function subject(){const mod=await import('./manual-entry-print-host').catch(()=>null);expect(mod,'manual review needs an isolated body print host').not.toBeNull();return mod!;}
afterEach(()=>{vi.doUnmock('react');vi.doUnmock('react-dom');vi.unstubAllGlobals();vi.resetModules();});
function surface(){
 const callbacks:(()=>void)[]=[];const disconnect=vi.fn();vi.stubGlobal('MutationObserver',class{constructor(fn:()=>void){callbacks.push(fn);}observe(){}disconnect=disconnect;});
 const body={children:[] as unknown[],classList:null as unknown, names:new Set<string>()};const root={classList:null as unknown,names:new Set<string>()};const doc={body,documentElement:root};
 const element=(classes:string[]=[])=>{const names=new Set(classes);return {ownerDocument:doc,classList:{contains:(name:string)=>names.has(name),add:(name:string)=>names.add(name),remove:(name:string)=>names.delete(name)},names};};
 Object.assign(body,element());Object.assign(root,element());
 return {body,root,doc,element,mutate:()=>callbacks.forEach(fn=>fn()),disconnect};
}
it.each(['archive','empty-home'])('final I1 %s prints only the active manual report; restores previous classes and observes late layers',async background=>{
 const {isolateManualPrintDocument}=await subject();const env=surface();const app=env.element([background]);const alreadyHidden=env.element(['print:hidden!']);const host=env.element();env.body.children=[app,alreadyHidden,host];
 const release=isolateManualPrintDocument(host as never);expect(app.names.has('print:hidden!')).toBe(true);expect(host.names.has('print:hidden!')).toBe(false);for(const frame of [env.body,env.root])for(const name of ['print:static!','print:overflow-visible!','print:h-auto!','print:inset-auto!','print:w-auto!','print:pr-0!'])expect(frame.names.has(name),name).toBe(true);
 const lateDialog=env.element(['dialog']);env.body.children.push(lateDialog);env.mutate();expect(lateDialog.names.has('print:hidden!')).toBe(true);
 release();expect(app.names).toEqual(new Set([background]));expect(alreadyHidden.names.has('print:hidden!')).toBe(true);expect(lateDialog.names).toEqual(new Set(['dialog']));expect(env.disconnect).toHaveBeenCalledTimes(1);expect(env.body.names.size).toBe(0);expect(env.root.names.size).toBe(0);
 // React StrictMode can attach, clean up, and reattach the same ref.
 const releaseAgain=isolateManualPrintDocument(host as never);expect(app.names.has('print:hidden!')).toBe(true);releaseAgain();expect(app.names.has('print:hidden!')).toBe(false);
});
it('final I1 latest mounted review owns print exclusively and either unmount order restores safely',async()=>{
 const {isolateManualPrintDocument}=await subject();for(const reverse of [false,true]){const env=surface();const app=env.element();const a=env.element();const b=env.element();env.body.children=[app,a,b];const releaseA=isolateManualPrintDocument(a as never);const releaseB=isolateManualPrintDocument(b as never);expect(a.names.has('print:hidden!')).toBe(true);expect(b.names.has('print:hidden!')).toBe(false);
 if(reverse){releaseA();expect(app.names.has('print:hidden!')).toBe(true);expect(b.names.has('print:hidden!')).toBe(false);releaseB();}else{releaseB();expect(a.names.has('print:hidden!')).toBe(false);expect(app.names.has('print:hidden!')).toBe(true);releaseA();}expect([app,a,b].every(v=>!v.names.has('print:hidden!'))).toBe(true);}
});
it('final I1 portal renders the exact current review with original three sheets and five charts outside the dialog',async()=>{
 vi.resetModules();const env=surface();vi.stubGlobal('document',env.doc);let portalTarget:unknown;let portalContent:unknown;
 vi.doMock('react',async original=>({...await original<typeof import('react')>(),useSyncExternalStore:(_subscribe:unknown,get:()=>unknown)=>get()}));
 vi.doMock('react-dom',async original=>({...await original<typeof import('react-dom')>(),createPortal:(child:unknown,target:unknown)=>{portalTarget=target;portalContent=child;return child;}}));
 const {ManualEntryPrintHost}=await subject();const base=buildFinancialReport();const report={...base,title:'2026/08 현재 검토 보고서',metrics:base.metrics.map(metric=>({...metric,points:[{month:'2026/08',value:1,kind:'available',secondary:1,reason:null}]}))};const review={document:{json:report}} as unknown as NonNullable<ManualEntryDraftDto['review']>;
 const html=renderToStaticMarkup(<ManualEntryPrintHost review={review}/>);expect(portalTarget).toBe(env.body);expect(portalContent).toBeTruthy();expect((portalContent as {props:Record<string,unknown>}).props['aria-hidden']).toBeUndefined();expect(html).toContain('hidden! print:block!');expect(html).toContain(report.title);expect(html).not.toContain('<dialog');expect(html).not.toContain('원자료 메모');expect(html.match(/class="[^"]*\breport-sheet\b[^\"]*"/g)).toHaveLength(3);expect(html.match(/<svg /g)).toHaveLength(5);expect(html).toContain('data-theme="light"');
});
