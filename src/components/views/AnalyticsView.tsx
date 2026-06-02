import { useState } from "react";
import {
    Bus,
    Car,
    Clock,
    ShieldAlert,
    Timer,
    Activity,
    Download,
    Calendar,
} from "lucide-react";
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip as RechartsTooltip,
    ResponsiveContainer,
    LineChart,
    Line,
    Legend,
} from "recharts";

// ─── Analytics Component ──────────────────────────────────────────────────────
// Visualizes terminal performance metrics using Recharts.

const MOCK_PEAK_DATA = [
    { time: "6:00 AM", volume: 12 },
    { time: "8:00 AM", volume: 45 },
    { time: "10:00 AM", volume: 32 },
    { time: "12:00 PM", volume: 60 },
    { time: "2:00 PM", volume: 38 },
    { time: "4:00 PM", volume: 55 },
    { time: "6:00 PM", volume: 75 },
    { time: "8:00 PM", volume: 20 },
];

const MOCK_DURATION_DATA = [
    { time: "6:00 AM", avgBus: 12, avgUV: 6 },
    { time: "8:00 AM", avgBus: 18, avgUV: 10 },
    { time: "10:00 AM", avgBus: 14, avgUV: 7 },
    { time: "12:00 PM", avgBus: 22, avgUV: 12 },
    { time: "2:00 PM", avgBus: 15, avgUV: 8 },
    { time: "4:00 PM", avgBus: 20, avgUV: 11 },
    { time: "6:00 PM", avgBus: 25, avgUV: 14 },
    { time: "8:00 PM", avgBus: 13, avgUV: 6 },
];

const MOCK_VIOLATION_LOGS = [
    {
        id: "V-1042",
        date: "May 8, 2026",
        time: "10:47 PM",
        slot: 3,
        vehicle: "UV Express",
        overstay: "4m 12s",
    },
    {
        id: "V-1041",
        date: "May 8, 2026",
        time: "10:30 PM",
        slot: 7,
        vehicle: "Bus",
        overstay: "12m 45s",
    },
    {
        id: "V-1040",
        date: "May 8, 2026",
        time: "08:15 PM",
        slot: 2,
        vehicle: "UV Express",
        overstay: "2m 30s",
    },
    {
        id: "V-1039",
        date: "May 8, 2026",
        time: "06:45 PM",
        slot: 9,
        vehicle: "Bus",
        overstay: "18m 20s",
    },
    {
        id: "V-1038",
        date: "May 8, 2026",
        time: "05:10 PM",
        slot: 1,
        vehicle: "Bus",
        overstay: "5m 10s",
    },
];

