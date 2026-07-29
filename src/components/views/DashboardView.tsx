import { Bus, Car, ShieldAlert, CheckCircle2, Activity } from "lucide-react";
import { Bay } from "../../types";
import { DETECTIONS } from "../../mockData";
import { formatTimer } from "../../utils/helpers";
import { BayCard } from "../ui/BayCard";

// ─── Detection Feed ───────────────────────────────────────────────────────────

export function DetectionFeed() {
    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <h2 className="text-slate-800 font-semibold text-sm">
                        Recent Detections
                    </h2>
                </div>
                <span className="text-[10px] text-emerald-600 font-semibold bg-emerald-50 px-2 py-0.5 rounded-full">
                    YOLOv8 Live
                </span>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
                {DETECTIONS.map((d) => (
                    <div
                        key={d.id}
                        className="flex items-start gap-3 px-5 py-3 hover:bg-slate-50/80 transition-colors"
                    >
                        <div
                            className={`mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${d.action.includes("Overstay") ? "bg-red-100" : "bg-emerald-100"}`}
                        >
                            {d.vehicle === "Bus" ? (
                                <Bus
                                    size={14}
                                    className={
                                        d.action.includes("Overstay")
                                            ? "text-red-600"
                                            : "text-emerald-600"
                                    }
                                />
                            ) : (
                                <Car
                                    size={14}
                                    className={
                                        d.action.includes("Overstay")
                                            ? "text-red-600"
                                            : "text-emerald-600"
                                    }
                                />
                            )}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-slate-700 text-xs font-semibold leading-snug">
                                {d.vehicle} — Slot {d.slot}
                            </p>
                            <p
                                className={`text-[11px] font-medium ${d.action.includes("Overstay")
                                        ? "text-red-500"
                                        : "text-slate-400"
                                    }`}
                            >
                                {d.action}
                            </p>
                        </div>
                        <span className="text-[10px] text-slate-400 font-mono flex-shrink-0">
                            {d.time}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ─── Active Violations ────────────────────────────────────────────────────────

export function ViolationsPanel({ bays }: { bays: Bay[] }) {
    const violations = bays.filter((b) => b.status === "Overstaying");

    return (
        <div className="bg-white rounded-xl border border-red-200 shadow-sm flex flex-col">
            <div className="px-5 py-4 border-b border-red-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <ShieldAlert size={15} className="text-red-600" />
                    <h2 className="text-slate-800 font-semibold text-sm">
                        Active Violations
                    </h2>
                </div>
                <span className="text-[10px] text-red-600 font-bold bg-red-50 px-2 py-0.5 rounded-full border border-red-200">
                    {violations.length} Alert{violations.length !== 1 ? "s" : ""}
                </span>
            </div>

            {violations.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-slate-400">
                    <CheckCircle2 size={28} className="text-emerald-400 mb-2" />
                    <p className="text-xs">No active violations</p>
                </div>
            ) : (
                <div className="flex-1 divide-y divide-red-50">
                    {violations.map((bay) => (
                        <div
                            key={bay.id}
                            className="px-5 py-3 flex items-center gap-3 bg-red-50/60 hover:bg-red-50 transition-colors"
                        >
                            <div className="w-8 h-8 rounded-lg bg-red-600 flex items-center justify-center flex-shrink-0 shadow-sm">
                                <span className="text-white text-xs font-bold">{bay.id}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-red-800 text-xs font-bold leading-snug truncate">
                                    Bay {bay.id} — {bay.vehicleType}
                                </p>
                            </div>
                            <div className="text-right flex-shrink-0">
                                <p className="text-red-700 font-mono text-xs font-bold">
                                    -{formatTimer(bay.timeRemaining!)}
                                </p>
                                <p className="text-[9px] text-red-400">overstayed</p>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {violations.length > 0 && (
                <div className="px-5 py-3 border-t border-red-100 bg-red-50/40">
                    <div className="flex items-center gap-2">
                        <Activity size={12} className="text-red-500 animate-pulse" />
                        <p className="text-[11px] text-red-600 font-semibold">
                            Audio alert system is broadcasting on all channels
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Stats Bar ───────────────────────────────────────────────────────────────

export function StatsBar({ bays }: { bays: Bay[] }) {
    const available = bays.filter((b) => b.status === "Available").length;
    const occupied = bays.filter((b) => b.status === "Occupied").length;
    const overstaying = bays.filter((b) => b.status === "Overstaying").length;

    const stats = [
        {
            label: "Available Slots",
            value: available,
            color: "text-emerald-600",
            bg: "bg-white",
            border: "border-emerald-200",
            icon: <CheckCircle2 size={24} className="text-emerald-400" />
        },
        {
            label: "Occupied Slots",
            value: occupied,
            color: "text-amber-600",
            bg: "bg-white",
            border: "border-amber-200",
            icon: <Car size={24} className="text-amber-400" />
        },
        {
            label: "Active Violations",
            value: overstaying,
            color: "text-red-600",
            bg: "bg-white",
            border: "border-red-200",
            icon: <ShieldAlert size={24} className="text-red-400" />
        },
    ];

    return (
        <div className="grid grid-cols-3 gap-5">
            {stats.map(({ label, value, color, bg, border, icon }) => (
                <div key={label} className={`${bg} rounded-2xl p-5 flex items-center justify-between border ${border} shadow-sm transition-all hover:shadow-md`}>
                    <div className="flex flex-col">
                        <span className="text-slate-500 text-sm font-semibold mb-1">
                            {label}
                        </span>
                        <span className={`text-3xl font-extrabold ${color}`}>{value}</span>
                    </div>
                    <div className="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center border border-slate-100">
                        {icon}
                    </div>
                </div>
            ))}
        </div>
    );
}

export function DashboardView({ bays }: { bays: Bay[] }) {
    return (
        <div className="flex flex-col gap-5">
            {/* Stats bar */}
            <StatsBar bays={bays} />

            {/* Main 2/3 + 1/3 split */}
            <div className="flex gap-5 min-h-0">
                {/* 2/3 — Bay Grid */}
                <div className="flex-[2] min-w-0">
                    {/* ── Spatial Map ── */}
                    <div className="bg-slate-800 rounded-2xl p-6 shadow-xl border border-slate-700 space-y-6">
                        {/* Integrated Header */}
                        <div className="flex items-center justify-between border-b border-slate-700 pb-4">
                            <div>
                                <h2 className="text-white font-bold text-lg tracking-wide flex items-center gap-2">
                                    2D Spatial Terminal Map
                                </h2>
                                <p className="text-slate-400 text-xs font-medium mt-1">
                                    Real-time occupancy and automated detection zones
                                </p>
                            </div>
                            <div className="flex items-center gap-5 text-xs font-bold text-slate-300 bg-slate-900/50 px-4 py-2 rounded-full border border-slate-700">
                                <span className="flex items-center gap-2">
                                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                                    Available
                                </span>
                                <span className="flex items-center gap-2">
                                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.5)]" />
                                    Occupied
                                </span>
                                <span className="flex items-center gap-2">
                                    <span className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]" />
                                    Overstaying
                                </span>
                            </div>
                        </div>
                        {/* Northbound Terminal — Bays 1–5 */}
                        <div>
                            <div className="flex items-center gap-2 mb-3">
                                <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
                                <h3 className="text-slate-200 font-extrabold text-xs uppercase tracking-widest">
                                    Northbound Terminal
                                </h3>
                                <span className="text-slate-500 text-[10px] font-medium">
                                    Bays 1–5
                                </span>
                            </div>
                            <div className="grid grid-cols-5 gap-3">
                                {bays
                                    .filter((b) => b.type === "Northbound")
                                    .map((bay) => (
                                        <BayCard key={bay.id} bay={bay} />
                                    ))}
                            </div>
                        </div>

                        {/* Road Lane divider */}
                        <div className="flex items-center gap-2">
                            <div className="flex-1 h-px bg-slate-600" />
                            <span className="text-slate-500 text-[9px] font-bold uppercase tracking-widest px-2">
                                Road Lane
                            </span>
                            <div className="flex-1 h-px bg-slate-600" />
                        </div>

                        {/* Southbound Terminal — Bays 6–10 */}
                        <div>
                            <div className="flex items-center gap-2 mb-3">
                                <span className="w-2 h-2 rounded-full bg-teal-400 inline-block" />
                                <h3 className="text-slate-200 font-extrabold text-xs uppercase tracking-widest">
                                    Southbound Terminal
                                </h3>
                                <span className="text-slate-500 text-[10px] font-medium">
                                    Bays 6–10
                                </span>
                            </div>
                            <div className="grid grid-cols-5 gap-3">
                                {bays
                                    .filter((b) => b.type === "Southbound")
                                    .map((bay) => (
                                        <BayCard key={bay.id} bay={bay} />
                                    ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* 1/3 — Feed panel */}
                <div className="w-80 flex-shrink-0 flex flex-col gap-4">
                    <ViolationsPanel bays={bays} />
                    <DetectionFeed />
                </div>
            </div>
        </div>
    );
}
