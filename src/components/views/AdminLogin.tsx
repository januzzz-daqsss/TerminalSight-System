import { Bus, User, Lock, ShieldCheck } from "lucide-react";

// ─── Admin Login Component ────────────────────────────────────────────────────
// Secure entry point for the dashboard with demo bypass capabilities.

export function AdminLogin({ onLogin }: { onLogin: () => void }) {
    return (
        <div className="flex h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 items-center justify-center relative overflow-hidden">
            {/* Subtle background geometric pattern */}
            <div
                className="absolute inset-0 opacity-10 pointer-events-none"
                style={{
                    backgroundImage: "radial-gradient(#4f46e5 1px, transparent 1px)",
                    backgroundSize: "32px 32px",
                }}
            ></div>
            <div className="absolute w-[800px] h-[800px] bg-indigo-500/10 blur-[100px] rounded-full top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"></div>

            <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md relative z-10 mx-4 border border-slate-100">
                <div className="flex flex-col items-center text-center mb-8">
                    <div className="w-14 h-14 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/30 mb-4">
                        <ShieldCheck size={32} className="text-white" />
                    </div>
                    <h1 className="text-2xl font-extrabold text-slate-800 tracking-tight mb-1">
                        SlotSight
                    </h1>
                    <p className="text-indigo-600 text-xs font-bold uppercase tracking-widest mb-3">
                        Admin Console
                    </p>
                    <p className="text-slate-500 text-sm leading-relaxed max-w-xs">
                        Panabo City Terminal Queue Management System
                    </p>
                </div>

                <form
                    className="space-y-5"
                    onSubmit={(e) => {
                        e.preventDefault();
                        onLogin();
                    }}
                >
                    <div>
                        <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                            Administrator ID
                        </label>
                        <div className="relative">
                            <User
                                size={18}
                                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                            />
                            <input
                                type="text"
                                placeholder="Enter your username"
                                className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-shadow"
                                autoComplete="username"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                            Password
                        </label>
                        <div className="relative">
                            <Lock
                                size={18}
                                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                            />
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
                    <p className="text-xs text-slate-400 mb-3 text-center">
                        Presentation Mode
                    </p>
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
    );
}
