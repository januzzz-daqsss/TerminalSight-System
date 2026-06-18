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
            className={`relative flex-1 h-[32vh] lg:h-[30vh] -skew-x-[15deg] border-2 rounded-xl flex items-center justify-center transition-all ${cardClass} backdrop-blur-sm overflow-hidden min-w-0`}
        >
            {/* Inner wrapper to un-skew content */}
            <div className="absolute inset-0 skew-x-[15deg] flex flex-col items-center justify-between py-3 px-1 md:py-4 md:px-2 text-center h-full">
                <h3 className="text-white font-black text-xl lg:text-2xl tracking-tighter drop-shadow-md whitespace-nowrap">
                    BAY {bay.id}
                </h3>

                {bay.vehicleType ? (
                    <div className="flex items-center gap-1.5 bg-slate-900/60 px-2 py-1 rounded-full border border-slate-700 whitespace-nowrap">
                        {bay.vehicleType === "Bus" ? (
                            <Bus size={14} className="text-emerald-400 flex-shrink-0" />
                        ) : (
                            <Car size={14} className="text-emerald-400 flex-shrink-0" />
                        )}
                        <span className="text-white font-bold text-xs lg:text-sm">
                            {bay.vehicleType}
                        </span>
                    </div>
                ) : (
                    <div className="h-6"></div> // Spacer to keep layout balanced
                )}

                <div
                    className={`font-black text-[10px] lg:text-xs tracking-widest ${textClass} drop-shadow-md whitespace-nowrap`}
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
