import { useState } from "react";
import { AlertTriangle, VideoOff, Cloud, MapPin, Bell } from "lucide-react";

const MOCK_NOTIFICATIONS = [
    {
        id: 1,
        title: "Overstay Violation:",
        message:
            "Bay 7 (Bus) has exceeded the 15-minute limit. Audio PA warning dispatched.",
        time: "Just now",
        timeClass: "text-indigo-600 font-semibold",
        Icon: AlertTriangle,
        iconColor: "text-red-600",
        iconBg: "bg-red-100",
        indicator: "bg-red-500",
    },
    {
        id: 2,
        title: "Camera Feed Unstable:",
        message:
            "Southbound Camera 2 is experiencing packet loss. Retrying connection...",
        time: "5 mins ago",
        timeClass: "text-indigo-600 font-semibold",
        Icon: VideoOff,
        iconColor: "text-amber-600",
        iconBg: "bg-amber-100",
        indicator: "bg-amber-400",
    },
    {
        id: 3,
        title: "Cloud Sync Complete:",
        message: "Offline logs successfully backed up to LGU remote database.",
        time: "1 hour ago",
        timeClass: "text-slate-400",
        Icon: Cloud,
        iconColor: "text-emerald-600",
        iconBg: "bg-emerald-100",
    },
];

export function Header({
    clock,
    date,
    onViewViolations,
}: {
    clock: string;
    date: string;
    onViewViolations: () => void;
}) {
    const [showNotifications, setShowNotifications] = useState(false);
    const [unreadCount, setUnreadCount] = useState(3);

    return (
        <header className="h-16 bg-white border-b border-slate-200 flex items-center px-6 gap-4 flex-shrink-0 shadow-sm relative z-50">
            {/* Page title */}
            <div className="flex-1">
                <h1 className="text-slate-800 font-bold text-base leading-tight">
                    Terminal Overview
                </h1>
                <p className="text-slate-400 text-[11px] flex items-center gap-1">
                    <MapPin size={10} />
                    Panabo City Bus Terminal · Panabo City, Davao del Norte
                </p>
            </div>

            {/* Date & Clock */}
            <div className="hidden md:flex flex-col items-end">
                <span className="text-slate-800 font-mono text-sm font-bold">
                    {clock}
                </span>
                <span className="text-slate-400 text-[11px]">{date}</span>
            </div>

            {/* Notification bell */}
            <div className="relative">
                <button
                    onClick={() => setShowNotifications(!showNotifications)}
                    className={`relative p-2 rounded-xl transition-colors ${showNotifications ? "bg-indigo-50 text-indigo-600" : "hover:bg-slate-100 text-slate-600"}`}
                >
                    <Bell size={20} />
                    {unreadCount > 0 && (
                        <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center border-2 border-white">
                            {unreadCount}
                        </span>
                    )}
                </button>

                {/* Dropdown Menu */}
                {showNotifications && (
                    <div className="absolute right-0 top-full mt-2 w-96 bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden">
                        {/* Dropdown Header */}
                        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                            <h3 className="font-bold text-slate-800 text-sm">
                                System Alerts
                            </h3>
                            <button
                                onClick={() => setUnreadCount(0)}
                                className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
                            >
                                Mark all as read
                            </button>
                        </div>

                        {/* Notification List */}
                        <div className="max-h-96 overflow-y-auto divide-y divide-slate-100">
                            {MOCK_NOTIFICATIONS.map((notif) => (
                                <div
                                    key={notif.id}
                                    className={`px-4 py-3 hover:bg-slate-50 transition-colors cursor-pointer flex gap-3 ${notif.indicator && unreadCount > 0 ? "relative" : ""}`}
                                >
                                    {notif.indicator && unreadCount > 0 && (
                                        <div
                                            className={`absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 rounded-r-full ${notif.indicator}`}
                                        ></div>
                                    )}
                                    <div
                                        className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${notif.iconBg}`}
                                    >
                                        <notif.Icon size={14} className={notif.iconColor} />
                                    </div>
                                    <div>
                                        <div className="flex items-center justify-between gap-2 mb-0.5">
                                            <span className="text-xs font-bold text-slate-800">
                                                {notif.title}
                                            </span>
                                            <span className={`text-[10px] ${notif.timeClass}`}>
                                                {notif.time}
                                            </span>
                                        </div>
                                        <p className="text-xs text-slate-600 leading-snug">
                                            {notif.message}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* View All Action */}
                        <div className="px-4 py-3 bg-slate-50 border-t border-slate-100">
                            <button
                                onClick={() => {
                                    setShowNotifications(false);
                                    onViewViolations();
                                }}
                                className="w-full text-center text-xs font-bold text-indigo-600 hover:text-indigo-800 transition-colors"
                            >
                                View all violation logs
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </header>
    );
}
