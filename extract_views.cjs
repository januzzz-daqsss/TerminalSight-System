const fs = require('fs');
const lines = fs.readFileSync('src/App.tsx', 'utf-8').split('\n');

const lucideSet = new Set(['LayoutDashboard', 'Camera', 'AlertTriangle', 'BarChart2', 'Settings', 'Bell', 'Bus', 'Car', 'Clock', 'MapPin', 'Wifi', 'ShieldAlert', 'CheckCircle2', 'Timer', 'ChevronRight', 'Activity', 'Download', 'Calendar', 'FileText', 'Plus', 'Video', 'Signal', 'Search', 'ChevronLeft', 'Save', 'RotateCcw', 'Volume2', 'Play', 'Cloud', 'Sliders', 'Globe', 'RefreshCw', 'VideoOff', 'User', 'Lock', 'ShieldCheck', 'LogOut', 'MonitorUp', 'ExternalLink', 'X']);
const rechartsSet = new Set(['BarChart', 'Bar', 'XAxis', 'YAxis', 'CartesianGrid', 'RechartsTooltip', 'ResponsiveContainer', 'LineChart', 'Line', 'Legend']);

function extractImports(code) {
  const usedLucide = [];
  const usedRecharts = [];
  
  for (const icon of lucideSet) {
    if (code.includes(icon)) usedLucide.push(icon);
  }
  for (const component of rechartsSet) {
    if (code.includes(component)) {
      if (component === 'RechartsTooltip') {
        usedRecharts.push('Tooltip as RechartsTooltip');
      } else {
        usedRecharts.push(component);
      }
    }
  }

  let imports = `import { useState, useEffect } from 'react';\nimport { Bay, Detection } from '../../types';\nimport { initialBays, DETECTIONS } from '../../mockData';\nimport { formatTimer, formatDate, formatClock } from '../../utils/helpers';\n`;
  if (usedLucide.length > 0) imports += `import { ${usedLucide.join(', ')} } from 'lucide-react';\n`;
  if (usedRecharts.length > 0) imports += `import { ${usedRecharts.join(', ')} } from 'recharts';\n`;
  
  // Specific internal component imports if needed (e.g. PublicBayCard inside PublicSignage)
  if (code.includes('<PublicBayCard')) imports += `import { PublicBayCard } from '../ui/PublicBayCard';\n`;
  
  return imports + '\n';
}

const slices = [
  { name: 'AnalyticsView', start: 247, end: 817 }, // Ends before CameraZonesView
  { name: 'CameraZonesView', start: 818, end: 1033 }, // Ends before ViolationLogsView
  { name: 'ViolationLogsView', start: 1034, end: 1394 }, // Ends before Settings
  { name: 'SettingsView', start: 1395, end: 1679 }, // Ends before AdminLogin
  { name: 'AdminLogin', start: 1680, end: 1785 }, // Ends before PublicSignage
  { name: 'PublicSignageView', start: 1786, end: 1898 }, // Ends before PublicBayCard
  { name: 'PublicBayCard', start: 1899, end: 1962 },
];

slices.forEach(slice => {
  const code = lines.slice(slice.start, slice.end + 1).join('\n');
  let folder = 'views';
  if (slice.name === 'PublicBayCard') folder = 'ui';
  const outPath = `src/components/${folder}/${slice.name}.tsx`;
  fs.writeFileSync(outPath, extractImports(code) + code);
  console.log(`Created ${outPath}`);
});

// Update App.tsx
const before = lines.slice(0, 247);
const appCode = lines.slice(1963);

const newImports = [
  'import { AnalyticsView } from "./components/views/AnalyticsView";',
  'import { CameraZonesView } from "./components/views/CameraZonesView";',
  'import { ViolationLogsView } from "./components/views/ViolationLogsView";',
  'import { SettingsView } from "./components/views/SettingsView";',
  'import { AdminLogin } from "./components/views/AdminLogin";',
  'import { PublicSignageView } from "./components/views/PublicSignageView";',
];

const newAppLines = [...before, ...newImports, ...appCode];
fs.writeFileSync('src/App.tsx', newAppLines.join('\n'));
console.log('App.tsx spliced successfully.');
