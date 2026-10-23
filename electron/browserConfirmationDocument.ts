export const BROWSER_CONFIRMATION_SCRIPT = `
const state=JSON.parse(document.getElementById('state').textContent);
const dialog=document.createElement('section');dialog.className='confirmation';dialog.setAttribute('role','alertdialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','confirmation-title');dialog.setAttribute('aria-describedby','confirmation-description');
const title=document.createElement('h1');title.id='confirmation-title';title.textContent=state.confirmation.title;
const description=document.createElement('p');description.id='confirmation-description';description.textContent=state.confirmation.description;
const actions=document.createElement('div');actions.className='confirmation-actions';let acted=false;
for(const [index,item] of state.items.entries()){
 const button=document.createElement('button');button.type='button';button.dataset.id=item.id;button.textContent=item.label;button.className=index===1?'confirm':'cancel';
 button.addEventListener('click',()=>{if(acted)return;acted=true;window.browserMenu.select(state.menuId,item.id)});actions.append(button);
}
dialog.append(title,description,actions);document.body.append(dialog);actions.firstElementChild.focus();
window.browserMenu.onUpdate(()=>{});
document.addEventListener('pointerdown',event=>{if(!dialog.contains(event.target))window.browserMenu.dismiss(state.menuId,'outside')});
document.addEventListener('keydown',event=>{
 if(event.key==='Escape'){event.preventDefault();window.browserMenu.dismiss(state.menuId,'escape');return}
 if(event.key==='Tab'){event.preventDefault();const buttons=[...actions.querySelectorAll('button')];const index=buttons.indexOf(document.activeElement);buttons[(index+(event.shiftKey?-1:1)+buttons.length)%buttons.length].focus()}
});
`;

export const BROWSER_CONFIRMATION_STYLE = `
body:has(.confirmation){display:grid;place-items:center;background:#0005;padding:24px}
.confirmation{width:min(400px,100%);max-height:100%;overflow:auto;padding:24px;background:light-dark(#fff,#292929);color:light-dark(#202020,#f4f4f4);border:1px solid light-dark(#ddd,#414141);border-radius:16px;box-shadow:0 16px 48px #0004}
.confirmation h1{font-size:16px;line-height:1.4;font-weight:600;margin:0 0 8px}.confirmation p{font-size:13px;line-height:1.5;color:light-dark(#666,#bbb);margin:0}
.confirmation-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:24px}.confirmation button{font:inherit;padding:8px 14px;border-radius:8px;border:1px solid light-dark(#ddd,#555);background:transparent;color:inherit}.confirmation .confirm{background:light-dark(#202020,#f4f4f4);color:light-dark(#fff,#202020);border-color:transparent}.confirmation button:focus-visible{outline:2px solid light-dark(#555,#bbb);outline-offset:3px}.confirmation button:hover{filter:brightness(.9)}
`;
