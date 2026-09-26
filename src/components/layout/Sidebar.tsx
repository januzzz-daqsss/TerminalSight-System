import type { SystemStatus } from "../../notifications/model";
import {
    LayoutDashboard,
    Camera,
    AlertTriangle,
    BarChart2,
    Settings,
    Bus,
    Wifi,
    ChevronRight,
    MonitorUp,
    Users,
    ExternalLink,
    LogOut,
} from "lucide-react";

export const NAV_ITEMS = [
    { id: "dashboard", icon: LayoutDashboard, label: "Dashboard" },
    { id: "camera", icon: Camera, label: "Camera Zones" },
    { id: "violations", icon: AlertTriangle, label: "Violation Logs" },
    { id: "analytics", icon: BarChart2, label: "Analytics" },
    { id: "settings", icon: Settings, label: "Settings" },
];

export function Sidebar({
    activeTab,
    setActiveTab,
    onLogout,
    system,
    onSystemDetails,
}: {
    activeTab: string;
    setActiveTab: (tab: string) => void;
    onLogout: () => void;
    system: SystemStatus;
    onSystemDetails: () => void;
}) {
    return (
        <aside className="w-64 min-h-screen bg-slate-900 flex flex-col flex-shrink-0 print-hide">
            {/* Branding */}
            <div className="px-6 py-6 border-b border-slate-700/60">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-emerald-600 flex items-center justify-center shadow-lg">
                        <Bus size={18} className="text-white" />
                    </div>
                    <div>
                        <p className="text-white font-bold text-sm leading-tight">
                            TerminalSight
                        </p>
                        <p className="text-slate-400 text-[10px] tracking-widest uppercase">
                            Admin Console
                        </p>
                    </div>
                </div>
            </div>

            <button onClick={onSystemDetails} aria-label="Open local and cloud system status" className="mx-4 mt-4 space-y-2 rounded-lg bg-slate-800 px-3 py-3 text-left text-xs hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-emerald-400">
                <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-2 text-slate-300"><Wifi size={12} />Local System</span><span className={system.local === 'Online' ? 'text-emerald-400' : 'text-amber-400'}>{system.local}</span></div>
                <div className="flex items-center justify-between gap-2"><span className="text-slate-300">Cloud Sync</span><span className={system.cloud.state === 'Synced' && system.local === 'Online' ? 'text-emerald-400' : 'text-amber-400'}>{system.local === 'Online' ? system.cloud.state : 'Unknown'}</span></div>
            </button>

            {/* Navigation */}
            <nav className="flex-1 px-3 mt-6 flex flex-col gap-1 pb-4">
                <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest px-3 mb-2">
                    Main Menu
                </p>
                {NAV_ITEMS.map(({ id, icon: Icon, label }) => {
                    const active = activeTab === id;
                    return (
                        <button
                            key={id}
                            onClick={() => setActiveTab(id)}
                            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 group ${active
                                    ? "bg-emerald-600 text-white shadow-md shadow-emerald-500/30"
                                    : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                                }`}
                        >
                            <Icon size={17} />
                            <span className="flex-1 text-left">{label}</span>
                            {active && <ChevronRight size={14} className="opacity-60" />}
                        </button>
                    );
                })}

                <div className="mt-auto pt-4 flex flex-col gap-1">
                    <button
                        onClick={() => window.open("/public-view", "_blank", "noopener,noreferrer")}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-bold transition-all duration-150 bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30"
                    >
                        <Users size={17} />
                        <span className="flex-1 text-left">Launch Public View</span>
                        <ExternalLink size={14} className="opacity-70" />
                    </button>
                    <button
                        onClick={() =>
                            window.open("/signage", "_blank", "noopener,noreferrer")
                        }
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-bold transition-all duration-150 bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30"
                    >
                        <MonitorUp size={17} />
                        <span className="flex-1 text-left">Launch Public Display</span>
                        <ExternalLink size={14} className="opacity-70" />
                    </button>

                    <button
                        onClick={onLogout}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 text-slate-500 hover:text-red-400 hover:bg-red-900/20"
                    >
                        <LogOut size={17} />
                        <span className="flex-1 text-left">Log Out</span>
                    </button>
                </div>
            </nav>

            {/* Footer */}
            <div className="px-4 py-4 border-t border-slate-700/60">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
                        <span className="text-emerald-300 text-xs font-bold">AD</span>
                    </div>
                    <div>
                        <p className="text-slate-200 text-xs font-semibold">Admin</p>
                        <p className="text-slate-500 text-[10px]">Panabo City Terminal</p>
                    </div>
                </div>
            </div>
        </aside>
    );
}
