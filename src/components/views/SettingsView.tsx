import { useState } from "react";
import {
    CheckCircle2,
    Save,
    RotateCcw,
    Volume2,
    Play,
    Cloud,
    Sliders,
    Globe,
    RefreshCw,
    User,
    Lock,
    Loader2
} from "lucide-react";

// Manages system configurations including timers, audio PA, and cloud sync.

const defaultSettings = {
    busGracePeriod: 15,
    uvGracePeriod: 10,
    autoReset: true,
    warningTime: 2,
    language: "bisaya",
    paVolume: 80,
    cloudSync: true,
    syncInterval: 5,
};

export function SettingsView() {
    const [settings, setSettings] = useState(() => {
        const saved = localStorage.getItem("terminalsight-settings");
        return saved ? JSON.parse(saved) : defaultSettings;
    });

    const [saveStatus, setSaveStatus] = useState<"idle" | "saved">("idle");
    const [isTestingPA, setIsTestingPA] = useState(false);

    // Account Settings State
    const currentUser = JSON.parse(localStorage.getItem("terminalsight-user") || '{"username": "admin"}');
    const [accountStatus, setAccountStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
    const [accountMsg, setAccountMsg] = useState("");
    const [newUsername, setNewUsername] = useState(currentUser.username);
    const [oldPassword, setOldPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");

    // OTP Modal State
    const [isOtpModalOpen, setIsOtpModalOpen] = useState(false);
    const [otpCode, setOtpCode] = useState("");
    const [demoOtp, setDemoOtp] = useState("");

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

    const handleAccountUpdate = () => {
        if (!oldPassword) {
            setAccountMsg("Current password is required.");
            setAccountStatus("error");
            return;
        }

        if (newPassword && strength.score < 5) {
            setAccountMsg("New password must meet ALL criteria to be 'Strong'.");
            setAccountStatus("error");
            return;
        }

        // Generate a mock OTP for the defense
        const generated = Math.floor(100000 + Math.random() * 900000).toString();
        setDemoOtp(generated);
        setOtpCode("");
        setIsOtpModalOpen(true);
    };

    const confirmAccountUpdate = async () => {
        if (otpCode !== demoOtp) {
            setAccountMsg("Invalid OTP code.");
            setAccountStatus("error");
            setIsOtpModalOpen(false);
            return;
        }

        setIsOtpModalOpen(false);
        setAccountStatus("saving");
        try {
            const res = await fetch("http://127.0.0.1:5000/api/update_account", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    current_username: currentUser.username,
                    old_password: oldPassword,
                    new_username: newUsername,
                    new_password: newPassword
                })
            });
            const data = await res.json();
            if (data.success) {
                setAccountStatus("success");
                setAccountMsg("Account updated securely!");
                localStorage.setItem("terminalsight-user", JSON.stringify({ ...currentUser, username: data.new_username }));
                setOldPassword("");
                setNewPassword("");
                setTimeout(() => { setAccountStatus("idle"); setAccountMsg(""); }, 3000);
            } else {
                setAccountStatus("error");
                setAccountMsg(data.message);
            }
        } catch (err) {
            setAccountStatus("error");
            setAccountMsg("Failed to connect to authentication server.");
        }
    };

    const handleChange = (key: string, value: any) => {
        setSettings((prev: any) => ({ ...prev, [key]: value }));
    };

    const handleReset = () => {
        setSettings(defaultSettings);
    };

    const handleSave = () => {
        localStorage.setItem("terminalsight-settings", JSON.stringify(settings));
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
    };

    const handleTestPA = async () => {
        if (isTestingPA) return;
        setIsTestingPA(true);

        try {
            // Trigger local text-to-speech first as fallback/companion
            const utterance = new SpeechSynthesisUtterance("Testing public address system.");
            utterance.volume = settings.paVolume / 100; // Apply the configured volume (0.0 to 1.0)
            window.speechSynthesis.speak(utterance);

            // Attempt to trigger the backend physical hardware PA system
            const response = await fetch("http://localhost:5000/api/test-pa", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    language: settings.language,
                    volume: settings.paVolume
                }),
            });

            if (!response.ok) {
                console.error("Backend PA test failed with status:", response.status);
            }
        } catch (error) {
            console.error("Failed to connect to PA backend:", error);
        } finally {
            // Revert state after a few seconds (simulating audio play time)
            setTimeout(() => {
                setIsTestingPA(false);
            }, 3000);
        }
    };

    return (
        <div className="flex flex-col h-full min-h-[calc(100vh-120px)]">
            <div className="flex items-center justify-between mb-6 flex-shrink-0">
                <div>
                    <h2 className="text-slate-800 font-bold text-lg">System Settings</h2>
                    <p className="text-slate-500 text-sm">
                        Configure terminal operations, thresholds, and integrations
                    </p>
                </div>
            </div>

            <div className="flex-1 space-y-6 pb-6">
                {/* Card 1: Queue & Timer Configurations */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                    <div className="flex items-center gap-2 text-emerald-600 mb-4">
                        <Sliders size={20} />
                        <h3 className="text-base font-bold text-slate-800">
                            Queue & Timer Configurations
                        </h3>
                    </div>
                    <div className="space-y-5 max-w-2xl">
                        <div className="grid grid-cols-2 gap-6">
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                                    Bus Grace Period (Minutes)
                                </label>
                                <input
                                    type="number"
                                    value={settings.busGracePeriod}
                                    onChange={(e) =>
                                        handleChange(
                                            "busGracePeriod",
                                            parseInt(e.target.value) || 0,
                                        )
                                    }
                                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                />
                                <p className="text-xs text-slate-500 mt-1">
                                    Allowed docking time before overstay alert.
                                </p>
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                                    UV Express Grace Period (Minutes)
                                </label>
                                <input
                                    type="number"
                                    value={settings.uvGracePeriod}
                                    onChange={(e) =>
                                        handleChange("uvGracePeriod", parseInt(e.target.value) || 0)
                                    }
                                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                />
                                <p className="text-xs text-slate-500 mt-1">
                                    Allowed docking time before overstay alert.
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center justify-between pt-2">
                            <div>
                                <h4 className="text-sm font-semibold text-slate-700">
                                    Enable Auto-Reset on Vehicle Exit
                                </h4>
                                <p className="text-xs text-slate-500">
                                    Automatically clear slot timer when camera detects vehicle
                                    departure.
                                </p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={settings.autoReset}
                                    onChange={(e) => handleChange("autoReset", e.target.checked)}
                                    className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-emerald-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
                            </label>
                        </div>
                    </div>
                </div>

                {/* Card 2: Audio PA System Settings */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                    <div className="flex items-center gap-2 text-emerald-600 mb-4">
                        <Volume2 size={20} />
                        <h3 className="text-base font-bold text-slate-800">
                            Audio PA System Settings
                        </h3>
                    </div>
                    <div className="space-y-5 max-w-2xl">
                        <div className="grid grid-cols-2 gap-6">
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                                    Warning Trigger Time (Minutes)
                                </label>
                                <input
                                    type="number"
                                    value={settings.warningTime}
                                    onChange={(e) =>
                                        handleChange("warningTime", parseInt(e.target.value) || 0)
                                    }
                                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                />
                                <p className="text-xs text-slate-500 mt-1">
                                    Trigger voice alert when X minutes remain.
                                </p>
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                                    Voice Alert Language
                                </label>
                                <div className="relative">
                                    <Globe
                                        size={16}
                                        className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                                    />
                                    <select
                                        value={settings.language}
                                        onChange={(e) => handleChange("language", e.target.value)}
                                        className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 appearance-none"
                                    >
                                        <option value="bisaya">Bisaya / Cebuano</option>
                                        <option value="tagalog">Tagalog</option>
                                        <option value="english">English</option>
                                    </select>
                                </div>
                                <p className="text-xs text-slate-500 mt-1">
                                    Language for automated PA announcements.
                                </p>
                            </div>
                        </div>

                        <div className="pt-2">
                            <div className="flex items-center justify-between mb-2">
                                <label className="block text-sm font-semibold text-slate-700">
                                    PA Speaker Volume
                                </label>
                                <span className="text-xs font-bold text-emerald-600">
                                    {settings.paVolume}%
                                </span>
                            </div>
                            <input
                                type="range"
                                min="0"
                                max="100"
                                value={settings.paVolume}
                                onChange={(e) =>
                                    handleChange("paVolume", parseInt(e.target.value) || 0)
                                }
                                className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-emerald-600"
                            />
                        </div>

                        <div className="pt-4 border-t border-slate-100">
                            <button
                                id="test-pa-btn"
                                onClick={handleTestPA}
                                disabled={isTestingPA}
                                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-300 border shadow-sm ${isTestingPA
                                        ? "bg-emerald-50 text-emerald-400 border-emerald-200 cursor-not-allowed"
                                        : "bg-slate-100 hover:bg-emerald-100 hover:text-emerald-700 hover:border-emerald-300 text-slate-700 border-slate-200 hover:scale-105"
                                    }`}
                            >
                                <Play size={16} className={`transition-colors ${isTestingPA ? "text-emerald-400" : "text-emerald-600"}`} />
                                {isTestingPA ? "Playing Test Audio..." : "Test PA System"}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Card 3: Cloud Synchronization Settings */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                    <div className="flex items-center gap-2 text-emerald-600 mb-4">
                        <Cloud size={20} />
                        <h3 className="text-base font-bold text-slate-800">
                            Cloud Synchronization Settings
                        </h3>
                    </div>
                    <div className="space-y-5 max-w-2xl">
                        <div className="flex items-center justify-between">
                            <div>
                                <h4 className="text-sm font-semibold text-slate-700">
                                    Enable Remote Cloud Sync
                                </h4>
                                <p className="text-xs text-slate-500">
                                    Sync local detection data to central cloud dashboard.
                                </p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={settings.cloudSync}
                                    onChange={(e) => handleChange("cloudSync", e.target.checked)}
                                    className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-emerald-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
                            </label>
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                                Sync Interval (Minutes)
                            </label>
                            <div className="relative max-w-[200px]">
                                <RefreshCw
                                    size={16}
                                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                                />
                                <input
                                    type="number"
                                    value={settings.syncInterval}
                                    onChange={(e) =>
                                        handleChange("syncInterval", parseInt(e.target.value) || 0)
                                    }
                                    className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                />
                            </div>
                        </div>

                        <div className="pt-3 border-t border-slate-100 flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                            <span className="text-xs font-semibold text-slate-600">
                                Database connection:{" "}
                                <span className="text-emerald-600">
                                    Connected (Supabase / Cloud)
                                </span>
                            </span>
                        </div>
                    </div>
                </div>

                {/* Card 4: Account Security & Access Settings */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                    <div className="flex items-center gap-2 text-emerald-600 mb-4">
                        <User size={20} />
                        <h3 className="text-base font-bold text-slate-800">
                            Account Security & Access
                        </h3>
                    </div>
                    
                    {accountMsg && (
                        <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-bold border ${accountStatus === 'success' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                            {accountMsg}
                        </div>
                    )}

                    <div className="space-y-5 max-w-2xl">
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                                Administrator Username
                            </label>
                            <div className="relative max-w-md">
                                <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    type="text"
                                    value={newUsername}
                                    onChange={(e) => setNewUsername(e.target.value)}
                                    className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                />
                            </div>
                        </div>

                        <div className="pt-4 border-t border-slate-100">
                            <h4 className="text-sm font-semibold text-slate-700 mb-4">Change Password</h4>
                            
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                                        Current Password <span className="text-red-500">*</span>
                                    </label>
                                    <div className="relative max-w-md">
                                        <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                        <input
                                            type="password"
                                            placeholder="Required to make changes"
                                            value={oldPassword}
                                            onChange={(e) => setOldPassword(e.target.value)}
                                            className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                                        New Password
                                    </label>
                                    <div className="relative max-w-md mb-2">
                                        <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                        <input
                                            type="password"
                                            placeholder="Leave blank to keep current password"
                                            value={newPassword}
                                            onChange={(e) => setNewPassword(e.target.value)}
                                            className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                        />
                                    </div>
                                    
                                    {/* Strict Password Meter */}
                                    {newPassword && (
                                        <div className="max-w-md bg-slate-50 p-3 rounded-lg border border-slate-100">
                                            <div className="flex justify-between items-center mb-2">
                                                <span className="text-xs font-bold text-slate-600">Password Strength:</span>
                                                <span className={`text-xs font-black uppercase tracking-wider ${strength.text}`}>{strength.label}</span>
                                            </div>
                                            <div className="flex gap-1 h-1.5 mb-3">
                                                <div className={`flex-1 rounded-full ${strength.score >= 1 ? strength.color : 'bg-slate-200'}`}></div>
                                                <div className={`flex-1 rounded-full ${strength.score >= 2 ? strength.color : 'bg-slate-200'}`}></div>
                                                <div className={`flex-1 rounded-full ${strength.score >= 3 ? strength.color : 'bg-slate-200'}`}></div>
                                                <div className={`flex-1 rounded-full ${strength.score >= 4 ? strength.color : 'bg-slate-200'}`}></div>
                                                <div className={`flex-1 rounded-full ${strength.score >= 5 ? strength.color : 'bg-slate-200'}`}></div>
                                            </div>
                                            
                                            <ul className="text-[11px] font-medium space-y-1">
                                                <li className={/[a-z]/.test(newPassword) ? "text-emerald-600" : "text-slate-500"}>✓ At least one lowercase letter</li>
                                                <li className={/[A-Z]/.test(newPassword) ? "text-emerald-600" : "text-slate-500"}>✓ At least one uppercase letter</li>
                                                <li className={/[0-9]/.test(newPassword) ? "text-emerald-600" : "text-slate-500"}>✓ At least one numeric digit (0-9)</li>
                                                <li className={/[@#$%^&*()_+\-=\[\]{}|;:',.<>/?]/.test(newPassword) ? "text-emerald-600" : "text-slate-500"}>✓ At least one special symbol</li>
                                                <li className={newPassword.length >= 12 ? "text-emerald-600" : "text-slate-500"}>✓ Minimum 12 characters long</li>
                                            </ul>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="pt-4 border-t border-slate-100">
                            <button
                                onClick={handleAccountUpdate}
                                disabled={accountStatus === "saving"}
                                className="flex items-center gap-2 px-6 py-2.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-sm font-bold transition-all duration-300 hover:scale-105 shadow-md shadow-slate-200"
                            >
                                {accountStatus === "saving" ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                                Update Account Credentials
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Sticky Footer */}
            <div className="sticky bottom-0 -mx-5 -mb-5 px-5 py-4 bg-white/90 backdrop-blur-sm border-t border-slate-200 flex justify-end gap-3 rounded-b-2xl shadow-[0_-4px_6px_-1px_rgb(0,0,0,0.05)]">
                <button
                    onClick={handleReset}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100 transition-all duration-300 hover:scale-105 border border-slate-200"
                >
                    <RotateCcw size={16} />
                    Reset to Defaults
                </button>
                <button
                    onClick={handleSave}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white transition-all duration-300 hover:scale-105 shadow-sm ${saveStatus === "saved" ? "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200" : "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200"}`}
                >
                    {saveStatus === "saved" ? (
                        <CheckCircle2 size={16} />
                    ) : (
                        <Save size={16} />
                    )}
                    {saveStatus === "saved" ? "Saved!" : "Save Configurations"}
                </button>
            </div>

            {/* OTP Verification Modal */}
            {isOtpModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 border border-slate-200">
                        <div className="flex items-center justify-center w-12 h-12 bg-emerald-100 rounded-full mb-4 mx-auto">
                            <Lock className="text-emerald-600" size={24} />
                        </div>
                        <h3 className="text-lg font-bold text-slate-800 text-center mb-2">Security Verification</h3>
                        <p className="text-sm text-slate-500 text-center mb-6">
                            To update your credentials, please enter the 6-digit OTP sent to your registered email.
                            <br/><br/>
                            <span className="bg-slate-100 text-slate-600 font-mono px-2 py-1 rounded text-xs border border-slate-200 shadow-sm">Demo Code: {demoOtp}</span>
                        </p>
                        
                        <input
                            type="text"
                            maxLength={6}
                            value={otpCode}
                            onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                            placeholder="• • • • • •"
                            className="w-full text-center tracking-[1em] font-mono font-bold text-2xl px-4 py-3 bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 mb-6"
                        />
                        
                        <div className="flex gap-3">
                            <button
                                onClick={() => setIsOtpModalOpen(false)}
                                className="flex-1 py-2.5 rounded-lg text-sm font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmAccountUpdate}
                                disabled={otpCode.length !== 6}
                                className="flex-1 py-2.5 rounded-lg text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Verify & Save
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
