const fs = require('fs');
const file1 = 'src/components/agent/chat/components/ChatNavbar.tsx';
let code1 = fs.readFileSync(file1, 'utf8');

code1 = code1.replace(
  /const taskCenterChromeShellClassName =[\s\S]*?";/,
  `const taskCenterChromeShellClassName =
  "flex items-center gap-1.5 bg-white dark:bg-slate-900 rounded-t-[12px] pl-3 pr-2 py-1.5 relative z-10 before:absolute before:bottom-0 before:-right-3 before:w-3 before:h-3 before:bg-[radial-gradient(circle_at_100%_0%,transparent_12px,white_0)] dark:before:bg-[radial-gradient(circle_at_100%_0%,transparent_12px,var(--tw-colors-slate-900,#0f172a)_0)]";`
);
fs.writeFileSync(file1, code1);

const file2 = 'src/components/agent/chat/components/TaskCenterTabStrip.tsx';
let code2 = fs.readFileSync(file2, 'utf8');

code2 = code2.replace(
  /className="shrink-0 bg-white rounded-tr-\[12px\] px-3 pt-2 pb-1.5 border-b border-slate-100 relative z-10"/,
  `className="shrink-0 bg-white dark:bg-slate-900 rounded-tr-[12px] px-3 pt-2 pb-1.5 border-b border-slate-100 dark:border-slate-800 relative z-10"`
);
fs.writeFileSync(file2, code2);
