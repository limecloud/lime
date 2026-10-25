/** Fixed script for the address popup. Typed input and keyboard navigation stay in the owner renderer. */
export const BROWSER_ADDRESS_SCRIPT = `
const state=JSON.parse(document.getElementById("state").textContent);
const list=document.createElement("div");list.className="address-list";list.setAttribute("role","listbox");
document.body.append(list);
function render(items){
 list.replaceChildren();
 for(const item of items){
  const row=document.createElement("button");row.type="button";row.className="address-item";row.dataset.id=item.id;row.setAttribute("role","option");row.setAttribute("aria-selected",String(Boolean(item.checked)));row.tabIndex=-1;row.disabled=item.enabled===false;
  const label=document.createElement("span");label.className="address-title";label.textContent=item.label;
  const detail=document.createElement("span");detail.className="address-detail";detail.textContent=item.shortcut||"";
  row.append(label,detail);row.addEventListener("pointerdown",event=>event.preventDefault());row.addEventListener("click",()=>window.browserMenu.select(state.menuId,item.id));list.append(row);
 }
}
render(state.items);
window.browserMenu.onUpdate(update=>{if(update.menuId===state.menuId)render(update.items)});
document.addEventListener("keydown",event=>{if(event.key==="Escape"){event.preventDefault();window.browserMenu.dismiss(state.menuId,"escape")}});
`;

export const BROWSER_ADDRESS_STYLE = `
.address-list{width:100%;height:100%;overflow:auto;padding:4px;border:1px solid light-dark(#ddd,#414141);border-radius:8px;background:light-dark(#fff,#292929);color:light-dark(#202020,#f4f4f4)}
.address-item{display:flex;flex-direction:column;justify-content:center;width:100%;height:44px;padding:3px 9px;gap:2px;border:0;border-radius:5px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:default}
.address-item:hover,.address-item[aria-selected=true]{background:light-dark(#eee,#454545)}
.address-title,.address-detail{width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.address-detail{font-size:11px;opacity:.6}
`;
