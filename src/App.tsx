import { useState, useEffect } from 'react'
import {
  LayoutDashboard,
  Camera,
  AlertTriangle,
  BarChart2,
  Settings,
  Bell,
  Bus,
  Car,
  Clock,
  MapPin,
  Wifi,
  ShieldAlert,
  CheckCircle2,
  Timer,
  ChevronRight,
  Activity,
  Download,
  Calendar,
  FileText,
  Plus,
  Video,
  Signal,
  Search,
  ChevronLeft,
  Save,
  RotateCcw,
  Volume2,
  Play,
  Cloud,
  Sliders,
  Globe,
  RefreshCw,
  VideoOff,
  User,
  Lock,
  ShieldCheck,
  LogOut,
  MonitorUp,
  ExternalLink,
  X
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
  LineChart, Line, Legend
} from 'recharts'

// ─── Types ────────────────────────────────────────────────────────────────────

type BayState = 'Available' | 'Occupied' | 'Overstaying'
type VehicleClass = 'Bus' | 'UV Express'

interface Bay {
  id: number
  type: 'Northbound' | 'Southbound'
  status: BayState
  vehicleType?: VehicleClass
  /** seconds remaining (positive = occupied, negative = overstaying) */
  timeRemaining?: number
  audioPlayed?: boolean
}

interface Detection {
  id: number
  time: string
  vehicle: VehicleClass
  slot: number
  action: string
}

// ─── Mock Data ────────────────────────────────────────────────────────────────

const initialBays: Bay[] = [
  { id: 1, type: 'Northbound', status: 'Available', timeRemaining: 0 },
  { id: 2, type: 'Northbound', status: 'Available', timeRemaining: 0 },
  { id: 3, type: 'Northbound', status: 'Available', timeRemaining: 0 },
  { id: 4, type: 'Northbound', status: 'Available', timeRemaining: 0 },
  { id: 5, type: 'Northbound', status: 'Available', timeRemaining: 0 },
  { id: 6, type: 'Southbound', status: 'Available', timeRemaining: 0 },
  { id: 7, type: 'Southbound', status: 'Available', timeRemaining: 0 },
  { id: 8, type: 'Southbound', status: 'Available', timeRemaining: 0 },
  { id: 9, type: 'Southbound', status: 'Available', timeRemaining: 0 },
  { id: 10, type: 'Southbound', status: 'Available', timeRemaining: 0 },
]

const DETECTIONS: Detection[] = [
  { id: 1, time: '11:18 PM', vehicle: 'Bus', slot: 10, action: 'Detected & Docked' },
  { id: 2, time: '11:15 PM', vehicle: 'UV Express', slot: 8, action: 'Detected & Docked' },
  { id: 3, time: '11:09 PM', vehicle: 'Bus', slot: 6, action: 'Detected & Docked' },
  { id: 4, time: '11:04 PM', vehicle: 'UV Express', slot: 4, action: 'Detected & Docked' },
  { id: 5, time: '10:58 PM', vehicle: 'Bus', slot: 1, action: 'Detected & Docked' },
  { id: 6, time: '10:47 PM', vehicle: 'UV Express', slot: 3, action: 'Overstay Flagged' },
  { id: 7, time: '10:30 PM', vehicle: 'Bus', slot: 7, action: 'Overstay Flagged' },
]

