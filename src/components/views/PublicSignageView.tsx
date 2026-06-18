import { Bay } from "../../types";
import { formatDate, formatClock } from "../../utils/helpers";
import { Bus } from "lucide-react";
import { PublicBayCard } from "../ui/PublicBayCard";

// ─── Public Signage Component ──────────────────────────────────────────────────
// Dedicated full-screen view for the external terminal display monitors.

export function PublicSignageView({ bays, now }: { bays: Bay[]; now: Date }) {
    const overstayingMsgs = bays
        .filter((b) => b.status === "Overstaying")
        .map(
            (b) =>
                `⚠️ ATTENTION: BAY ${b.id} ${b.vehicleType?.toUpperCase() || "VEHICLE"} PLEASE DEPART IMMEDIATELY.`,
        );

    const availableMsgs = bays
        .filter((b) => b.status === "Available")
        .map((b) => `🟢 BAY ${b.id} IS OPEN FOR ${b.type.toUpperCase()} ENTRY.`);

    const allMsgs = [...overstayingMsgs, ...availableMsgs];
    const tickerText =
        allMsgs.length > 0
            ? allMsgs.join("  •  ")
            : "⏱️ ALL BAYS CURRENTLY OCCUPIED. PLEASE WAIT FOR AN OPENING.";

    return (
        <div className="flex flex-col h-screen bg-slate-950 overflow-hidden font-sans">
            {/* Header */}
            <div className="flex items-center justify-between px-10 py-6 bg-slate-900/95 backdrop-blur-md border-b-4 border-emerald-600 shadow-2xl flex-shrink-0 z-20 relative">
                <div className="flex items-center gap-6">
                    <div className="w-16 h-16 bg-gradient-to-br from-emerald-500 to-amber-500 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-500/40">
                        <Bus size={32} className="text-white" />
                    </div>
                    <div>
                        <h1 className="text-white font-black text-4xl tracking-tight">
                            PANABO CITY BUS TERMINAL
                        </h1>
                        <p className="text-emerald-400 font-bold text-xl tracking-widest uppercase mt-1">
                            Live Bay Status
                        </p>
                    </div>
                </div>
                <div className="text-right">
                    <div className="text-white font-mono font-black text-5xl tracking-tight">
                        {formatClock(now)}
                    </div>
                    <div className="text-slate-400 font-bold text-xl mt-1">
                        {formatDate(now)}
                    </div>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col justify-center px-4 py-8 relative overflow-hidden bg-gradient-to-br from-slate-950 via-emerald-950/20 to-slate-900">
                {/* Panabo Theme Glowing Orbs */}
                <div className="absolute inset-0 z-0 pointer-events-none opacity-40">
                    <div className="absolute w-[800px] h-[800px] bg-emerald-600/30 rounded-full blur-[150px] -top-40 -left-40 animate-[pulse_4s_ease-in-out_infinite]"></div>
                    <div className="absolute w-[600px] h-[600px] bg-amber-500/20 rounded-full blur-[120px] bottom-0 right-10"></div>
                </div>

                {/* Decorative Grid Lines */}
                <div
                    className="absolute inset-0 opacity-10 pointer-events-none z-0"
                    style={{
                        backgroundImage:
                            "linear-gradient(to right, #334155 1px, transparent 1px), linear-gradient(to bottom, #334155 1px, transparent 1px)",
                        backgroundSize: "64px 64px",
                    }}
                ></div>

                {/* Terminals Grid Container */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-8 w-full z-10 mb-8 lg:mb-12">
                    {/* Northbound Column */}
                    <div className="w-full px-2">
                        <h2 className="text-slate-300 font-black text-xl lg:text-2xl mb-6 flex items-center gap-3">
                            <span className="w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.8)]"></span>
                            NORTHBOUND TERMINAL
                        </h2>
                        <div className="flex flex-row justify-between gap-2 lg:gap-3 w-full">
                            {bays
                                .filter((b) => b.type === "Northbound")
                                .map((bay) => (
                                    <PublicBayCard key={bay.id} bay={bay} />
                                ))}
                        </div>
                    </div>

                    {/* Southbound Column */}
                    <div className="w-full px-2">
                        <h2 className="text-slate-300 font-black text-xl lg:text-2xl mb-6 flex items-center gap-3">
                            <span className="w-3 h-3 rounded-full bg-teal-500 shadow-[0_0_15px_rgba(20,184,166,0.8)]"></span>
                            SOUTHBOUND TERMINAL
                        </h2>
                        <div className="flex flex-row justify-between gap-2 lg:gap-3 w-full">
                            {bays
                                .filter((b) => b.type === "Southbound")
                                .map((bay) => (
                                    <PublicBayCard key={bay.id} bay={bay} />
                                ))}
                        </div>
                    </div>
                </div>

                {/* Horizontal Road Divider (Moved Up directly under bays) */}
                <div className="flex items-center gap-6 opacity-40 z-10 px-8 w-full max-w-6xl mx-auto">
                    <div className="flex-1 border-t-4 border-dashed border-slate-600"></div>
                    <span className="text-slate-500 font-black text-xl tracking-[0.5em] uppercase">
                        ROAD LANE
                    </span>
                    <div className="flex-1 border-t-4 border-dashed border-slate-600"></div>
                </div>
            </div>

            {/* Ticker Footer */}
            <div className="h-20 bg-red-600 text-white flex items-center flex-shrink-0 relative overflow-hidden shadow-[0_-10px_30px_rgba(220,38,38,0.3)] z-10">
                <div className="animate-ticker text-3xl font-black tracking-widest flex gap-24 drop-shadow-md whitespace-nowrap">
                    <span>{tickerText}</span>
                    <span>{tickerText}</span>
                    <span>{tickerText}</span>
                    <span>{tickerText}</span>
                </div>
            </div>
        </div>
    );
}
