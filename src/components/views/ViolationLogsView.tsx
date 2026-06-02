import { useState, useEffect } from "react";
import {
    Bus,
    Car,
    CheckCircle2,
    Timer,
    ChevronRight,
    Activity,
    Download,
    Calendar,
    FileText,
    Search,
    ChevronLeft,
} from "lucide-react";

// ─── Violation Logs Component ──────────────────────────────────────────────────

const BASE_MOCK_VIOLATIONS = [
    {
        id: "VL-2084",
        timestamp: "May 9, 2026, 08:34 AM",
        slot: "Slot 3 - Northbound",
        vehicle: "UV Express",
        limit: "15 mins",
        overstay: "+07:12 mins",
        action: "Audio Alert Broadcasted",
    },
    {
        id: "VL-2083",
        timestamp: "May 9, 2026, 08:12 AM",
        slot: "Slot 7 - Southbound",
        vehicle: "Bus",
        limit: "15 mins",
        overstay: "+12:45 mins",
        action: "Fine Issued / Logged",
    },
    {
        id: "VL-2082",
        timestamp: "May 9, 2026, 07:55 AM",
        slot: "Slot 2 - Northbound",
        vehicle: "UV Express",
        limit: "10 mins",
        overstay: "+02:30 mins",
        action: "Audio Alert Broadcasted",
    },
    {
        id: "VL-2081",
        timestamp: "May 8, 2026, 06:45 PM",
        slot: "Slot 9 - Southbound",
        vehicle: "Bus",
        limit: "15 mins",
        overstay: "+18:20 mins",
        action: "Fine Issued / Logged",
    },
    {
        id: "VL-2080",
        timestamp: "May 8, 2026, 05:10 PM",
        slot: "Slot 1 - Northbound",
        vehicle: "Bus",
        limit: "15 mins",
        overstay: "+05:10 mins",
        action: "Resolved",
    },
    {
        id: "VL-2079",
        timestamp: "May 8, 2026, 04:30 PM",
        slot: "Slot 4 - Northbound",
        vehicle: "UV Express",
        limit: "10 mins",
        overstay: "+04:22 mins",
        action: "Resolved",
    },
    {
        id: "VL-2078",
        timestamp: "May 8, 2026, 02:15 PM",
        slot: "Slot 8 - Southbound",
        vehicle: "UV Express",
        limit: "15 mins",
        overstay: "+09:15 mins",
        action: "Fine Issued / Logged",
    },
    {
        id: "VL-2077",
        timestamp: "May 8, 2026, 11:20 AM",
        slot: "Slot 6 - Southbound",
        vehicle: "Bus",
        limit: "15 mins",
        overstay: "+06:40 mins",
        action: "Resolved",
    },
    {
        id: "VL-2076",
        timestamp: "May 8, 2026, 09:45 AM",
        slot: "Slot 5 - Northbound",
        vehicle: "UV Express",
        limit: "10 mins",
        overstay: "+08:05 mins",
        action: "Audio Alert Broadcasted",
    },
    {
        id: "VL-2075",
        timestamp: "May 8, 2026, 08:10 AM",
        slot: "Slot 10 - Southbound",
        vehicle: "Bus",
        limit: "15 mins",
        overstay: "+14:30 mins",
        action: "Fine Issued / Logged",
    },
];

const MOCK_VIOLATIONS_HISTORY = [
    ...BASE_MOCK_VIOLATIONS,
    ...BASE_MOCK_VIOLATIONS.map((v) => ({
        ...v,
        id: v.id + "-A",
        timestamp: v.timestamp.replace("May 9", "May 7").replace("May 8", "May 7"),
    })),
    ...BASE_MOCK_VIOLATIONS.map((v) => ({
        ...v,
        id: v.id + "-B",
        timestamp: v.timestamp.replace("May 9", "May 6").replace("May 8", "May 6"),
    })),
];

