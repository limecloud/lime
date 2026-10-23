import { createHash } from "node:crypto";
import type { BrowserMenuPresentation } from "./browserOverlayModel";
import {
  BROWSER_CONFIRMATION_SCRIPT,
  BROWSER_CONFIRMATION_STYLE,
} from "./browserConfirmationDocument";

const MENU_SCRIPT = `
const state=JSON.parse(document.getElementById('state').textContent);
const menus=[];
function closeChildren(index){while(menus.length>index+1)menus.pop().remove();menus[index]?.querySelectorAll('[aria-expanded]').forEach(row=>row.setAttribute('aria-expanded','false'))}
function open(items,x,y,parentIndex){
  if(parentIndex>=0)closeChildren(parentIndex);
  const menu=document.createElement('div');menu.className='menu';menu.setAttribute('role','menu');menu.tabIndex=-1;
  for(const item of items){
    if(item.separator){const separator=document.createElement('div');separator.className='separator';separator.setAttribute('role','separator');menu.append(separator);continue}
    if(item.controls){
      const row=document.createElement('div');row.className='controls';row.dataset.id=item.id;row.setAttribute('role','group');row.setAttribute('aria-label',item.label);
      const label=document.createElement('span');label.className='label';label.textContent=item.label;row.append(label);
      for(const control of item.controls){
        const button=document.createElement('button');button.className='control';button.type='button';button.dataset.id=control.id;button.textContent=control.label;button.setAttribute('aria-label',control.ariaLabel||control.label);button.disabled=item.enabled===false||control.enabled===false;
        button.addEventListener('click',()=>window.browserMenu.select(state.menuId,control.id));row.append(button);
      }
      row.addEventListener('pointerenter',()=>closeChildren(menus.indexOf(menu)));menu.append(row);continue;
    }
    const row=document.createElement('button');row.className='item';row.dataset.id=item.id;row.type='button';row.disabled=item.enabled===false;row.setAttribute('role',item.checked===undefined?'menuitem':'menuitemcheckbox');
    if(item.checked!==undefined)row.setAttribute('aria-checked',String(item.checked));
    const check=document.createElement('span');check.className='check';check.textContent=item.checked?'✓':'';
    const label=document.createElement('span');label.className='label';label.textContent=item.label;
    const shortcut=document.createElement('span');shortcut.className='shortcut';shortcut.textContent=item.submenu?'›':item.shortcut||'';
    row.append(check,label,shortcut);menu.append(row);
    if(item.submenu){row.setAttribute('aria-haspopup','menu');row.setAttribute('aria-expanded','false')}
    function submenu(){if(row.disabled)return;const r=row.getBoundingClientRect();const right=r.right+2;open(item.submenu,right+280>innerWidth?r.left-282:right,r.top,menus.indexOf(menu));row.setAttribute('aria-expanded','true')}
    row.addEventListener('pointerenter',()=>{if(item.submenu)submenu();else closeChildren(menus.indexOf(menu))});
    row.addEventListener('click',()=>{if(item.submenu)submenu();else window.browserMenu.select(state.menuId,item.id)});
    row.addEventListener('keydown',event=>{if(event.key==='ArrowRight'&&item.submenu){event.preventDefault();submenu();menus.at(-1).querySelector('button:not(:disabled)')?.focus()}});
  }
  document.body.append(menu);menus.push(menu);const r=menu.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(x,innerWidth-r.width-8))+'px';menu.style.top=Math.max(8,Math.min(y,innerHeight-r.height-8))+'px';return menu;
}
const root=open(state.items,state.anchor.x+state.anchor.width-280,state.anchor.y+state.anchor.height+6,-1);
root.querySelector('button:not(:disabled)')?.focus();
function shape(items){return JSON.stringify(items.map(item=>[item.id,item.separator,item.controls?.map(control=>control.id),item.submenu?shape(item.submenu):null]))}
function patch(items,nextItems){
 for(let index=0;index<items.length;index++){
  const item=items[index],next=nextItems[index];if(item.separator)continue;
  for(const key of ['label','shortcut','checked','enabled']){if(next[key]===undefined)delete item[key];else item[key]=next[key]}
  const row=[...document.querySelectorAll('[data-id]')].find(row=>row.dataset.id===item.id);
  if(row){
   row.querySelector('.label').textContent=item.label;
   if(item.controls)row.setAttribute('aria-label',item.label);
   else{row.disabled=item.enabled===false;row.setAttribute('role',item.checked===undefined?'menuitem':'menuitemcheckbox');if(item.checked===undefined)row.removeAttribute('aria-checked');else row.setAttribute('aria-checked',String(item.checked));row.querySelector('.check').textContent=item.checked?'✓':'';row.querySelector('.shortcut').textContent=item.submenu?'›':item.shortcut||''}
  }
  if(item.controls)for(let index=0;index<item.controls.length;index++){
   const control=item.controls[index];for(const key of ['label','ariaLabel','enabled']){if(next.controls[index][key]===undefined)delete control[key];else control[key]=next.controls[index][key]}
   const button=row?.querySelector('[data-id="'+control.id+'"]');if(button){button.textContent=control.label;button.setAttribute('aria-label',control.ariaLabel||control.label);button.disabled=item.enabled===false||control.enabled===false}
  }
  if(item.submenu)patch(item.submenu,next.submenu);
 }
}
window.browserMenu.onUpdate(update=>{
 if(update.menuId!==state.menuId)return;
 const focused=document.activeElement?.dataset.id;
 if(shape(state.items)===shape(update.items))patch(state.items,update.items);
 else{while(menus.length)menus.pop().remove();state.items=update.items;open(state.items,state.anchor.x+state.anchor.width-280,state.anchor.y+state.anchor.height+6,-1)}
 if(focused&&document.activeElement?.dataset.id!==focused)[...document.querySelectorAll('button:not(:disabled)')].find(row=>row.dataset.id===focused)?.focus();
});
document.addEventListener('pointerdown',event=>{if(!event.target.closest('.menu'))window.browserMenu.dismiss(state.menuId,'outside')});
document.addEventListener('keydown',event=>{
 if(event.key==='Escape'){event.preventDefault();window.browserMenu.dismiss(state.menuId,'escape');return}
 if(event.key==='Tab'){event.preventDefault();window.browserMenu.dismiss(state.menuId,'escape');return}
 const menu=document.activeElement?.closest('.menu')||menus.at(-1);if(!menu)return;
 const rows=[...menu.querySelectorAll('button:not(:disabled)')];const index=rows.indexOf(document.activeElement);
 if(document.activeElement?.classList.contains('control')&&(event.key==='ArrowLeft'||event.key==='ArrowRight')){const controls=[...document.activeElement.parentElement.querySelectorAll('button:not(:disabled)')];const index=controls.indexOf(document.activeElement);event.preventDefault();controls[(index+(event.key==='ArrowRight'?1:-1)+controls.length)%controls.length]?.focus();return}
 if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();rows[(index+(event.key==='ArrowDown'?1:-1)+rows.length)%rows.length]?.focus()}
 if(event.key==='Home'){event.preventDefault();rows[0]?.focus()}
 if(event.key==='End'){event.preventDefault();rows.at(-1)?.focus()}
 if(event.key==='ArrowLeft'&&menus.length>1){event.preventDefault();const parent=menus[menus.length-2].querySelector('[aria-expanded=true]');closeChildren(menus.length-2);parent?.focus()}
});
`;

