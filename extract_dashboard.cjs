const fs = require('fs');

const lines = fs.readFileSync('src/App.tsx', 'utf-8').split('\n');

const detectionFeed = lines.slice(54, 126);
const violationsPanel = lines.slice(126, 190);
const statsBar = lines.slice(190, 207);
const dashboardLayout = lines.slice(403, 497);

let dashboardView = `import { useState } from 'react';\nimport { ShieldAlert, Clock } from 'lucide-react';\nimport { Bay } from '../../types';\nimport { DETECTIONS } from '../../mockData';\nimport { formatTimer } from '../../utils/helpers';\nimport { BayCard } from '../ui/BayCard';\n\n`;

dashboardView += detectionFeed.join('\n') + '\n';
dashboardView += violationsPanel.join('\n') + '\n';
dashboardView += statsBar.join('\n') + '\n';

dashboardView += `\nexport function DashboardView({ bays }: { bays: Bay[] }) {\n  return (\n    <div className="flex flex-col gap-5">\n`;
dashboardView += dashboardLayout.join('\n');
dashboardView += `\n    </div>\n  );\n}\n`;

fs.writeFileSync('src/components/views/DashboardView.tsx', dashboardView);

// Now splice App.tsx
const appBefore = lines.slice(0, 54);
const appImports = lines.slice(208, 214);
appImports.push('import { DashboardView } from "./components/views/DashboardView";');

const appMiddle = lines.slice(214, 403);
appMiddle.push('                    {activeTab === "dashboard" && <DashboardView bays={bays} />}');
const appEnd = lines.slice(497);

const newApp = [...appBefore, ...appImports, ...appMiddle, ...appEnd];
fs.writeFileSync('src/App.tsx', newApp.join('\n'));
console.log('Dashboard extracted');