export function ViolationLogsView() {
    const [searchQuery, setSearchQuery] = useState("");
    const [zoneFilter, setZoneFilter] = useState("All Terminal Zones");
    const [vehicleFilter, setVehicleFilter] = useState("All Vehicle Classes");
    const [statusFilter, setStatusFilter] = useState("All Statuses");
    const [currentPage, setCurrentPage] = useState(1);

    const itemsPerPage = 10;

    const filteredLogs = MOCK_VIOLATIONS_HISTORY.filter((log) => {
        const matchesSearch =
            log.slot.toLowerCase().includes(searchQuery.toLowerCase()) ||
            log.action.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesZone =
            zoneFilter === "All Terminal Zones" || log.slot.includes(zoneFilter);
        const matchesVehicle =
            vehicleFilter === "All Vehicle Classes" || log.vehicle === vehicleFilter;
        const matchesStatus =
            statusFilter === "All Statuses" || log.action.includes(statusFilter);

        return matchesSearch && matchesZone && matchesVehicle && matchesStatus;
    });

    // Reset page to 1 when filters change
    useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery, zoneFilter, vehicleFilter, statusFilter]);

    const totalPages = Math.ceil(filteredLogs.length / itemsPerPage);
    const currentLogs = filteredLogs.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage,
    );

    const handleExportCSV = () => {
        if (filteredLogs.length === 0) return;

        const headers = [
            "Violation ID",
            "Timestamp",
            "Slot ID",
            "Vehicle Type",
            "Time Limit",
            "Overstay Duration",
            "Action Taken",
        ];
        const csvContent = [
            headers.join(","),
            ...filteredLogs.map(
                (log) =>
                    `"${log.id}","${log.timestamp}","${log.slot}","${log.vehicle}","${log.limit}","${log.overstay}","${log.action}"`,
            ),
        ].join("\n");

        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        const dateStr = new Date().toISOString().split("T")[0];
        link.href = url;
        link.setAttribute("download", `SlotSight_ViolationLogs_${dateStr}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    return (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-[calc(100vh-120px)]">
            {/* Header & Controls */}
            <div className="p-5 border-b border-slate-200 space-y-4 flex-shrink-0">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-slate-800 font-bold text-lg">Violation Logs</h2>
                        <p className="text-slate-500 text-sm">
                            Historical record of all overstaying vehicles and automated
                            actions
                        </p>
                    </div>
                    <button
                        onClick={handleExportCSV}
                        className="flex items-center gap-2 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 px-4 py-2 rounded-lg text-sm font-bold transition-colors border border-indigo-100"
                    >
                        <Download size={16} />
                        Export to CSV
                    </button>
                </div>

                {/* Filters */}
                <div className="flex items-center gap-3">
                    <div className="relative flex-1 max-w-sm">
                        <Search
                            size={16}
                            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                        />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search by Slot ID or Status..."
                            className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-shadow"
                        />
                    </div>
                    <select
                        value={zoneFilter}
                        onChange={(e) => setZoneFilter(e.target.value)}
                        className="bg-slate-50 border border-slate-200 text-slate-700 font-medium text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                        <option>All Terminal Zones</option>
                        <option>Northbound</option>
                        <option>Southbound</option>
                    </select>
                    <select
                        value={vehicleFilter}
                        onChange={(e) => setVehicleFilter(e.target.value)}
                        className="bg-slate-50 border border-slate-200 text-slate-700 font-medium text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                        <option>All Vehicle Classes</option>
                        <option>Bus</option>
                        <option>UV Express</option>
                    </select>
                    <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        className="bg-slate-50 border border-slate-200 text-slate-700 font-medium text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                        <option>All Statuses</option>
                        <option>Fine Issued / Logged</option>
                        <option>Resolved</option>
                        <option>Audio Alert Broadcasted</option>
                    </select>
                </div>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-auto">
                <table className="w-full text-left border-collapse min-w-[800px]">
                    <thead className="sticky top-0 bg-slate-100 shadow-sm z-10">
                        <tr className="border-b border-slate-200 text-xs text-slate-500 uppercase tracking-wider font-bold">
                            <th className="px-6 py-4">Timestamp</th>
                            <th className="px-6 py-4">Slot ID</th>
                            <th className="px-6 py-4">Vehicle Type</th>
                            <th className="px-6 py-4">Time Limit</th>
                            <th className="px-6 py-4">Overstay Duration</th>
                            <th className="px-6 py-4">Action Taken</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                        {currentLogs.map((log, idx) => (
                            <tr
                                key={log.id}
                                className={`${idx % 2 === 0 ? "bg-white" : "bg-slate-50/50"} hover:bg-indigo-50/30 transition-colors`}
                            >
                                <td className="px-6 py-4">
                                    <div className="flex items-center gap-2 text-slate-600">
                                        <Calendar size={14} className="text-slate-400" />
                                        <span className="font-medium whitespace-nowrap">
                                            {log.timestamp}
                                        </span>
                                    </div>
                                </td>
                                <td className="px-6 py-4">
                                    <span className="font-semibold text-slate-700">
                                        {log.slot}
                                    </span>
                                </td>
                                <td className="px-6 py-4">
                                    <span
                                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${log.vehicle === "Bus"
                                                ? "bg-blue-50 text-blue-700 border-blue-200"
                                                : "bg-purple-50 text-purple-700 border-purple-200"
                                            }`}
                                    >
                                        {log.vehicle === "Bus" ? (
                                            <Bus size={12} />
                                        ) : (
                                            <Car size={12} />
                                        )}
                                        {log.vehicle}
                                    </span>
                                </td>
                                <td className="px-6 py-4">
                                    <span className="text-slate-500 font-medium">
                                        {log.limit}
                                    </span>
                                </td>
                                <td className="px-6 py-4">
                                    <span className="inline-flex items-center gap-1 bg-red-50 text-red-700 font-bold text-xs px-2.5 py-1 rounded-full border border-red-200">
                                        <Timer size={12} />
                                        {log.overstay}
                                    </span>
                                </td>
                                <td className="px-6 py-4">
                                    <span
                                        className={`text-xs font-bold flex items-center gap-1.5 ${log.action.includes("Resolved")
                                                ? "text-emerald-600"
                                                : log.action.includes("Fine")
                                                    ? "text-amber-600"
                                                    : "text-indigo-600"
                                            }`}
                                    >
                                        {log.action.includes("Resolved") && (
                                            <CheckCircle2 size={14} />
                                        )}
                                        {log.action.includes("Fine") && <FileText size={14} />}
                                        {log.action.includes("Audio") && <Activity size={14} />}
                                        {log.action}
                                    </span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Pagination */}
            <div className="p-4 border-t border-slate-200 flex items-center justify-between bg-slate-50/80 flex-shrink-0">
                <span className="text-sm text-slate-500 font-medium">
                    Showing{" "}
                    <strong className="text-slate-700">
                        {filteredLogs.length === 0
                            ? 0
                            : (currentPage - 1) * itemsPerPage + 1}
                        -{Math.min(currentPage * itemsPerPage, filteredLogs.length)}
                    </strong>{" "}
                    of <strong className="text-slate-700">{filteredLogs.length}</strong>{" "}
                    entries
                </span>
                <div className="flex items-center gap-2">
                    <button
                        disabled={currentPage === 1}
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        className="flex items-center gap-1 px-3 py-1.5 border border-slate-200 bg-white rounded text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-50"
                    >
                        <ChevronLeft size={16} />
                        Previous
                    </button>
                    <button
                        disabled={currentPage === totalPages || totalPages === 0}
                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                        className="flex items-center gap-1 px-3 py-1.5 border border-slate-200 bg-white rounded text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-50"
                    >
                        Next
                        <ChevronRight size={16} />
                    </button>
                </div>
            </div>
        </div>
    );
}
