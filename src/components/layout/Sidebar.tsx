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
}: {
    activeTab: string;
    setActiveTab: (tab: string) => void;
    onLogout: () => void;
}) {
    return (
        <aside className="w-64 min-h-screen bg-slate-900 flex flex-col flex-shrink-0 print-hide">
            {/* Branding */}
            <div className="px-6 py-6 border-b border-slate-700/60">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center shadow-lg">
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

            {/* System status pill */}
            <div className="mx-4 mt-4 px-3 py-2 rounded-lg bg-slate-800 flex items-center gap-2">
                <Wifi size={12} className="text-emerald-400" />
                <span className="text-emerald-400 text-[11px] font-semibold">
                    System Online
                </span>
                <span className="ml-auto w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            </div>

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
                                    ? "bg-indigo-600 text-white shadow-md shadow-indigo-500/30"
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
                        onClick={() =>
                            window.open("/signage", "_blank", "noopener,noreferrer")
                        }
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-bold transition-all duration-150 bg-indigo-600/20 text-indigo-400 hover:bg-indigo-600/30"
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
                    <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center">
                        <span className="text-indigo-300 text-xs font-bold">AD</span>
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
