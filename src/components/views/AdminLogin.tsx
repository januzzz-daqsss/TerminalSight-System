import { useState } from "react";
import { User, Lock, ShieldCheck, Loader2 } from "lucide-react";

// ─── Admin Login Component ────────────────────────────────────────────────────
// Secure entry point for the dashboard connected to the SQLite backend.

export function AdminLogin({ onLogin }: { onLogin: () => void }) {
    const [view, setView] = useState<"login" | "request_otp" | "reset_password">("login");
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    
    // OTP states
    const [contact, setContact] = useState("");
    const [otp, setOtp] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [resetUsername, setResetUsername] = useState("");

    const [error, setError] = useState("");
    const [successMsg, setSuccessMsg] = useState("");
    const [isLoading, setIsLoading] = useState(false);

    // Password strength evaluator for the reset form
    const evaluateStrength = (pw: string) => {
        if (!pw) return { label: "", color: "bg-slate-200", score: 0 };
        const hasLower = /[a-z]/.test(pw);
        const hasUpper = /[A-Z]/.test(pw);
        const hasNumber = /[0-9]/.test(pw);
        const hasSymbol = /[@#$%^&*()_+\-=\[\]{}|;:',.<>/?]/.test(pw);
        const isLong = pw.length >= 12;
        const score = [hasLower, hasUpper, hasNumber, hasSymbol, isLong].filter(Boolean).length;
        if (score === 5) return { label: "Strong", color: "bg-emerald-500", text: "text-emerald-600", score };
        if (score >= 3) return { label: "Medium", color: "bg-amber-500", text: "text-amber-600", score };
        return { label: "Weak", color: "bg-red-500", text: "text-red-600", score };
    };
    const strength = evaluateStrength(newPassword);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setIsLoading(true);

        try {
            const response = await fetch("http://127.0.0.1:5000/api/login", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ username, password }),
            });

            const data = await response.json();

            if (response.ok && data.success) {
                // Save user info if needed, then trigger login
                localStorage.setItem("terminalsight-user", JSON.stringify(data.user));
                onLogin();
            } else {
                setError(data.message || "Invalid credentials");
            }
        } catch (err) {
            setError("Failed to connect to the authentication server.");
        } finally {
            setIsLoading(false);
        }
    };

    const handleRequestOTP = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setSuccessMsg("");
        setIsLoading(true);

        try {
            const response = await fetch("http://127.0.0.1:5000/api/request_otp", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ contact }),
            });
            const data = await response.json();
            if (data.success) {
                setResetUsername(data.username);
                setSuccessMsg(`OTP sent to ${contact}! (For demo: ${data.demo_otp})`);
                setView("reset_password");
            } else {
                setError(data.message || "Failed to request OTP");
            }
        } catch (err) {
            setError("Failed to connect to the authentication server.");
        } finally {
            setIsLoading(false);
        }
    };

    const handleResetPassword = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setSuccessMsg("");
        
        if (strength.score < 5) {
            setError("New password must meet ALL strict criteria.");
            return;
        }

        setIsLoading(true);
        try {
            const response = await fetch("http://127.0.0.1:5000/api/reset_password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username: resetUsername, otp, new_password: newPassword }),
            });
            const data = await response.json();
            if (data.success) {
                setSuccessMsg("Password successfully reset! You can now log in.");
                setView("login");
                setOtp("");
                setNewPassword("");
            } else {
                setError(data.message || "Failed to reset password");
            }
        } catch (err) {
            setError("Failed to connect to the authentication server.");
        } finally {
            setIsLoading(false);
        }
    };
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
                        TerminalSight
                    </h1>
                    <p className="text-indigo-600 text-xs font-bold uppercase tracking-widest mb-3">
                        Admin Console
                    </p>
                    <p className="text-slate-500 text-sm leading-relaxed max-w-xs">
                        Panabo City Terminal Queue Management System
                    </p>
                </div>

                {successMsg && (
                    <div className="mb-5 bg-emerald-50 text-emerald-600 text-xs font-bold px-4 py-3 rounded-xl border border-emerald-200 text-center">
                        {successMsg}
                    </div>
                )}
                {error && (
                    <div className="mb-5 bg-red-50 text-red-600 text-xs font-bold px-4 py-3 rounded-xl border border-red-200 text-center">
                        {error}
                    </div>
                )}

                {view === "login" && (
                    <form className="space-y-5" onSubmit={handleLogin}>
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
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                required
                            />
                        </div>
                    </div>

                    <div>
                        <div className="flex justify-between items-end mb-2">
                            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                                Password
                            </label>
                            <button 
                                type="button"
                                className="text-xs font-bold text-indigo-600 hover:text-indigo-800 transition-colors"
                                onClick={() => { setView("request_otp"); setError(""); setSuccessMsg(""); }}
                            >
                                Forgot password?
                            </button>
                        </div>
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
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                            />
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={isLoading}
                        className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white text-sm font-bold rounded-xl transition-all duration-200 shadow-md shadow-indigo-200 flex items-center justify-center"
                    >
                        {isLoading ? <Loader2 size={20} className="animate-spin" /> : "Log In"}
                    </button>
                </form>
                )}

                {view === "request_otp" && (
                    <form className="space-y-5" onSubmit={handleRequestOTP}>
                        <div>
                            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                                Phone Number or Email
                            </label>
                            <div className="relative">
                                <User size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    type="text"
                                    placeholder="e.g. +639123456789 or admin@email.com"
                                    className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    value={contact}
                                    onChange={(e) => setContact(e.target.value)}
                                    required
                                />
                            </div>
                        </div>
                        <button type="submit" disabled={isLoading} className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl transition-all shadow-md flex justify-center">
                            {isLoading ? <Loader2 size={20} className="animate-spin" /> : "Send OTP"}
                        </button>
                        <button type="button" onClick={() => { setView("login"); setError(""); }} className="w-full py-3 px-4 bg-white text-slate-600 hover:bg-slate-50 border border-slate-200 text-sm font-bold rounded-xl transition-all">
                            Back to Login
                        </button>
                    </form>
                )}

                {view === "reset_password" && (
                    <form className="space-y-5" onSubmit={handleResetPassword}>
                        <div>
                            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                                Enter 6-Digit OTP
                            </label>
                            <input
                                type="text"
                                maxLength={6}
                                placeholder="123456"
                                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-center tracking-[0.5em] font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                value={otp}
                                onChange={(e) => setOtp(e.target.value)}
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                                New Password
                            </label>
                            <input
                                type="password"
                                placeholder="Enter new strong password"
                                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-2"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                required
                            />
                            {/* Strict Password Meter */}
                            {newPassword && (
                                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 mb-2">
                                    <div className="flex justify-between items-center mb-2">
                                        <span className="text-xs font-bold text-slate-600">Strength:</span>
                                        <span className={`text-xs font-black uppercase tracking-wider ${strength.text}`}>{strength.label}</span>
                                    </div>
                                    <div className="flex gap-1 h-1.5 mb-3">
                                        <div className={`flex-1 rounded-full ${strength.score >= 1 ? strength.color : 'bg-slate-200'}`}></div>
                                        <div className={`flex-1 rounded-full ${strength.score >= 2 ? strength.color : 'bg-slate-200'}`}></div>
                                        <div className={`flex-1 rounded-full ${strength.score >= 3 ? strength.color : 'bg-slate-200'}`}></div>
                                        <div className={`flex-1 rounded-full ${strength.score >= 4 ? strength.color : 'bg-slate-200'}`}></div>
                                        <div className={`flex-1 rounded-full ${strength.score >= 5 ? strength.color : 'bg-slate-200'}`}></div>
                                    </div>
                                    <ul className="text-[10px] font-medium space-y-1">
                                        <li className={/[a-z]/.test(newPassword) ? "text-emerald-600" : "text-slate-500"}>✓ Lowercase letter</li>
                                        <li className={/[A-Z]/.test(newPassword) ? "text-emerald-600" : "text-slate-500"}>✓ Uppercase letter</li>
                                        <li className={/[0-9]/.test(newPassword) ? "text-emerald-600" : "text-slate-500"}>✓ Number (0-9)</li>
                                        <li className={/[@#$%^&*()_+\-=\[\]{}|;:',.<>/?]/.test(newPassword) ? "text-emerald-600" : "text-slate-500"}>✓ Special symbol</li>
                                        <li className={newPassword.length >= 12 ? "text-emerald-600" : "text-slate-500"}>✓ Min 12 chars</li>
                                    </ul>
                                </div>
                            )}
                        </div>
                        <button type="submit" disabled={isLoading} className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl transition-all shadow-md flex justify-center">
                            {isLoading ? <Loader2 size={20} className="animate-spin" /> : "Securely Reset Password"}
                        </button>
                        <button type="button" onClick={() => { setView("login"); setError(""); }} className="w-full py-3 px-4 bg-white text-slate-600 hover:bg-slate-50 border border-slate-200 text-sm font-bold rounded-xl transition-all">
                            Cancel
                        </button>
                    </form>
                )}

                {/* Demo Admin Button Removed */}
            </div>

            {/* Footer Branding */}
            <div className="absolute bottom-6 text-center w-full text-slate-500 text-xs font-medium tracking-wide z-10">
                &copy; 2026 Local Government Unit of Panabo City
            </div>
        </div>
    );
}