const MOCK_DATA_SETS = {
    Today: {
        avgOverall: "11m",
        avgBus: "14m",
        avgUV: "8m",
        utilization: 82,
        utilChange: "+4% vs yesterday",
        violations: 14,
        violBus: 9,
        violUV: 5,
        violChange: "-2 vs yesterday",
        peak: MOCK_PEAK_DATA,
        duration: MOCK_DURATION_DATA,
    },
    "Last 7 Days": {
        avgOverall: "13m",
        avgBus: "16m",
        avgUV: "10m",
        utilization: 75,
        utilChange: "+2% vs last week",
        violations: 89,
        violBus: 52,
        violUV: 37,
        violChange: "-5 vs last week",
        peak: [
            { time: "6:00 AM", volume: 80 },
            { time: "8:00 AM", volume: 210 },
            { time: "10:00 AM", volume: 150 },
            { time: "12:00 PM", volume: 300 },
            { time: "2:00 PM", volume: 190 },
            { time: "4:00 PM", volume: 260 },
            { time: "6:00 PM", volume: 350 },
            { time: "8:00 PM", volume: 110 },
        ],
        duration: [
            { time: "6:00 AM", avgBus: 14, avgUV: 8 },
            { time: "8:00 AM", avgBus: 20, avgUV: 12 },
            { time: "10:00 AM", avgBus: 16, avgUV: 9 },
            { time: "12:00 PM", avgBus: 25, avgUV: 14 },
            { time: "2:00 PM", avgBus: 18, avgUV: 10 },
            { time: "4:00 PM", avgBus: 22, avgUV: 13 },
            { time: "6:00 PM", avgBus: 28, avgUV: 16 },
            { time: "8:00 PM", avgBus: 15, avgUV: 8 },
        ],
    },
    "This Month": {
        avgOverall: "12m",
        avgBus: "15m",
        avgUV: "9m",
        utilization: 78,
        utilChange: "+1% vs last month",
        violations: 342,
        violBus: 210,
        violUV: 132,
        violChange: "+12 vs last month",
        peak: [
            { time: "6:00 AM", volume: 320 },
            { time: "8:00 AM", volume: 850 },
            { time: "10:00 AM", volume: 620 },
            { time: "12:00 PM", volume: 1200 },
            { time: "2:00 PM", volume: 750 },
            { time: "4:00 PM", volume: 1050 },
            { time: "6:00 PM", volume: 1400 },
            { time: "8:00 PM", volume: 420 },
        ],
        duration: [
            { time: "6:00 AM", avgBus: 13, avgUV: 7 },
            { time: "8:00 AM", avgBus: 19, avgUV: 11 },
            { time: "10:00 AM", avgBus: 15, avgUV: 8 },
            { time: "12:00 PM", avgBus: 23, avgUV: 13 },
            { time: "2:00 PM", avgBus: 17, avgUV: 9 },
            { time: "4:00 PM", avgBus: 21, avgUV: 12 },
            { time: "6:00 PM", avgBus: 26, avgUV: 15 },
            { time: "8:00 PM", avgBus: 14, avgUV: 7 },
        ],
    },
};

