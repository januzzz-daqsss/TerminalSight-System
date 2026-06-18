import { useState } from "react";
import { User, Lock, Loader2, MonitorSmartphone, Eye, EyeOff } from "lucide-react";

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

    // Visibility states for hold-to-view
    const [showPassword, setShowPassword] = useState(false);
    const [showNewPassword, setShowNewPassword] = useState(false);

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
        <div className="flex h-screen bg-gradient-to-br from-emerald-900 via-emerald-800 to-slate-900 items-center justify-center relative overflow-hidden">
            {/* Subtle background geometric pattern */}
            <div className="absolute inset-0 opacity-10">
                <div className="absolute w-96 h-96 bg-amber-400 rounded-full blur-[100px] -top-20 -left-20 animate-pulse"></div>
                <div className="absolute w-[500px] h-[500px] bg-emerald-500 rounded-full blur-[120px] bottom-0 right-0"></div>
            </div>

            <div className="bg-white/95 backdrop-blur-md p-10 rounded-[2rem] shadow-2xl w-full max-w-md relative z-10 border border-white/20 transform transition-all hover:scale-[1.01] duration-500 mx-4">
                <div className="flex flex-col items-center mb-8">
                    <div className="w-20 h-20 bg-gradient-to-br from-emerald-500 to-amber-500 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-500/30 mb-5 transform transition-transform hover:rotate-12 duration-300">
                        <MonitorSmartphone size={40} className="text-white" />
                    </div>
                    <h1 className="text-3xl font-black text-slate-800 tracking-tight">TerminalSight</h1>
                    <p className="text-emerald-600 font-bold tracking-widest text-xs uppercase mt-1 mb-2">
                        Panabo City
                    </p>
                    <p className="text-slate-500 text-sm leading-relaxed max-w-xs text-center">
                        Terminal Queue Management System
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
                                <User size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    type="text"
                                    placeholder="Enter your admin ID"
                                    className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all duration-300 hover:bg-white"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    required
                                />
                            </div>
                        </div>

                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                                    Password
                                </label>
                                <button 
                                    type="button"
                                    className="text-xs font-bold text-emerald-600 hover:text-amber-500 transition-colors duration-300"
                                    onClick={() => { setView("request_otp"); setError(""); setSuccessMsg(""); }}
                                >
                                    Forgot password?
                                </button>
                            </div>
                            <div className="relative">
                                <Lock size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    type={showPassword ? "text" : "password"}
                                    placeholder="••••••••••••"
                                    className="w-full pl-10 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all duration-300 hover:bg-white"
                                    autoComplete="current-password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                />
                                <button
                                    type="button"
                                    onMouseDown={() => setShowPassword(true)}
                                    onMouseUp={() => setShowPassword(false)}
                                    onMouseLeave={() => setShowPassword(false)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-emerald-600 transition-colors cursor-pointer"
                                    title="Hold to show password"
                                >
                                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full py-3 px-4 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-amber-500 text-white text-sm font-bold rounded-xl transition-all duration-500 shadow-md hover:shadow-lg hover:-translate-y-1 flex items-center justify-center"
                        >
                            {isLoading ? <Loader2 size={20} className="animate-spin" /> : "Log In"}
                        </button>
                </form>
                )}

                {view === "request_otp" && (
                    <form className="space-y-5" onSubmit={handleRequestOTP}>
                        <div>
                            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                                Email Address
                            </label>
                            <div className="relative">
                                <User size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    type="email"
                                    placeholder="e.g. admin@email.com"
                                    className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all hover:bg-white"
                                    value={contact}
                                    onChange={(e) => setContact(e.target.value)}
                                    required
                                />
                            </div>
                        </div>
                        <button type="submit" disabled={isLoading} className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold rounded-xl transition-all duration-300 shadow-md hover:shadow-lg hover:-translate-y-1 flex justify-center">
                            {isLoading ? <Loader2 size={20} className="animate-spin" /> : "Send OTP"}
                        </button>
                        <button type="button" onClick={() => { setView("login"); setError(""); }} className="w-full py-3 px-4 bg-white text-slate-600 hover:text-amber-600 hover:bg-amber-50 border border-slate-200 hover:border-amber-200 text-sm font-bold rounded-xl transition-all duration-300">
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
                                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-center tracking-[0.5em] font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                value={otp}
                                onChange={(e) => setOtp(e.target.value)}
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                                New Password
                            </label>
                            <div className="relative mb-2">
                                <Lock size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    type={showNewPassword ? "text" : "password"}
                                    placeholder="Enter new strong password"
                                    className="w-full pl-10 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    required
                                />
                                <button
                                    type="button"
                                    onMouseDown={() => setShowNewPassword(true)}
                                    onMouseUp={() => setShowNewPassword(false)}
                                    onMouseLeave={() => setShowNewPassword(false)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-emerald-600 transition-colors cursor-pointer"
                                    title="Hold to show password"
                                >
                                    {showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>
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
                        <button type="submit" disabled={isLoading} className="w-full py-3 px-4 bg-emerald-600 hover:bg-amber-500 text-white text-sm font-bold rounded-xl transition-all duration-300 shadow-md hover:shadow-lg hover:-translate-y-1 flex justify-center">
                            {isLoading ? <Loader2 size={20} className="animate-spin" /> : "Securely Reset Password"}
                        </button>
                        <button type="button" onClick={() => { setView("login"); setError(""); }} className="w-full py-3 px-4 bg-white text-slate-600 hover:text-red-600 hover:bg-red-50 border border-slate-200 hover:border-red-200 text-sm font-bold rounded-xl transition-all duration-300">
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
