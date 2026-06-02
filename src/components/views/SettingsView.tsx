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
} from "lucide-react";

// ─── Settings Component ───────────────────────────────────────────────────────
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
        const saved = localStorage.getItem("slotsight-settings");
        return saved ? JSON.parse(saved) : defaultSettings;
    });

    const [saveStatus, setSaveStatus] = useState<"idle" | "saved">("idle");

    const handleChange = (key: string, value: any) => {
        setSettings((prev: any) => ({ ...prev, [key]: value }));
    };

    const handleReset = () => {
        setSettings(defaultSettings);
    };

    const handleSave = () => {
        localStorage.setItem("slotsight-settings", JSON.stringify(settings));
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
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
                    <div className="flex items-center gap-2 text-indigo-600 mb-4">
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
                                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                            </label>
                        </div>
                    </div>
                </div>

                {/* Card 2: Audio PA System Settings */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                    <div className="flex items-center gap-2 text-indigo-600 mb-4">
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
                                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                                        className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 appearance-none"
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
                                <span className="text-xs font-bold text-indigo-600">
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
                                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
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
                                    className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white transition-all shadow-sm ${saveStatus === "saved" ? "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200" : "bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200"}`}
                >
                    {saveStatus === "saved" ? (
                        <CheckCircle2 size={16} />
                    ) : (
                        <Save size={16} />
                    )}
                    {saveStatus === "saved" ? "Saved!" : "Save Configurations"}
                </button>
            </div>
        </div>
    );
}