export function AnalyticsView() {
    const [dateRange, setDateRange] = useState<
        "Today" | "Last 7 Days" | "This Month"
    >("Today");
    const [showExportMenu, setShowExportMenu] = useState(false);
    const currentData = MOCK_DATA_SETS[dateRange];

    const handleExportCSV = () => {
        const headers = [
            "Violation ID",
            "Date",
            "Time",
            "Slot ID",
            "Vehicle Type",
            "Overstay Duration",
        ];
        const csvContent = [
            headers.join(","),
            ...MOCK_VIOLATION_LOGS.map(
                (log) =>
                    `"${log.id}","${log.date}","${log.time}","${log.slot}","${log.vehicle}","${log.overstay}"`,
            ),
        ].join("\n");

        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        const dateStr = new Date().toISOString().split("T")[0];
        link.href = url;
        link.setAttribute("download", `Analytics_ViolationLogs_${dateStr}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-slate-800 font-bold text-lg">
                        Analytics Dashboard
                    </h2>
                    <p className="text-slate-500 text-sm">
                        Terminal performance and historical data
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <div className="relative">
                        <select
                            value={dateRange}
                            onChange={(e) => setDateRange(e.target.value as any)}
                            className="appearance-none flex items-center gap-2 bg-white border border-slate-200 text-slate-600 pl-9 pr-8 py-1.5 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                        >
                            <option value="Today">Today</option>
                            <option value="Last 7 Days">Last 7 Days</option>
                            <option value="This Month">This Month</option>
                        </select>
                        <Calendar
                            size={16}
                            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                        />
                    </div>
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-3 gap-5">
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-2 print-break-avoid">
                    <div className="flex items-center gap-2 text-indigo-600 mb-1">
                        <Clock size={18} />
                        <span className="text-sm font-semibold text-slate-600">
                            Avg Turnaround Time
                        </span>
                    </div>
                    <div className="flex items-baseline gap-2">
                        <span className="text-3xl font-extrabold text-slate-800">
                            {currentData.avgOverall}
                        </span>
                        <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
                            Overall
                        </span>
                    </div>
                    <div className="flex items-center gap-3 mt-auto pt-2 border-t border-slate-100">
                        <span className="text-xs text-slate-500">
                            <strong className="text-slate-700">Bus:</strong>{" "}
                            {currentData.avgBus}
                        </span>
                        <span className="text-xs text-slate-500">
                            <strong className="text-slate-700">UV:</strong>{" "}
                            {currentData.avgUV}
                        </span>
                    </div>
                </div>

                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-2 print-break-avoid">
                    <div className="flex items-center gap-2 text-emerald-600 mb-1">
                        <Activity size={18} />
                        <span className="text-sm font-semibold text-slate-600">
                            Daily Slot Utilization
                        </span>
                    </div>
                    <div className="flex items-baseline gap-2">
                        <span className="text-3xl font-extrabold text-slate-800">
                            {currentData.utilization}%
                        </span>
                        <span
                            className={`text-xs font-semibold px-2 py-0.5 rounded-full ${currentData.utilization >= 80 ? "text-emerald-500 bg-emerald-50" : "text-amber-500 bg-amber-50"}`}
                        >
                            {currentData.utilChange}
                        </span>
                    </div>
                    <div className="mt-auto pt-2 border-t border-slate-100">
                        <div className="w-full bg-slate-100 rounded-full h-1.5 mt-1">
                            <div
                                className={`h-1.5 rounded-full ${currentData.utilization >= 80 ? "bg-emerald-500" : "bg-amber-500"}`}
                                style={{ width: `${currentData.utilization}%` }}
                            ></div>
                        </div>
                    </div>
                </div>

                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-2 print-break-avoid">
                    <div className="flex items-center gap-2 text-red-600 mb-1">
                        <ShieldAlert size={18} />
                        <span className="text-sm font-semibold text-slate-600">
                            Total Violations {dateRange}
                        </span>
                    </div>
                    <div className="flex items-baseline gap-2">
                        <span className="text-3xl font-extrabold text-slate-800">
                            {currentData.violations}
                        </span>
                        <span
                            className={`text-xs font-semibold px-2 py-0.5 rounded-full ${currentData.violChange.includes("-") ? "text-red-500 bg-red-50" : "text-amber-500 bg-amber-50"}`}
                        >
                            {currentData.violChange}
                        </span>
                    </div>
                    <div className="flex items-center gap-3 mt-auto pt-2 border-t border-slate-100">
                        <span className="text-xs text-slate-500">
                            <strong className="text-slate-700">Bus:</strong>{" "}
                            {currentData.violBus}
                        </span>
                        <span className="text-xs text-slate-500">
                            <strong className="text-slate-700">UV:</strong>{" "}
                            {currentData.violUV}
                        </span>
                    </div>
                </div>
            </div>

            {/* Charts */}
            <div className="grid grid-cols-2 gap-5">
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm print-break-avoid">
                    <h3 className="text-sm font-bold text-slate-800 mb-4">
                        Peak Congestion Hours
                    </h3>
                    <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                                data={currentData.peak}
                                margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                            >
                                <CartesianGrid
                                    strokeDasharray="3 3"
                                    vertical={false}
                                    stroke="#e2e8f0"
                                />
                                <XAxis
                                    dataKey="time"
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fontSize: 10, fill: "#64748b" }}
                                    dy={10}
                                />
                                <YAxis
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fontSize: 10, fill: "#64748b" }}
                                />
                                <RechartsTooltip
                                    cursor={{ fill: "#f1f5f9" }}
                                    contentStyle={{
                                        borderRadius: "8px",
                                        border: "none",
                                        boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                                    }}
                                />
                                <Bar
                                    dataKey="volume"
                                    fill="#6366f1"
                                    radius={[4, 4, 0, 0]}
                                    barSize={30}
                                />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm print-break-avoid">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-bold text-slate-800">
                            Avg Loading Duration vs Limit
                        </h3>
                        <span className="text-[10px] font-semibold text-red-500 bg-red-50 px-2 py-0.5 rounded border border-red-200">
                            15m Limit
                        </span>
                    </div>
                    <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart
                                data={currentData.duration}
                                margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                            >
                                <CartesianGrid
                                    strokeDasharray="3 3"
                                    vertical={false}
                                    stroke="#e2e8f0"
                                />
                                <XAxis
                                    dataKey="time"
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fontSize: 10, fill: "#64748b" }}
                                    dy={10}
                                />
                                <YAxis
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fontSize: 10, fill: "#64748b" }}
                                />
                                <RechartsTooltip
                                    contentStyle={{
                                        borderRadius: "8px",
                                        border: "none",
                                        boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                                    }}
                                />
                                <Legend
                                    iconType="circle"
                                    wrapperStyle={{ fontSize: "11px", paddingTop: "10px" }}
                                />
                                <Line
                                    type="monotone"
                                    name="Bus Avg (m)"
                                    dataKey="avgBus"
                                    stroke="#f59e0b"
                                    strokeWidth={3}
                                    dot={{ r: 4 }}
                                    activeDot={{ r: 6 }}
                                />
                                <Line
                                    type="monotone"
                                    name="UV Avg (m)"
                                    dataKey="avgUV"
                                    stroke="#10b981"
                                    strokeWidth={3}
                                    dot={{ r: 4 }}
                                    activeDot={{ r: 6 }}
                                />
                                {/* 15m threshold line */}
                                <Line
                                    type="monotone"
                                    name="Threshold"
                                    dataKey={() => 15}
                                    stroke="#ef4444"
                                    strokeWidth={1}
                                    strokeDasharray="5 5"
                                    dot={false}
                                    activeDot={false}
                                />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* Table */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col print-break-avoid">
                <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
                    <h3 className="text-sm font-bold text-slate-800">
                        Recent Violation Export Logs
                    </h3>
                    <div className="relative print-hide">
                        <button
                            onClick={() => setShowExportMenu(!showExportMenu)}
                            className="flex items-center gap-2 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
                        >
                            <Download size={14} />
                            Export CSV/PDF
                        </button>
                        {showExportMenu && (
                            <div className="absolute right-0 top-full mt-1 w-40 bg-white rounded-lg shadow-lg border border-slate-200 overflow-hidden z-10">
                                <button
                                    onClick={() => {
                                        handleExportCSV();
                                        setShowExportMenu(false);
                                    }}
                                    className="w-full text-left px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                                >
                                    Download as CSV
                                </button>
                                <button
                                    onClick={() => {
                                        setShowExportMenu(false);
                                        setTimeout(() => window.print(), 100);
                                    }}
                                    className="w-full text-left px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 border-t border-slate-100"
                                >
                                    Save as PDF
                                </button>
                            </div>
                        )}
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500 uppercase tracking-wider font-bold">
                                <th className="px-5 py-3">Violation ID</th>
                                <th className="px-5 py-3">Date</th>
                                <th className="px-5 py-3">Time</th>
                                <th className="px-5 py-3">Slot ID</th>
                                <th className="px-5 py-3">Vehicle Type</th>
                                <th className="px-5 py-3">Overstay Duration</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-sm">
                            {MOCK_VIOLATION_LOGS.map((log) => (
                                <tr
                                    key={log.id}
                                    className="hover:bg-slate-50/50 transition-colors"
                                >
                                    <td className="px-5 py-3 font-mono font-medium text-slate-700">
                                        {log.id}
                                    </td>
                                    <td className="px-5 py-3 text-slate-600">{log.date}</td>
                                    <td className="px-5 py-3 text-slate-600">{log.time}</td>
                                    <td className="px-5 py-3">
                                        <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-slate-100 text-slate-700 font-bold text-xs">
                                            {log.slot}
                                        </span>
                                    </td>
                                    <td className="px-5 py-3">
                                        <div className="flex items-center gap-1.5">
                                            {log.vehicle === "Bus" ? (
                                                <Bus size={14} className="text-amber-500" />
                                            ) : (
                                                <Car size={14} className="text-emerald-500" />
                                            )}
                                            <span className="font-medium text-slate-700">
                                                {log.vehicle}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-5 py-3">
                                        <span className="inline-flex items-center gap-1.5 bg-red-50 text-red-700 font-semibold text-xs px-2.5 py-1 rounded-full border border-red-100">
                                            <Timer size={12} />
                                            {log.overstay}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

