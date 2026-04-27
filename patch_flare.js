const fs = require('fs');
const file = 'src/components/agent/chat/components/ChatNavbar.tsx';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
  /const taskCenterChromeShellClassName =[\s\S]*?";/,
  `const taskCenterChromeShellClassName =
  "flex items-center gap-1.5 bg-white rounded-t-[12px] pl-3 pr-2 py-1.5 relative z-10 before:absolute before:bottom-0 before:-right-3 before:w-3 before:h-3 before:bg-[radial-gradient(circle_at_100%_0%,transparent_12px,white_12px)]";`
);

fs.writeFileSync(file, code);
