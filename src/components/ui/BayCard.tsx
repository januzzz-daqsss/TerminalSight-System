import {
    CheckCircle2,
    Timer,
    ShieldAlert,
    Bus,
    Car,
    MapPin,
    Clock,
    Activity,
} from "lucide-react";
import { Bay } from "../../types";
import { formatTimer } from "../../utils/helpers";

export function BayCard({ bay }: { bay: Bay }) {
    const isAvailable = bay.status === "Available";
    const isOccupied = bay.status === "Occupied";
    const isOverstaying = bay.status === "Overstaying";

    const cardBase =
        "relative flex flex-col rounded-xl border-2 p-4 transition-all duration-300 select-none";

    const cardStyle = isAvailable
        ? `${cardBase} bg-emerald-50 border-emerald-400 shadow-sm`
        : isOccupied
            ? `${cardBase} bg-amber-50 border-amber-400 shadow-md`
            : `${cardBase} bg-red-50 border-red-500 shadow-lg`;

    return (
        <div className={cardStyle}>
            {/* Overstay pulse ring */}
            {isOverstaying && (
                <span className="absolute inset-0 rounded-xl border-2 border-red-500 animate-ping opacity-30 pointer-events-none" />
            )}

            {/* Bay header */}
            <div className="flex items-center justify-between mb-2">
                <span
                    className={`text-xs font-bold tracking-widest uppercase ${isAvailable
                            ? "text-emerald-700"
                            : isOccupied
                                ? "text-amber-700"
                                : "text-red-700"
                        }`}
                >
                    Bay {bay.id}
                </span>

                {isAvailable && (
                    <span className="flex items-center gap-1 text-[10px] font-semibold bg-emerald-500 text-white px-2 py-0.5 rounded-full">
                        <CheckCircle2 size={10} /> Available
                    </span>
                )}
                {isOccupied && (
                    <span className="flex items-center gap-1 text-[10px] font-semibold bg-amber-500 text-white px-2 py-0.5 rounded-full">
                        <Timer size={10} /> Occupied
                    </span>
                )}
                {isOverstaying && (
                    <span className="flex items-center gap-1 text-[10px] font-semibold bg-red-600 text-white px-2 py-0.5 rounded-full animate-pulse">
                        <ShieldAlert size={10} /> Overstaying
                    </span>
                )}
            </div>

            {/* Available body */}
            {isAvailable && (
                <div className="flex flex-col items-center justify-center flex-1 py-3 gap-1">
                    <div className="w-10 h-10 rounded-full bg-emerald-200 flex items-center justify-center">
                        <CheckCircle2 size={22} className="text-emerald-600" />
                    </div>
                    <p className="text-emerald-700 font-semibold text-sm mt-1">
                        Open Slot
                    </p>
                    <p className="text-emerald-500 text-[11px]">Ready for entry</p>
                </div>
            )}

            {/* Occupied / Overstaying body */}
            {(isOccupied || isOverstaying) && (
                <div className="flex flex-col gap-2 flex-1">
                    <div className="flex items-center gap-2">
                        {bay.vehicleType === "Bus" ? (
                            <Bus
                                size={16}
                                className={isOccupied ? "text-amber-600" : "text-red-600"}
                            />
                        ) : (
                            <Car
                                size={16}
                                className={isOccupied ? "text-amber-600" : "text-red-600"}
                            />
                        )}
                        <span
                            className={`text-sm font-bold ${isOccupied ? "text-amber-800" : "text-red-800"}`}
                        >
                            {bay.vehicleType}
                        </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                        <MapPin
                            size={12}
                            className={isOccupied ? "text-amber-500" : "text-red-500"}
                        />
                        <span
                            className={`text-[11px] ${isOccupied ? "text-amber-700" : "text-red-700"}`}
                        >
                            Local Terminal
                        </span>
                    </div>

                    <div
                        className={`mt-auto rounded-lg px-3 py-2 flex items-center justify-between ${isOccupied ? "bg-amber-100" : "bg-red-100"
                            }`}
                    >
                        <Clock
                            size={13}
                            className={isOccupied ? "text-amber-600" : "text-red-600"}
                        />
                        <span
                            className={`font-mono text-sm font-bold ${isOccupied ? "text-amber-800" : "text-red-800"}`}
                        >
                            {isOccupied
                                ? `${formatTimer(bay.timeRemaining!)} remaining`
                                : `-${formatTimer(bay.timeRemaining!)} overstayed`}
                        </span>
                    </div>

                    {isOverstaying && (
                        <div className="flex items-center gap-1.5 bg-red-600 text-white rounded-lg px-3 py-1.5">
                            <Activity size={12} className="animate-pulse" />
                            <span className="text-[10px] font-bold tracking-wide uppercase">
                                Audio Alert Triggered
                            </span>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
