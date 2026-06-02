import { Bay } from "../../types";
import { Bus, Car } from "lucide-react";

export function PublicBayCard({ bay }: { bay: Bay }) {
    const isAvailable = bay.status === "Available";
    const isOccupied = bay.status === "Occupied";
    const isOverstaying = bay.status === "Overstaying";

    // Determine colors based on state
    let cardClass = "";
    let textClass = "";
    let statusText = "";

    if (isAvailable) {
        cardClass =
            "bg-emerald-500/10 border-emerald-500 shadow-[inset_0_0_40px_rgba(16,185,129,0.1),0_0_20px_rgba(16,185,129,0.2)]";
        textClass = "text-emerald-400";
        statusText = "OPEN SLOT";
    } else if (isOccupied) {
        cardClass =
            "bg-amber-400/10 border-amber-400 shadow-[inset_0_0_40px_rgba(251,191,36,0.1),0_0_20px_rgba(251,191,36,0.2)]";
        textClass = "text-amber-400";
        statusText = "OCCUPIED";
    } else if (isOverstaying) {
        cardClass =
            "bg-red-500/20 border-red-500 shadow-[inset_0_0_60px_rgba(239,68,68,0.2),0_0_30px_rgba(239,68,68,0.4)]";
        textClass = "text-red-500";
        statusText = "OVERSTAYING";
    }

    return (
        <div
            className={`relative flex-1 h-[28vh] -skew-x-[20deg] border-4 rounded-xl flex items-center justify-center transition-all ${cardClass} backdrop-blur-sm overflow-hidden`}
        >
            {/* Inner wrapper to un-skew content */}
            <div className="absolute inset-0 skew-x-[20deg] flex flex-col items-center justify-center p-6 text-center">
                <h3 className="text-white font-black text-5xl tracking-tighter mb-2 drop-shadow-lg">
                    BAY {bay.id}
                </h3>

                {bay.vehicleType && (
                    <div className="flex items-center gap-2 mb-2 bg-slate-900/60 px-4 py-2 rounded-full border border-slate-700">
                        {bay.vehicleType === "Bus" ? (
                            <Bus size={20} className="text-indigo-400" />
                        ) : (
                            <Car size={20} className="text-indigo-400" />
                        )}
                        <span className="text-white font-bold text-lg">
                            {bay.vehicleType}
                        </span>
                    </div>
                )}

                <div
                    className={`font-black text-2xl tracking-widest mt-auto ${textClass} drop-shadow-md`}
                >
                    {statusText}
                </div>

                {isOverstaying && (
                    <div className="absolute inset-0 bg-red-500/20 animate-pulse pointer-events-none"></div>
                )}
            </div>
        </div>
    );
}
