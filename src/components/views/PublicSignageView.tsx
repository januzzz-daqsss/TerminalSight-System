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
            <div className="flex items-center justify-between px-10 py-6 bg-slate-900 border-b-4 border-indigo-600 shadow-2xl flex-shrink-0 z-10">
                <div className="flex items-center gap-6">
                    <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-500/50">
                        <Bus size={32} className="text-white" />
                    </div>
                    <div>
                        <h1 className="text-white font-black text-4xl tracking-tight">
                            PANABO CITY BUS TERMINAL
                        </h1>
                        <p className="text-indigo-400 font-bold text-xl tracking-widest uppercase mt-1">
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

            {/* Main Grid */}
            <div className="flex-1 flex flex-col justify-center px-10 py-8 relative overflow-hidden bg-slate-950">
                {/* Decorative Grid Lines */}
                <div
                    className="absolute inset-0 opacity-10 pointer-events-none"
                    style={{
                        backgroundImage:
                            "linear-gradient(to right, #334155 1px, transparent 1px), linear-gradient(to bottom, #334155 1px, transparent 1px)",
                        backgroundSize: "64px 64px",
                    }}
                ></div>

                {/* Northbound Row */}
                <div className="relative z-10 mb-8">
                    <h2 className="text-slate-300 font-black text-3xl mb-8 flex items-center gap-4">
                        <span className="w-4 h-4 rounded-full bg-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.8)]"></span>
                        NORTHBOUND TERMINAL
                    </h2>
                    <div className="flex justify-between gap-6 px-4">
                        {bays
                            .filter((b) => b.type === "Northbound")
                            .map((bay) => (
                                <PublicBayCard key={bay.id} bay={bay} />
                            ))}
                    </div>
                </div>

                {/* Road Divider */}
                <div className="relative z-10 flex items-center gap-6 my-4 opacity-40">
                    <div className="flex-1 border-t-4 border-dashed border-slate-600"></div>
                    <span className="text-slate-500 font-black text-xl tracking-[0.5em] uppercase">
                        Road Lane
                    </span>
                    <div className="flex-1 border-t-4 border-dashed border-slate-600"></div>
                </div>

                {/* Southbound Row */}
                <div className="relative z-10 mt-8">
                    <h2 className="text-slate-300 font-black text-3xl mb-8 flex items-center gap-4">
                        <span className="w-4 h-4 rounded-full bg-teal-500 shadow-[0_0_15px_rgba(20,184,166,0.8)]"></span>
                        SOUTHBOUND TERMINAL
                    </h2>
                    <div className="flex justify-between gap-6 px-4">
                        {bays
                            .filter((b) => b.type === "Southbound")
                            .map((bay) => (
                                <PublicBayCard key={bay.id} bay={bay} />
                            ))}
                    </div>
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
