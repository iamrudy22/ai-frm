'use client';
import { useCallback, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { VStack } from '@astryxdesign/core/VStack';
import { DocumentThemeProvider } from '@/app/ThemeProvider';
import type { ManualEntryDraftDto } from '@/domain/report-history/manual-entry';
import type { FinancialReport } from './report-model';
import { FinancialReportPreview } from './report-preview';

type PrintOwner={hosts:HTMLElement[];hidden:Set<Element>;observer:MutationObserver;sync:()=>void;frameClasses:Map<Element,string[]>};
const owners=new WeakMap<Document,PrintOwner>();
const hiddenClass='print:hidden!';
// Astryx Dialog pins the body and compensates its scrollbar on screen.
// Print must flow across pages without changing the modal's inline scroll-lock state.
const frameClasses=['print:static!','print:overflow-visible!','print:h-auto!','print:inset-auto!','print:w-auto!','print:pr-0!'];
/** Own only the print utility we add; screen state and existing classes stay untouched. */
export function isolateManualPrintDocument(host:HTMLElement){
 const doc=host.ownerDocument;let owner=owners.get(doc);
 if(!owner){
  const hidden=new Set<Element>();const hosts:HTMLElement[]=[];
  const added=new Map<Element,string[]>();
  for(const frame of [doc.documentElement,doc.body]){const classes=frameClasses.filter(name=>!frame.classList.contains(name));classes.forEach(name=>frame.classList.add(name));added.set(frame,classes);}
  const sync=()=>{
   const active=hosts.at(-1);
   for(const element of hidden){if(!active||element===active){element.classList.remove(hiddenClass);hidden.delete(element);}}
   if(active)for(const element of Array.from(doc.body.children)){if(element!==active&&!element.classList.contains(hiddenClass)){element.classList.add(hiddenClass);hidden.add(element);}}
  };
  const observer=new MutationObserver(sync);owner={hosts,hidden,observer,sync,frameClasses:added};owners.set(doc,owner);observer.observe(doc.body,{childList:true});
 }
 const current=owner;current.hosts.push(host);current.sync();let released=false;
 return ()=>{if(released)return;released=true;current.hosts.splice(current.hosts.indexOf(host),1);current.sync();if(!current.hosts.length){current.observer.disconnect();for(const [frame,classes] of current.frameClasses)classes.forEach(name=>frame.classList.remove(name));owners.delete(doc);}};
}
const subscribe=()=>()=>{};
const clientBody=()=>document.body;
const serverBody=()=>null;
/** The same saved review is rendered outside native dialog pagination and hidden controls. */
export function ManualEntryPrintHost({review}:{review:NonNullable<ManualEntryDraftDto['review']>}){
 const body=useSyncExternalStore(subscribe,clientBody,serverBody);
 const attach=useCallback((host:HTMLElement|null)=>host?isolateManualPrintDocument(host):undefined,[]);
 if(!body)return null;
 return createPortal(<VStack as="section" ref={attach} className="hidden! print:block!"><DocumentThemeProvider><FinancialReportPreview report={review.document.json as unknown as FinancialReport}/></DocumentThemeProvider></VStack>,body);
}