const NAV_ITEMS = [
  { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { id: 'camera', icon: Camera, label: 'Camera Zones' },
  { id: 'violations', icon: AlertTriangle, label: 'Violation Logs' },
  { id: 'analytics', icon: BarChart2, label: 'Analytics' },
  { id: 'settings', icon: Settings, label: 'Settings' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTimer(seconds: number): string {
  const abs = Math.abs(seconds)
  const m = Math.floor(abs / 60).toString().padStart(2, '0')
  const s = (abs % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-PH', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })
}

function formatClock(date: Date): string {
  return date.toLocaleTimeString('en-PH', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
  })
}

// ─── Bay Card ────────────────────────────────────────────────────────────────

function BayCard({ bay }: { bay: Bay }) {
  const isAvailable = bay.status === 'Available'
  const isOccupied = bay.status === 'Occupied'
  const isOverstaying = bay.status === 'Overstaying'

  const cardBase = 'relative flex flex-col rounded-xl border-2 p-4 transition-all duration-300 select-none'

  const cardStyle = isAvailable
    ? `${cardBase} bg-emerald-50 border-emerald-400 shadow-sm`
    : isOccupied
      ? `${cardBase} bg-amber-50 border-amber-400 shadow-md`
      : `${cardBase} bg-red-50 border-red-500 shadow-lg`

  return (
    <div className={cardStyle}>
      {/* Overstay pulse ring */}
      {isOverstaying && (
        <span className="absolute inset-0 rounded-xl border-2 border-red-500 animate-ping opacity-30 pointer-events-none" />
      )}

      {/* Bay header */}
      <div className="flex items-center justify-between mb-2">
        <span className={`text-xs font-bold tracking-widest uppercase ${isAvailable ? 'text-emerald-700' : isOccupied ? 'text-amber-700' : 'text-red-700'
          }`}>
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
          <p className="text-emerald-700 font-semibold text-sm mt-1">Open Slot</p>
          <p className="text-emerald-500 text-[11px]">Ready for entry</p>
        </div>
      )}

      {/* Occupied / Overstaying body */}
      {(isOccupied || isOverstaying) && (
        <div className="flex flex-col gap-2 flex-1">
          <div className="flex items-center gap-2">
            {bay.vehicleType === 'Bus'
              ? <Bus size={16} className={isOccupied ? 'text-amber-600' : 'text-red-600'} />
              : <Car size={16} className={isOccupied ? 'text-amber-600' : 'text-red-600'} />
            }
            <span className={`text-sm font-bold ${isOccupied ? 'text-amber-800' : 'text-red-800'}`}>
              {bay.vehicleType}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <MapPin size={12} className={isOccupied ? 'text-amber-500' : 'text-red-500'} />
            <span className={`text-[11px] ${isOccupied ? 'text-amber-700' : 'text-red-700'}`}>
              Local Terminal
            </span>
          </div>

          <div className={`mt-auto rounded-lg px-3 py-2 flex items-center justify-between ${isOccupied ? 'bg-amber-100' : 'bg-red-100'
            }`}>
            <Clock size={13} className={isOccupied ? 'text-amber-600' : 'text-red-600'} />
            <span className={`font-mono text-sm font-bold ${isOccupied ? 'text-amber-800' : 'text-red-800'}`}>
              {isOccupied
                ? `${formatTimer(bay.timeRemaining!)} remaining`
                : `-${formatTimer(bay.timeRemaining!)} overstayed`}
            </span>
          </div>

          {isOverstaying && (
            <div className="flex items-center gap-1.5 bg-red-600 text-white rounded-lg px-3 py-1.5">
              <Activity size={12} className="animate-pulse" />
              <span className="text-[10px] font-bold tracking-wide uppercase">Audio Alert Triggered</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

function Sidebar({ activeTab, setActiveTab, onLogout }: { activeTab: string, setActiveTab: (tab: string) => void, onLogout: () => void }) {
  return (
    <aside className="w-64 min-h-screen bg-slate-900 flex flex-col flex-shrink-0 print-hide">
      {/* Branding */}
      <div className="px-6 py-6 border-b border-slate-700/60">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center shadow-lg">
            <Bus size={18} className="text-white" />
          </div>
          <div>
            <p className="text-white font-bold text-sm leading-tight">SlotSight</p>
            <p className="text-slate-400 text-[10px] tracking-widest uppercase">Admin Console</p>
          </div>
        </div>
      </div>

      {/* System status pill */}
      <div className="mx-4 mt-4 px-3 py-2 rounded-lg bg-slate-800 flex items-center gap-2">
        <Wifi size={12} className="text-emerald-400" />
        <span className="text-emerald-400 text-[11px] font-semibold">System Online</span>
        <span className="ml-auto w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 mt-6 flex flex-col gap-1 pb-4">
        <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest px-3 mb-2">
          Main Menu
        </p>
        {NAV_ITEMS.map(({ id, icon: Icon, label }) => {
          const active = activeTab === id
          return (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 group ${active
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/30'
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
                }`}
            >
              <Icon size={17} />
              <span className="flex-1 text-left">{label}</span>
              {active && <ChevronRight size={14} className="opacity-60" />}
            </button>
          )
        })}

        <div className="mt-auto pt-4 flex flex-col gap-1">
          <button
            onClick={() => window.open('/signage', '_blank', 'noopener,noreferrer')}
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
  )
}

// ─── Header Component ─────────────────────────────────────────────────────────
// Displays current terminal location, live clock, and system notifications.

const MOCK_NOTIFICATIONS = [
  {
    id: 1,
    title: 'Overstay Violation:',
    message: 'Bay 7 (Bus) has exceeded the 15-minute limit. Audio PA warning dispatched.',
    time: 'Just now',
    timeClass: 'text-indigo-600 font-semibold',
    Icon: AlertTriangle,
    iconColor: 'text-red-600',
    iconBg: 'bg-red-100',
    indicator: 'bg-red-500',
  },
  {
    id: 2,
    title: 'Camera Feed Unstable:',
    message: 'Southbound Camera 2 is experiencing packet loss. Retrying connection...',
    time: '5 mins ago',
    timeClass: 'text-indigo-600 font-semibold',
    Icon: VideoOff,
    iconColor: 'text-amber-600',
    iconBg: 'bg-amber-100',
    indicator: 'bg-amber-400',
  },
  {
    id: 3,
    title: 'Cloud Sync Complete:',
    message: 'Offline logs successfully backed up to LGU remote database.',
    time: '1 hour ago',
    timeClass: 'text-slate-400',
    Icon: Cloud,
    iconColor: 'text-emerald-600',
    iconBg: 'bg-emerald-100',
  }
]

function Header({ clock, date, onViewViolations }: { clock: string; date: string; onViewViolations: () => void }) {
  const [showNotifications, setShowNotifications] = useState(false)
  const [unreadCount, setUnreadCount] = useState(3)

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
        <span className="text-slate-800 font-mono text-sm font-bold">{clock}</span>
        <span className="text-slate-400 text-[11px]">{date}</span>
      </div>

      {/* Notification bell */}
      <div className="relative">
        <button
          onClick={() => setShowNotifications(!showNotifications)}
          className={`relative p-2 rounded-xl transition-colors ${showNotifications ? 'bg-indigo-50 text-indigo-600' : 'hover:bg-slate-100 text-slate-600'}`}
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
              <h3 className="font-bold text-slate-800 text-sm">System Alerts</h3>
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
                <div key={notif.id} className={`px-4 py-3 hover:bg-slate-50 transition-colors cursor-pointer flex gap-3 ${notif.indicator && unreadCount > 0 ? 'relative' : ''}`}>
                  {notif.indicator && unreadCount > 0 && (
                    <div className={`absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 rounded-r-full ${notif.indicator}`}></div>
                  )}
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${notif.iconBg}`}>
                    <notif.Icon size={14} className={notif.iconColor} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-700 leading-snug">
                      <strong className="text-slate-900">{notif.title}</strong> {notif.message}
                    </p>
                    <p className={`text-xs mt-1 ${notif.timeClass}`}>{notif.time}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Dropdown Footer */}
            <div className="px-4 py-2 bg-slate-50 border-t border-slate-100 text-center">
              <button
                onClick={() => {
                  onViewViolations()
                  setShowNotifications(false)
                }}
                className="text-xs font-bold text-indigo-600 hover:text-indigo-800 py-1 transition-colors w-full"
              >
                View All Violation Logs
              </button>
            </div>
          </div>
        )}
      </div>
    </header>
  )
}

// ─── Detection Feed ───────────────────────────────────────────────────────────

function DetectionFeed() {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
          <h2 className="text-slate-800 font-semibold text-sm">Recent Detections</h2>
        </div>
        <span className="text-[10px] text-indigo-600 font-semibold bg-indigo-50 px-2 py-0.5 rounded-full">
          YOLOv8 Live
        </span>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
        {DETECTIONS.map((d) => (
          <div key={d.id} className="flex items-start gap-3 px-5 py-3 hover:bg-slate-50/80 transition-colors">
            <div className={`mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${d.action.includes('Overstay') ? 'bg-red-100' : 'bg-indigo-100'
              }`}>
              {d.vehicle === 'Bus'
                ? <Bus size={14} className={d.action.includes('Overstay') ? 'text-red-600' : 'text-indigo-600'} />
                : <Car size={14} className={d.action.includes('Overstay') ? 'text-red-600' : 'text-indigo-600'} />
              }
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-slate-700 text-xs font-semibold leading-snug">
                {d.vehicle} — Slot {d.slot}
              </p>
              <p className={`text-[11px] font-medium ${d.action.includes('Overstay') ? 'text-red-500' : 'text-slate-400'
                }`}>
                {d.action}
              </p>
            </div>
            <span className="text-[10px] text-slate-400 font-mono flex-shrink-0">{d.time}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Active Violations ────────────────────────────────────────────────────────

function ViolationsPanel({ bays }: { bays: Bay[] }) {
  const violations = bays.filter((b) => b.status === 'Overstaying')

  return (
    <div className="bg-white rounded-xl border border-red-200 shadow-sm flex flex-col">
      <div className="px-5 py-4 border-b border-red-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldAlert size={15} className="text-red-600" />
          <h2 className="text-slate-800 font-semibold text-sm">Active Violations</h2>
        </div>
        <span className="text-[10px] text-red-600 font-bold bg-red-50 px-2 py-0.5 rounded-full border border-red-200">
          {violations.length} Alert{violations.length !== 1 ? 's' : ''}
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
            <div key={bay.id} className="px-5 py-3 flex items-center gap-3 bg-red-50/60 hover:bg-red-50 transition-colors">
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
  )
}

// ─── Stats Bar ───────────────────────────────────────────────────────────────

function StatsBar({ bays }: { bays: Bay[] }) {
  const available = bays.filter((b) => b.status === 'Available').length
  const occupied = bays.filter((b) => b.status === 'Occupied').length
  const overstaying = bays.filter((b) => b.status === 'Overstaying').length
  const utilization = Math.round(((occupied + overstaying) / bays.length) * 100)

  const stats = [
    { label: 'Total Bays', value: bays.length, color: 'text-slate-700', bg: 'bg-slate-100' },
    { label: 'Available', value: available, color: 'text-emerald-700', bg: 'bg-emerald-100' },
    { label: 'Occupied', value: occupied, color: 'text-amber-700', bg: 'bg-amber-100' },
    { label: 'Overstaying', value: overstaying, color: 'text-red-700', bg: 'bg-red-100' },
    { label: 'Utilization', value: `${utilization}%`, color: 'text-indigo-700', bg: 'bg-indigo-100' },
  ]

  return (
    <div className="grid grid-cols-5 gap-3">
      {stats.map(({ label, value, color, bg }) => (
        <div key={label} className={`${bg} rounded-xl px-4 py-3 flex flex-col`}>
          <span className={`text-xl font-extrabold ${color}`}>{value}</span>
          <span className="text-slate-500 text-[11px] font-medium mt-0.5">{label}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Analytics Component ──────────────────────────────────────────────────────
// Visualizes terminal performance metrics using Recharts.

const MOCK_PEAK_DATA = [
  { time: '6:00 AM', volume: 12 },
  { time: '8:00 AM', volume: 45 },
  { time: '10:00 AM', volume: 32 },
  { time: '12:00 PM', volume: 60 },
  { time: '2:00 PM', volume: 38 },
  { time: '4:00 PM', volume: 55 },
  { time: '6:00 PM', volume: 75 },
  { time: '8:00 PM', volume: 20 },
]

const MOCK_DURATION_DATA = [
  { time: '6:00 AM', avgBus: 12, avgUV: 6 },
  { time: '8:00 AM', avgBus: 18, avgUV: 10 },
  { time: '10:00 AM', avgBus: 14, avgUV: 7 },
  { time: '12:00 PM', avgBus: 22, avgUV: 12 },
  { time: '2:00 PM', avgBus: 15, avgUV: 8 },
  { time: '4:00 PM', avgBus: 20, avgUV: 11 },
  { time: '6:00 PM', avgBus: 25, avgUV: 14 },
  { time: '8:00 PM', avgBus: 13, avgUV: 6 },
]

const MOCK_VIOLATION_LOGS = [
  { id: 'V-1042', date: 'May 8, 2026', time: '10:47 PM', slot: 3, vehicle: 'UV Express', overstay: '4m 12s' },
  { id: 'V-1041', date: 'May 8, 2026', time: '10:30 PM', slot: 7, vehicle: 'Bus', overstay: '12m 45s' },
  { id: 'V-1040', date: 'May 8, 2026', time: '08:15 PM', slot: 2, vehicle: 'UV Express', overstay: '2m 30s' },
  { id: 'V-1039', date: 'May 8, 2026', time: '06:45 PM', slot: 9, vehicle: 'Bus', overstay: '18m 20s' },
  { id: 'V-1038', date: 'May 8, 2026', time: '05:10 PM', slot: 1, vehicle: 'Bus', overstay: '5m 10s' },
]

const MOCK_DATA_SETS = {
  'Today': {
    avgOverall: '11m', avgBus: '14m', avgUV: '8m',
    utilization: 82, utilChange: '+4% vs yesterday',
    violations: 14, violBus: 9, violUV: 5, violChange: '-2 vs yesterday',
    peak: MOCK_PEAK_DATA,
    duration: MOCK_DURATION_DATA
  },
  'Last 7 Days': {
    avgOverall: '13m', avgBus: '16m', avgUV: '10m',
    utilization: 75, utilChange: '+2% vs last week',
    violations: 89, violBus: 52, violUV: 37, violChange: '-5 vs last week',
    peak: [
      { time: '6:00 AM', volume: 80 }, { time: '8:00 AM', volume: 210 },
      { time: '10:00 AM', volume: 150 }, { time: '12:00 PM', volume: 300 },
      { time: '2:00 PM', volume: 190 }, { time: '4:00 PM', volume: 260 },
      { time: '6:00 PM', volume: 350 }, { time: '8:00 PM', volume: 110 }
    ],
    duration: [
      { time: '6:00 AM', avgBus: 14, avgUV: 8 }, { time: '8:00 AM', avgBus: 20, avgUV: 12 },
      { time: '10:00 AM', avgBus: 16, avgUV: 9 }, { time: '12:00 PM', avgBus: 25, avgUV: 14 },
      { time: '2:00 PM', avgBus: 18, avgUV: 10 }, { time: '4:00 PM', avgBus: 22, avgUV: 13 },
      { time: '6:00 PM', avgBus: 28, avgUV: 16 }, { time: '8:00 PM', avgBus: 15, avgUV: 8 }
    ]
  },
  'This Month': {
    avgOverall: '12m', avgBus: '15m', avgUV: '9m',
    utilization: 78, utilChange: '+1% vs last month',
    violations: 342, violBus: 210, violUV: 132, violChange: '+12 vs last month',
    peak: [
      { time: '6:00 AM', volume: 320 }, { time: '8:00 AM', volume: 850 },
      { time: '10:00 AM', volume: 620 }, { time: '12:00 PM', volume: 1200 },
      { time: '2:00 PM', volume: 750 }, { time: '4:00 PM', volume: 1050 },
      { time: '6:00 PM', volume: 1400 }, { time: '8:00 PM', volume: 420 }
    ],
    duration: [
      { time: '6:00 AM', avgBus: 13, avgUV: 7 }, { time: '8:00 AM', avgBus: 19, avgUV: 11 },
      { time: '10:00 AM', avgBus: 15, avgUV: 8 }, { time: '12:00 PM', avgBus: 23, avgUV: 13 },
      { time: '2:00 PM', avgBus: 17, avgUV: 9 }, { time: '4:00 PM', avgBus: 21, avgUV: 12 },
      { time: '6:00 PM', avgBus: 26, avgUV: 15 }, { time: '8:00 PM', avgBus: 14, avgUV: 7 }
    ]
  }
}

function AnalyticsView() {
  const [dateRange, setDateRange] = useState<'Today' | 'Last 7 Days' | 'This Month'>('Today')
  const [showExportMenu, setShowExportMenu] = useState(false)
  const currentData = MOCK_DATA_SETS[dateRange]

  const handleExportCSV = () => {
    const headers = ['Violation ID', 'Date', 'Time', 'Slot ID', 'Vehicle Type', 'Overstay Duration']
    const csvContent = [
      headers.join(','),
      ...MOCK_VIOLATION_LOGS.map(log => `"${log.id}","${log.date}","${log.time}","${log.slot}","${log.vehicle}","${log.overstay}"`)
    ].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const dateStr = new Date().toISOString().split('T')[0]
    link.href = url
    link.setAttribute('download', `Analytics_ViolationLogs_${dateStr}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-slate-800 font-bold text-lg">Analytics Dashboard</h2>
          <p className="text-slate-500 text-sm">Terminal performance and historical data</p>
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
            <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-3 gap-5">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-2 print-break-avoid">
          <div className="flex items-center gap-2 text-indigo-600 mb-1">
            <Clock size={18} />
            <span className="text-sm font-semibold text-slate-600">Avg Turnaround Time</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-slate-800">{currentData.avgOverall}</span>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Overall</span>
          </div>
          <div className="flex items-center gap-3 mt-auto pt-2 border-t border-slate-100">
            <span className="text-xs text-slate-500"><strong className="text-slate-700">Bus:</strong> {currentData.avgBus}</span>
            <span className="text-xs text-slate-500"><strong className="text-slate-700">UV:</strong> {currentData.avgUV}</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-2 print-break-avoid">
          <div className="flex items-center gap-2 text-emerald-600 mb-1">
            <Activity size={18} />
            <span className="text-sm font-semibold text-slate-600">Daily Slot Utilization</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-slate-800">{currentData.utilization}%</span>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${currentData.utilization >= 80 ? 'text-emerald-500 bg-emerald-50' : 'text-amber-500 bg-amber-50'}`}>
              {currentData.utilChange}
            </span>
          </div>
          <div className="mt-auto pt-2 border-t border-slate-100">
            <div className="w-full bg-slate-100 rounded-full h-1.5 mt-1">
              <div className={`h-1.5 rounded-full ${currentData.utilization >= 80 ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${currentData.utilization}%` }}></div>
            </div>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-2 print-break-avoid">
          <div className="flex items-center gap-2 text-red-600 mb-1">
            <ShieldAlert size={18} />
            <span className="text-sm font-semibold text-slate-600">Total Violations {dateRange}</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-slate-800">{currentData.violations}</span>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${currentData.violChange.includes('-') ? 'text-red-500 bg-red-50' : 'text-amber-500 bg-amber-50'}`}>
              {currentData.violChange}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-auto pt-2 border-t border-slate-100">
            <span className="text-xs text-slate-500"><strong className="text-slate-700">Bus:</strong> {currentData.violBus}</span>
            <span className="text-xs text-slate-500"><strong className="text-slate-700">UV:</strong> {currentData.violUV}</span>
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-2 gap-5">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm print-break-avoid">
          <h3 className="text-sm font-bold text-slate-800 mb-4">Peak Congestion Hours</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={currentData.peak} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }} />
                <RechartsTooltip cursor={{ fill: '#f1f5f9' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                <Bar dataKey="volume" fill="#6366f1" radius={[4, 4, 0, 0]} barSize={30} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm print-break-avoid">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-slate-800">Avg Loading Duration vs Limit</h3>
            <span className="text-[10px] font-semibold text-red-500 bg-red-50 px-2 py-0.5 rounded border border-red-200">15m Limit</span>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={currentData.duration} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }} />
                <RechartsTooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                <Line type="monotone" name="Bus Avg (m)" dataKey="avgBus" stroke="#f59e0b" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                <Line type="monotone" name="UV Avg (m)" dataKey="avgUV" stroke="#10b981" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                {/* 15m threshold line */}
                <Line type="monotone" name="Threshold" dataKey={() => 15} stroke="#ef4444" strokeWidth={1} strokeDasharray="5 5" dot={false} activeDot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col print-break-avoid">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
          <h3 className="text-sm font-bold text-slate-800">Recent Violation Export Logs</h3>
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
                  onClick={() => { handleExportCSV(); setShowExportMenu(false); }}
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
                <tr key={log.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-5 py-3 font-mono font-medium text-slate-700">{log.id}</td>
                  <td className="px-5 py-3 text-slate-600">{log.date}</td>
                  <td className="px-5 py-3 text-slate-600">{log.time}</td>
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-slate-100 text-slate-700 font-bold text-xs">
                      {log.slot}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-1.5">
                      {log.vehicle === 'Bus' ? <Bus size={14} className="text-amber-500" /> : <Car size={14} className="text-emerald-500" />}
                      <span className="font-medium text-slate-700">{log.vehicle}</span>
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
  )
}

interface CameraFeed {
  id: number
  name: string
  assignedBays: string
  rtspUrl: string
  status: 'LIVE' | 'OFFLINE'
}

const INITIAL_CAMERAS: CameraFeed[] = [
  { id: 1, name: 'CAM 1', assignedBays: 'Northbound Bays 1-3', rtspUrl: 'rtsp://192.168.1.10:554/stream1', status: 'LIVE' },
  { id: 2, name: 'CAM 2', assignedBays: 'Northbound Bays 4-5', rtspUrl: 'rtsp://192.168.1.11:554/stream2', status: 'LIVE' },
  { id: 3, name: 'CAM 3', assignedBays: 'Southbound Bays 6-8', rtspUrl: 'rtsp://192.168.1.12:554/stream3', status: 'LIVE' },
  { id: 4, name: 'CAM 4', assignedBays: 'Southbound Bays 9-10', rtspUrl: 'rtsp://192.168.1.13:554/stream4', status: 'LIVE' },
  { id: 5, name: 'CAM 5', assignedBays: 'Main Entrance Gate', rtspUrl: 'rtsp://192.168.1.14:554/stream5', status: 'LIVE' },
  { id: 6, name: 'CAM 6', assignedBays: 'Exit Gate / Pay Station', rtspUrl: 'rtsp://192.168.1.15:554/stream6', status: 'OFFLINE' },
]

function CameraZonesView() {
  const [cameras, setCameras] = useState<CameraFeed[]>(INITIAL_CAMERAS)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingCamera, setEditingCamera] = useState<CameraFeed | null>(null)

  const [formData, setFormData] = useState({ name: '', assignedBays: '', rtspUrl: '' })

  const handleOpenModal = (cam?: CameraFeed) => {
    if (cam) {
      setEditingCamera(cam)
      setFormData({ name: cam.name, assignedBays: cam.assignedBays, rtspUrl: cam.rtspUrl })
    } else {
      setEditingCamera(null)
      setFormData({ name: '', assignedBays: '', rtspUrl: '' })
    }
    setIsModalOpen(true)
  }

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault()
    if (editingCamera) {
      setCameras(cameras.map(c => c.id === editingCamera.id ? { ...c, ...formData } : c))
    } else {
      setCameras([...cameras, { id: Date.now(), status: 'LIVE', ...formData }])
    }
    setIsModalOpen(false)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-slate-800 font-bold text-lg">Camera Zones</h2>
          <p className="text-slate-500 text-sm">Live RTSP feeds and local IP camera management</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-lg border border-emerald-200">
            <Signal size={16} className="animate-pulse" />
            <span className="text-sm font-bold">Local Network Status: Connected</span>
          </div>
          <button
            onClick={() => handleOpenModal()}
            className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-1.5 rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors shadow-sm"
          >
            <Plus size={16} />
            Add New IP Camera
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-5">
        {cameras.map((cam) => (
          <div key={cam.id} className="bg-slate-800 rounded-xl overflow-hidden shadow-md flex flex-col border border-slate-700">
            {/* Video Placeholder Area */}
            <div className="relative aspect-video bg-slate-900 border-b border-slate-800 flex items-center justify-center">
              {cam.status === 'LIVE' ? (
                <>
                  {/* Grid lines to make it look technical */}
                  <div className="absolute inset-0 border border-slate-800/50 m-4 rounded" />
                  <Video size={48} className="text-slate-700" />

                  {/* Overlays */}
                  <div className="absolute top-4 left-4 right-4 flex justify-between items-start">
                    <div className="bg-black/60 backdrop-blur-sm px-3 py-1.5 rounded text-white text-xs font-bold font-mono tracking-wide">
                      {cam.name} {cam.assignedBays ? `- ${cam.assignedBays}` : ''}
                    </div>
                    <div className="flex items-center gap-2 bg-black/60 backdrop-blur-sm px-2.5 py-1 rounded border border-white/10 shadow-lg">
                      <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                      <span className="text-white text-[10px] font-bold tracking-widest uppercase">Live</span>
                    </div>
                  </div>

                  {/* Fake timestamp overlay */}
                  <div className="absolute bottom-4 left-4 text-white/60 font-mono text-[10px]">
                    REC • 00:00:00
                  </div>
                  <div className="absolute bottom-4 right-4 text-emerald-400 font-mono text-[10px]">
                    1080p 30fps
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center gap-2 text-slate-600">
                  <AlertTriangle size={32} />
                  <span className="text-xs font-bold uppercase tracking-widest">Feed Offline</span>
                </div>
              )}
            </div>

            {/* Bottom Info Bar */}
            <div className="px-4 py-3 bg-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2 text-slate-400">
                <MapPin size={14} />
                <span className="text-xs font-mono truncate max-w-[200px]">{cam.rtspUrl}</span>
              </div>
              <button
                onClick={() => handleOpenModal(cam)}
                className="text-indigo-400 hover:text-indigo-300 text-xs font-semibold px-2 py-1 rounded hover:bg-indigo-400/10 transition-colors"
              >
                Configure
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Modal Overlay */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-800">
                {editingCamera ? 'Configure Camera' : 'Add New IP Camera'}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 transition-colors p-1 rounded hover:bg-slate-100">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Camera Display Name</label>
                <input
                  required
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g. CAM 7"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-shadow"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Assigned Bays</label>
                <input
                  type="text"
                  value={formData.assignedBays}
                  onChange={(e) => setFormData({ ...formData, assignedBays: e.target.value })}
                  placeholder="e.g. Northbound Bays 1-3"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-shadow"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">RTSP Stream URL</label>
                <input
                  required
                  type="text"
                  value={formData.rtspUrl}
                  onChange={(e) => setFormData({ ...formData, rtspUrl: e.target.value })}
                  placeholder="rtsp://192.168.1.10:554/stream"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-shadow"
                />
              </div>

              <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-100 mt-6">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-sm"
                >
                  Save Configuration
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Violation Logs Component ──────────────────────────────────────────────────

const BASE_MOCK_VIOLATIONS = [
  { id: 'VL-2084', timestamp: 'May 9, 2026, 08:34 AM', slot: 'Slot 3 - Northbound', vehicle: 'UV Express', limit: '15 mins', overstay: '+07:12 mins', action: 'Audio Alert Broadcasted' },
  { id: 'VL-2083', timestamp: 'May 9, 2026, 08:12 AM', slot: 'Slot 7 - Southbound', vehicle: 'Bus', limit: '15 mins', overstay: '+12:45 mins', action: 'Fine Issued / Logged' },
  { id: 'VL-2082', timestamp: 'May 9, 2026, 07:55 AM', slot: 'Slot 2 - Northbound', vehicle: 'UV Express', limit: '10 mins', overstay: '+02:30 mins', action: 'Audio Alert Broadcasted' },
  { id: 'VL-2081', timestamp: 'May 8, 2026, 06:45 PM', slot: 'Slot 9 - Southbound', vehicle: 'Bus', limit: '15 mins', overstay: '+18:20 mins', action: 'Fine Issued / Logged' },
  { id: 'VL-2080', timestamp: 'May 8, 2026, 05:10 PM', slot: 'Slot 1 - Northbound', vehicle: 'Bus', limit: '15 mins', overstay: '+05:10 mins', action: 'Resolved' },
  { id: 'VL-2079', timestamp: 'May 8, 2026, 04:30 PM', slot: 'Slot 4 - Northbound', vehicle: 'UV Express', limit: '10 mins', overstay: '+04:22 mins', action: 'Resolved' },
  { id: 'VL-2078', timestamp: 'May 8, 2026, 02:15 PM', slot: 'Slot 8 - Southbound', vehicle: 'UV Express', limit: '15 mins', overstay: '+09:15 mins', action: 'Fine Issued / Logged' },
  { id: 'VL-2077', timestamp: 'May 8, 2026, 11:20 AM', slot: 'Slot 6 - Southbound', vehicle: 'Bus', limit: '15 mins', overstay: '+06:40 mins', action: 'Resolved' },
  { id: 'VL-2076', timestamp: 'May 8, 2026, 09:45 AM', slot: 'Slot 5 - Northbound', vehicle: 'UV Express', limit: '10 mins', overstay: '+08:05 mins', action: 'Audio Alert Broadcasted' },
  { id: 'VL-2075', timestamp: 'May 8, 2026, 08:10 AM', slot: 'Slot 10 - Southbound', vehicle: 'Bus', limit: '15 mins', overstay: '+14:30 mins', action: 'Fine Issued / Logged' },
]

const MOCK_VIOLATIONS_HISTORY = [
  ...BASE_MOCK_VIOLATIONS,
  ...BASE_MOCK_VIOLATIONS.map(v => ({ ...v, id: v.id + '-A', timestamp: v.timestamp.replace('May 9', 'May 7').replace('May 8', 'May 7') })),
  ...BASE_MOCK_VIOLATIONS.map(v => ({ ...v, id: v.id + '-B', timestamp: v.timestamp.replace('May 9', 'May 6').replace('May 8', 'May 6') }))
]

function ViolationLogsView() {
  const [searchQuery, setSearchQuery] = useState('')
  const [zoneFilter, setZoneFilter] = useState('All Terminal Zones')
  const [vehicleFilter, setVehicleFilter] = useState('All Vehicle Classes')
  const [statusFilter, setStatusFilter] = useState('All Statuses')
  const [currentPage, setCurrentPage] = useState(1)

  const itemsPerPage = 10

  const filteredLogs = MOCK_VIOLATIONS_HISTORY.filter(log => {
    const matchesSearch = log.slot.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.action.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesZone = zoneFilter === 'All Terminal Zones' || log.slot.includes(zoneFilter)
    const matchesVehicle = vehicleFilter === 'All Vehicle Classes' || log.vehicle === vehicleFilter
    const matchesStatus = statusFilter === 'All Statuses' || log.action.includes(statusFilter)

    return matchesSearch && matchesZone && matchesVehicle && matchesStatus
  })

  // Reset page to 1 when filters change
  useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery, zoneFilter, vehicleFilter, statusFilter])

  const totalPages = Math.ceil(filteredLogs.length / itemsPerPage)
  const currentLogs = filteredLogs.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)

  const handleExportCSV = () => {
    if (filteredLogs.length === 0) return

    const headers = ['Violation ID', 'Timestamp', 'Slot ID', 'Vehicle Type', 'Time Limit', 'Overstay Duration', 'Action Taken']
    const csvContent = [
      headers.join(','),
      ...filteredLogs.map(log => `"${log.id}","${log.timestamp}","${log.slot}","${log.vehicle}","${log.limit}","${log.overstay}","${log.action}"`)
    ].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const dateStr = new Date().toISOString().split('T')[0]
    link.href = url
    link.setAttribute('download', `SlotSight_ViolationLogs_${dateStr}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-[calc(100vh-120px)]">
      {/* Header & Controls */}
      <div className="p-5 border-b border-slate-200 space-y-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-slate-800 font-bold text-lg">Violation Logs</h2>
            <p className="text-slate-500 text-sm">Historical record of all overstaying vehicles and automated actions</p>
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
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
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
              <tr key={log.id} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'} hover:bg-indigo-50/30 transition-colors`}>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2 text-slate-600">
                    <Calendar size={14} className="text-slate-400" />
                    <span className="font-medium whitespace-nowrap">{log.timestamp}</span>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className="font-semibold text-slate-700">{log.slot}</span>
                </td>
                <td className="px-6 py-4">
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${log.vehicle === 'Bus'
                    ? 'bg-blue-50 text-blue-700 border-blue-200'
                    : 'bg-purple-50 text-purple-700 border-purple-200'
                    }`}>
                    {log.vehicle === 'Bus' ? <Bus size={12} /> : <Car size={12} />}
                    {log.vehicle}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <span className="text-slate-500 font-medium">{log.limit}</span>
                </td>
                <td className="px-6 py-4">
                  <span className="inline-flex items-center gap-1 bg-red-50 text-red-700 font-bold text-xs px-2.5 py-1 rounded-full border border-red-200">
                    <Timer size={12} />
                    {log.overstay}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <span className={`text-xs font-bold flex items-center gap-1.5 ${log.action.includes('Resolved') ? 'text-emerald-600' :
                    log.action.includes('Fine') ? 'text-amber-600' : 'text-indigo-600'
                    }`}>
                    {log.action.includes('Resolved') && <CheckCircle2 size={14} />}
                    {log.action.includes('Fine') && <FileText size={14} />}
                    {log.action.includes('Audio') && <Activity size={14} />}
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
          Showing <strong className="text-slate-700">{filteredLogs.length === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1}-{Math.min(currentPage * itemsPerPage, filteredLogs.length)}</strong> of <strong className="text-slate-700">{filteredLogs.length}</strong> entries
        </span>
        <div className="flex items-center gap-2">
          <button
            disabled={currentPage === 1}
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            className="flex items-center gap-1 px-3 py-1.5 border border-slate-200 bg-white rounded text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-50"
          >
            <ChevronLeft size={16} />
            Previous
          </button>
          <button
            disabled={currentPage === totalPages || totalPages === 0}
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            className="flex items-center gap-1 px-3 py-1.5 border border-slate-200 bg-white rounded text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-50"
          >
            Next
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Settings Component ───────────────────────────────────────────────────────
// Manages system configurations including timers, audio PA, and cloud sync.

const defaultSettings = {
  busGracePeriod: 15,
  uvGracePeriod: 10,
  autoReset: true,
  warningTime: 2,
  language: 'bisaya',
  paVolume: 80,
  cloudSync: true,
  syncInterval: 5
}

function SettingsView() {
  const [settings, setSettings] = useState(() => {
    const saved = localStorage.getItem('slotsight-settings')
    return saved ? JSON.parse(saved) : defaultSettings
  })

  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle')

  const handleChange = (key: string, value: any) => {
    setSettings((prev: any) => ({ ...prev, [key]: value }))
  }

  const handleReset = () => {
    setSettings(defaultSettings)
  }

  const handleSave = () => {
    localStorage.setItem('slotsight-settings', JSON.stringify(settings))
    setSaveStatus('saved')
    setTimeout(() => setSaveStatus('idle'), 2000)
  }

  return (
    <div className="flex flex-col h-full min-h-[calc(100vh-120px)]">
      <div className="flex items-center justify-between mb-6 flex-shrink-0">
        <div>
          <h2 className="text-slate-800 font-bold text-lg">System Settings</h2>
          <p className="text-slate-500 text-sm">Configure terminal operations, thresholds, and integrations</p>
        </div>
      </div>

      <div className="flex-1 space-y-6 pb-6">
        {/* Card 1: Queue & Timer Configurations */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <div className="flex items-center gap-2 text-indigo-600 mb-4">
            <Sliders size={20} />
            <h3 className="text-base font-bold text-slate-800">Queue & Timer Configurations</h3>
          </div>
          <div className="space-y-5 max-w-2xl">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Bus Grace Period (Minutes)</label>
                <input
                  type="number"
                  value={settings.busGracePeriod}
                  onChange={(e) => handleChange('busGracePeriod', parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="text-xs text-slate-500 mt-1">Allowed docking time before overstay alert.</p>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">UV Express Grace Period (Minutes)</label>
                <input
                  type="number"
                  value={settings.uvGracePeriod}
                  onChange={(e) => handleChange('uvGracePeriod', parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="text-xs text-slate-500 mt-1">Allowed docking time before overstay alert.</p>
              </div>
            </div>
            <div className="flex items-center justify-between pt-2">
              <div>
                <h4 className="text-sm font-semibold text-slate-700">Enable Auto-Reset on Vehicle Exit</h4>
                <p className="text-xs text-slate-500">Automatically clear slot timer when camera detects vehicle departure.</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.autoReset}
                  onChange={(e) => handleChange('autoReset', e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
              </label>
            </div>
          </div>
        </div>

        {/* Card 2: Audio PA System Settings */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <div className="flex items-center gap-2 text-indigo-600 mb-4">
            <Volume2 size={20} />
            <h3 className="text-base font-bold text-slate-800">Audio PA System Settings</h3>
          </div>
          <div className="space-y-5 max-w-2xl">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Warning Trigger Time (Minutes)</label>
                <input
                  type="number"
                  value={settings.warningTime}
                  onChange={(e) => handleChange('warningTime', parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="text-xs text-slate-500 mt-1">Trigger voice alert when X minutes remain.</p>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Voice Alert Language</label>
                <div className="relative">
                  <Globe size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <select
                    value={settings.language}
                    onChange={(e) => handleChange('language', e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 appearance-none"
                  >
                    <option value="bisaya">Bisaya / Cebuano</option>
                    <option value="tagalog">Tagalog</option>
                    <option value="english">English</option>
                  </select>
                </div>
                <p className="text-xs text-slate-500 mt-1">Language for automated PA announcements.</p>
              </div>
            </div>

            <div className="pt-2">
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-semibold text-slate-700">PA Speaker Volume</label>
                <span className="text-xs font-bold text-indigo-600">{settings.paVolume}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={settings.paVolume}
                onChange={(e) => handleChange('paVolume', parseInt(e.target.value) || 0)}
                className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
              />
            </div>

            <div className="pt-4 border-t border-slate-100">
              <button className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm font-semibold transition-colors border border-slate-200 shadow-sm">
                <Play size={16} className="text-indigo-600" />
                Test PA System
              </button>
            </div>
          </div>
        </div>

        {/* Card 3: Cloud Synchronization Settings */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <div className="flex items-center gap-2 text-indigo-600 mb-4">
            <Cloud size={20} />
            <h3 className="text-base font-bold text-slate-800">Cloud Synchronization Settings</h3>
          </div>
          <div className="space-y-5 max-w-2xl">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold text-slate-700">Enable Remote Cloud Sync</h4>
                <p className="text-xs text-slate-500">Sync local detection data to central cloud dashboard.</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.cloudSync}
                  onChange={(e) => handleChange('cloudSync', e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
              </label>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Sync Interval (Minutes)</label>
              <div className="relative max-w-[200px]">
                <RefreshCw size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="number"
                  value={settings.syncInterval}
                  onChange={(e) => handleChange('syncInterval', parseInt(e.target.value) || 0)}
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
              <span className="text-xs font-semibold text-slate-600">Database connection: <span className="text-emerald-600">Connected (Supabase / Cloud)</span></span>
            </div>
          </div>
        </div>
      </div>

      {/* Sticky Footer */}
      <div className="sticky bottom-0 -mx-5 -mb-5 px-5 py-4 bg-white/90 backdrop-blur-sm border-t border-slate-200 flex justify-end gap-3 rounded-b-2xl shadow-[0_-4px_6px_-1px_rgb(0,0,0,0.05)]">
        <button
          onClick={handleReset}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100 transition-colors border border-slate-200"
        >
          <RotateCcw size={16} />
          Reset to Defaults
        </button>
        <button
          onClick={handleSave}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white transition-all shadow-sm ${saveStatus === 'saved' ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200' : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200'}`}
        >
          {saveStatus === 'saved' ? <CheckCircle2 size={16} /> : <Save size={16} />}
          {saveStatus === 'saved' ? 'Saved!' : 'Save Configurations'}
        </button>
      </div>
    </div>
  )
}

// ─── Admin Login Component ────────────────────────────────────────────────────
// Secure entry point for the dashboard with demo bypass capabilities.

function AdminLogin({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="flex h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 items-center justify-center relative overflow-hidden">
      {/* Subtle background geometric pattern */}
      <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'radial-gradient(#4f46e5 1px, transparent 1px)', backgroundSize: '32px 32px' }}></div>
      <div className="absolute w-[800px] h-[800px] bg-indigo-500/10 blur-[100px] rounded-full top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"></div>

      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md relative z-10 mx-4 border border-slate-100">
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-14 h-14 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/30 mb-4">
            <ShieldCheck size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-extrabold text-slate-800 tracking-tight mb-1">SlotSight</h1>
          <p className="text-indigo-600 text-xs font-bold uppercase tracking-widest mb-3">Admin Console</p>
          <p className="text-slate-500 text-sm leading-relaxed max-w-xs">Panabo City Terminal Queue Management System</p>
        </div>

        <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); onLogin(); }}>
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">Administrator ID</label>
            <div className="relative">
              <User size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Enter your username"
                className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-shadow"
                autoComplete="username"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">Password</label>
            <div className="relative">
              <Lock size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="password"
                placeholder="••••••••••••"
                className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-shadow"
                autoComplete="current-password"
              />
            </div>
          </div>

          <button
            type="submit"
            className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl transition-all duration-200 shadow-md shadow-indigo-200"
          >
            Log In
          </button>
        </form>

        <div className="mt-6 pt-6 border-t border-slate-100 flex flex-col items-center">
          <p className="text-xs text-slate-400 mb-3 text-center">Presentation Mode</p>
          <button
            type="button"
            onClick={onLogin}
            className="w-full py-2.5 px-4 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            <Bus size={16} className="text-slate-400" />
            Sign in as Demo Admin
          </button>
        </div>
      </div>

      {/* Footer Branding */}
      <div className="absolute bottom-6 text-center w-full text-slate-500 text-xs font-medium tracking-wide z-10">
        &copy; 2026 Local Government Unit of Panabo City
      </div>
    </div>
  )
}

// ─── Public Signage Component ──────────────────────────────────────────────────
// Dedicated full-screen view for the external terminal display monitors.

function PublicSignageView({ bays, now }: { bays: Bay[], now: Date }) {
  const overstayingMsgs = bays
    .filter(b => b.status === 'Overstaying')
    .map(b => `⚠️ ATTENTION: BAY ${b.id} ${b.vehicleType?.toUpperCase() || 'VEHICLE'} PLEASE DEPART IMMEDIATELY.`)
    
  const availableMsgs = bays
    .filter(b => b.status === 'Available')
    .map(b => `🟢 BAY ${b.id} IS OPEN FOR ${b.type.toUpperCase()} ENTRY.`)

  const allMsgs = [...overstayingMsgs, ...availableMsgs]
  const tickerText = allMsgs.length > 0 
    ? allMsgs.join("  •  ")
    : "⏱️ ALL BAYS CURRENTLY OCCUPIED. PLEASE WAIT FOR AN OPENING."

  return (
    <div className="flex flex-col h-screen bg-slate-950 overflow-hidden font-sans">
      {/* Header */}
      <div className="flex items-center justify-between px-10 py-6 bg-slate-900 border-b-4 border-indigo-600 shadow-2xl flex-shrink-0 z-10">
        <div className="flex items-center gap-6">
          <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-500/50">
            <Bus size={32} className="text-white" />
          </div>
          <div>
            <h1 className="text-white font-black text-4xl tracking-tight">PANABO CITY BUS TERMINAL</h1>
            <p className="text-indigo-400 font-bold text-xl tracking-widest uppercase mt-1">Live Bay Status</p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-white font-mono font-black text-5xl tracking-tight">{formatClock(now)}</div>
          <div className="text-slate-400 font-bold text-xl mt-1">{formatDate(now)}</div>
        </div>
      </div>

      {/* Main Grid */}
      <div className="flex-1 flex flex-col justify-center px-10 py-8 relative overflow-hidden bg-slate-950">
        {/* Decorative Grid Lines */}
        <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'linear-gradient(to right, #334155 1px, transparent 1px), linear-gradient(to bottom, #334155 1px, transparent 1px)', backgroundSize: '64px 64px' }}></div>

        {/* Northbound Row */}
        <div className="relative z-10 mb-8">
          <h2 className="text-slate-300 font-black text-3xl mb-8 flex items-center gap-4">
            <span className="w-4 h-4 rounded-full bg-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.8)]"></span>
            NORTHBOUND TERMINAL
          </h2>
          <div className="flex justify-between gap-6 px-4">
            {bays.filter(b => b.type === 'Northbound').map((bay) => (
              <PublicBayCard key={bay.id} bay={bay} />
            ))}
          </div>
        </div>

        {/* Road Divider */}
        <div className="relative z-10 flex items-center gap-6 my-4 opacity-40">
          <div className="flex-1 border-t-4 border-dashed border-slate-600"></div>
          <span className="text-slate-500 font-black text-xl tracking-[0.5em] uppercase">Road Lane</span>
          <div className="flex-1 border-t-4 border-dashed border-slate-600"></div>
        </div>

        {/* Southbound Row */}
        <div className="relative z-10 mt-8">
          <h2 className="text-slate-300 font-black text-3xl mb-8 flex items-center gap-4">
            <span className="w-4 h-4 rounded-full bg-teal-500 shadow-[0_0_15px_rgba(20,184,166,0.8)]"></span>
            SOUTHBOUND TERMINAL
          </h2>
          <div className="flex justify-between gap-6 px-4">
            {bays.filter(b => b.type === 'Southbound').map((bay) => (
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
  )
}

function PublicBayCard({ bay }: { bay: Bay }) {
  const isAvailable = bay.status === 'Available'
  const isOccupied = bay.status === 'Occupied'
  const isOverstaying = bay.status === 'Overstaying'

  // Determine colors based on state
  let cardClass = ""
  let textClass = ""
  let statusText = ""

  if (isAvailable) {
    cardClass = "bg-emerald-500/10 border-emerald-500 shadow-[inset_0_0_40px_rgba(16,185,129,0.1),0_0_20px_rgba(16,185,129,0.2)]"
    textClass = "text-emerald-400"
    statusText = "OPEN SLOT"
  } else if (isOccupied) {
    cardClass = "bg-amber-400/10 border-amber-400 shadow-[inset_0_0_40px_rgba(251,191,36,0.1),0_0_20px_rgba(251,191,36,0.2)]"
    textClass = "text-amber-400"
    statusText = "OCCUPIED"
  } else if (isOverstaying) {
    cardClass = "bg-red-500/20 border-red-500 shadow-[inset_0_0_60px_rgba(239,68,68,0.2),0_0_30px_rgba(239,68,68,0.4)]"
    textClass = "text-red-500"
    statusText = "OVERSTAYING"
  }

  return (
    <div className={`relative flex-1 h-[28vh] -skew-x-[20deg] border-4 rounded-xl flex items-center justify-center transition-all ${cardClass} backdrop-blur-sm overflow-hidden`}>
      {/* Inner wrapper to un-skew content */}
      <div className="absolute inset-0 skew-x-[20deg] flex flex-col items-center justify-center p-6 text-center">
        <h3 className="text-white font-black text-5xl tracking-tighter mb-2 drop-shadow-lg">BAY {bay.id}</h3>

        {bay.vehicleType && (
          <div className="flex items-center gap-2 mb-2 bg-slate-900/60 px-4 py-2 rounded-full border border-slate-700">
            {bay.vehicleType === 'Bus' ? <Bus size={20} className="text-indigo-400" /> : <Car size={20} className="text-indigo-400" />}
            <span className="text-white font-bold text-lg">{bay.vehicleType}</span>
          </div>
        )}

        <div className={`font-black text-2xl tracking-widest mt-auto ${textClass} drop-shadow-md`}>
          {statusText}
        </div>

        {isOverstaying && (
          <div className="absolute inset-0 bg-red-500/20 animate-pulse pointer-events-none"></div>
        )}
      </div>
    </div>
  )
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [now, setNow] = useState(new Date())
  const [bays, setBays] = useState<Bay[]>(() => {
    const saved = localStorage.getItem('slotsight-state')
    if (saved) {
      let parsed = JSON.parse(saved)
      // Hotfix: Clean up previously cached state to enforce structural rules
      parsed = parsed.map((bay: any) => {
        if (bay.status !== 'Available') {
          const isUVExpress = bay.id === 1 || bay.id === 10
          if (isUVExpress && bay.vehicleType !== 'UV Express') {
            return { ...bay, vehicleType: 'UV Express' }
          }
          if (!isUVExpress && bay.vehicleType === 'UV Express') {
            return { ...bay, vehicleType: 'Bus' }
          }
        }
        return bay
      })
      return parsed
    }
    return initialBays
  })
  const [activeTab, setActiveTab] = useState('dashboard')

  // Consolidated master clock and timer update to prevent multiple re-renders
  useEffect(() => {
    // If we are in public signage view, just listen to the broadcast channel
    if (window.location.pathname === '/signage') {
      const channel = new BroadcastChannel('slotsight-sync')
      const id = setInterval(() => setNow(new Date()), 1000)

      channel.onmessage = (event) => {
        setBays(JSON.parse(event.data))
      }

      return () => {
        clearInterval(id)
        channel.close()
      }
    }

    // Otherwise (Admin Dashboard), run the simulator and broadcast state
    const channel = new BroadcastChannel('slotsight-sync')
    let mockYoloTimer = 0

    const id = setInterval(() => {
      setNow(new Date())

      setBays((prev) => {
        let newBays = prev.map((bay) => {
          if (bay.status === 'Available') return bay
          if (bay.timeRemaining === undefined) return bay

          const next = bay.timeRemaining - 1
          // Transition occupied → overstaying when timer hits 0
          if (bay.status === 'Occupied' && next <= 0) {
            return { ...bay, status: 'Overstaying' as const, timeRemaining: 0 }
          }
          return { ...bay, timeRemaining: next }
        })

        // Mock YOLOv8 Simulator: triggers randomly roughly every 10-15 seconds
        mockYoloTimer++
        if ((mockYoloTimer >= 10 && Math.random() > 0.5) || mockYoloTimer >= 15) {
          mockYoloTimer = 0
          
          const availableBays = newBays.filter(b => b.status === 'Available')
          const occupiedBays = newBays.filter(b => b.status === 'Occupied' || b.status === 'Overstaying')
          
          let isDeparture = false;
          if (occupiedBays.length > 0 && availableBays.length === 0) {
            isDeparture = true;
          } else if (occupiedBays.length > 0 && availableBays.length > 0) {
            // 40% chance a vehicle leaves instead of arriving
            isDeparture = Math.random() > 0.6; 
          }

          if (isDeparture) {
            const randomBay = occupiedBays[Math.floor(Math.random() * occupiedBays.length)]
            newBays = newBays.map(bay =>
              bay.id === randomBay.id
                ? { ...bay, status: 'Available' as const, vehicleType: undefined, timeRemaining: undefined, audioPlayed: undefined }
                : bay
            )
          } else if (availableBays.length > 0) {
            const randomBay = availableBays[Math.floor(Math.random() * availableBays.length)]
            
            // Panabo Terminal Structure: Bays 1 and 10 are strictly for UV Express
            const isUVExpress = randomBay.id === 1 || randomBay.id === 10
            const vehicleType = isUVExpress ? 'UV Express' : 'Bus'
            const timeRemaining = isUVExpress ? 10 * 60 : 15 * 60 // 10 mins for UV, 15 mins for Bus

            newBays = newBays.map(bay =>
              bay.id === randomBay.id
                ? { ...bay, status: 'Occupied' as const, vehicleType: vehicleType, timeRemaining: timeRemaining }
                : bay
            )
          }
        }

        const stringifiedBays = JSON.stringify(newBays)
        localStorage.setItem('slotsight-state', stringifiedBays)
        channel.postMessage(stringifiedBays)
        return newBays
      })
    }, 1000)

    return () => {
      clearInterval(id)
      channel.close()
    }
  }, [])

  // Text-to-Speech (TTS) PA System Logic
  useEffect(() => {
    if (window.location.pathname === '/signage') return;

    let updated = false;
    const nextBays = bays.map(bay => {
      if (bay.status === 'Overstaying' && !bay.audioPlayed) {
        const utterance = new SpeechSynthesisUtterance(
          `Attention. Bay ${bay.id}, ${bay.vehicleType || 'Vehicle'}, you have exceeded the loading limit. Please depart immediately.`
        );
        window.speechSynthesis.speak(utterance);
        updated = true;
        return { ...bay, audioPlayed: true };
      }
      return bay;
    });

    if (updated) {
      setBays(nextBays);
      const stringifiedBays = JSON.stringify(nextBays);
      localStorage.setItem('slotsight-state', stringifiedBays);
      const channel = new BroadcastChannel('slotsight-sync');
      channel.postMessage(stringifiedBays);
      channel.close();
    }
  }, [bays]);

  if (window.location.pathname === '/signage') {
    return <PublicSignageView bays={bays} now={now} />
  }

  if (!isAuthenticated) {
    return <AdminLogin onLogin={() => setIsAuthenticated(true)} />
  }

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} onLogout={() => setIsAuthenticated(false)} />

      {/* Right panel */}
      <div className="flex flex-col flex-1 min-w-0">
        <Header clock={formatClock(now)} date={formatDate(now)} onViewViolations={() => setActiveTab('violations')} />

        {/* Scrollable content */}
        <main className="flex-1 overflow-y-auto p-5 space-y-5">
          {activeTab === 'dashboard' && (
            <>
              {/* Stats bar */}
              <StatsBar bays={bays} />

              {/* Main 2/3 + 1/3 split */}
              <div className="flex gap-5 min-h-0">
                {/* 2/3 — Bay Grid */}
                <div className="flex-[2] min-w-0 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-slate-800 font-bold text-sm">
                        2D Spatial Terminal Map
                      </h2>
                      <p className="text-slate-400 text-[11px]">
                        10 docking bays · Real-time occupancy
                      </p>
                    </div>
                    <div className="flex items-center gap-4 text-[11px] font-medium text-slate-500">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
                        Available
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" />
                        Occupied
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" />
                        Overstaying
                      </span>
                    </div>
                  </div>

                  {/* ── Spatial Map ── */}
                  <div className="bg-slate-800 rounded-2xl p-5 space-y-5">
                    {/* Northbound Terminal — Bays 1–5 */}
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <span className="w-2 h-2 rounded-full bg-indigo-400 inline-block" />
                        <h3 className="text-slate-200 font-extrabold text-xs uppercase tracking-widest">
                          Northbound Terminal
                        </h3>
                        <span className="text-slate-500 text-[10px] font-medium">Bays 1–5</span>
                      </div>
                      <div className="grid grid-cols-5 gap-3">
                        {bays.filter(b => b.type === 'Northbound').map((bay) => (
                          <BayCard key={bay.id} bay={bay} />
                        ))}
                      </div>
                    </div>

                    {/* Road Lane divider */}
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-px bg-slate-600" />
                      <span className="text-slate-500 text-[9px] font-bold uppercase tracking-widest px-2">Road Lane</span>
                      <div className="flex-1 h-px bg-slate-600" />
                    </div>

                    {/* Southbound Terminal — Bays 6–10 */}
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <span className="w-2 h-2 rounded-full bg-teal-400 inline-block" />
                        <h3 className="text-slate-200 font-extrabold text-xs uppercase tracking-widest">
                          Southbound Terminal
                        </h3>
                        <span className="text-slate-500 text-[10px] font-medium">Bays 6–10</span>
                      </div>
                      <div className="grid grid-cols-5 gap-3">
                        {bays.filter(b => b.type === 'Southbound').map((bay) => (
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
            </>
          )}

          {activeTab === 'analytics' && <AnalyticsView />}
          {activeTab === 'camera' && <CameraZonesView />}
          {activeTab === 'violations' && <ViolationLogsView />}
          {activeTab === 'settings' && <SettingsView />}
        </main>
      </div>
    </div>
  )
}
