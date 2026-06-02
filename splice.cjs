const fs = require('fs');
const lines = fs.readFileSync('src/App.tsx', 'utf-8').split('\n');

// NAV_ITEMS starts at line 60 (index 59)
// Header component ends at line 481 (index 480)
// We want to keep lines 0 to 58 (index 0 to 58)
const before = lines.slice(0, 59);
const after = lines.slice(481);

const imports = [
  'import { formatTimer, formatDate, formatClock } from "./utils/helpers";',
  'import { BayCard } from "./components/ui/BayCard";',
  'import { Sidebar } from "./components/layout/Sidebar";',
  'import { Header } from "./components/layout/Header";',
];

const newLines = [...before, ...imports, ...after];
fs.writeFileSync('src/App.tsx', newLines.join('\n'));
console.log('Spliced App.tsx successfully');