export function browserOverlayDocument(
  presentation: BrowserMenuPresentation,
): string {
  const json = JSON.stringify(presentation)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
  const script = presentation.confirmation
    ? BROWSER_CONFIRMATION_SCRIPT
    : MENU_SCRIPT;
  const scriptHash = createHash("sha256").update(script).digest("base64");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>
  :root{color-scheme:${presentation.appearance || "light"};font:13px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;background:transparent;overflow:hidden}.menu{position:fixed;width:280px;padding:5px;background:light-dark(#fff,#292929);color:light-dark(#202020,#f4f4f4);border:1px solid light-dark(#ddd,#414141);border-radius:9px;box-shadow:0 5px 20px #0003;max-height:calc(100vh - 16px);overflow:auto}.item,.controls{display:flex;align-items:center;gap:7px;width:100%;min-height:29px;padding:5px 8px;border:0;border-radius:5px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:default}.item:hover:not(:disabled),.item:focus-visible,.control:hover:not(:disabled),.control:focus-visible{outline:none;background:light-dark(#eee,#454545)}.item:disabled,.control:disabled{opacity:.4}.check{width:12px}.label{flex:1}.shortcut{font-size:12px;color:light-dark(#777,#bbb);white-space:nowrap}.separator{height:1px;background:light-dark(#e9e9e9,#444);margin:4px 6px}.controls{padding-left:27px;gap:3px}.control{min-width:24px;height:24px;padding:0 5px;border:0;border-radius:4px;background:transparent;color:inherit;font:inherit;cursor:default}
  ${BROWSER_CONFIRMATION_STYLE}</style><body><script type="application/json" id="state">${json}</script><script>${script}</script></body></html>`;
}
