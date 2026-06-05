import { useState, useEffect } from "react";
import { Bay } from "./types";
import { initialBays } from "./mockData";
import { formatClock, formatDate } from "./utils/helpers";
import { Sidebar } from "./components/layout/Sidebar";
import { Header } from "./components/layout/Header";
import { AnalyticsView } from "./components/views/AnalyticsView";
import { CameraZonesView } from "./components/views/CameraZonesView";
import { ViolationLogsView } from "./components/views/ViolationLogsView";
import { SettingsView } from "./components/views/SettingsView";
import { AdminLogin } from "./components/views/AdminLogin";
import { PublicSignageView } from "./components/views/PublicSignageView";
import { DashboardView } from "./components/views/DashboardView";

export default function App() {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [now, setNow] = useState(new Date());
    const [bays, setBays] = useState<Bay[]>(() => {
        const saved = localStorage.getItem("slotsight-state");
        if (saved) {
            let parsed = JSON.parse(saved);
            // Hotfix: Clean up previously cached state to enforce structural rules
            parsed = parsed.map((bay: any) => {
                if (bay.status !== "Available") {
                    const isUVExpress = bay.id === 1 || bay.id === 10;
                    if (isUVExpress && bay.vehicleType !== "UV Express") {
                        return { ...bay, vehicleType: "UV Express" };
                    }
                    if (!isUVExpress && bay.vehicleType === "UV Express") {
                        return { ...bay, vehicleType: "Bus" };
                    }
                }
                return bay;
            });
            return parsed;
        }
        return initialBays;
    });
    const [activeTab, setActiveTab] = useState("dashboard");

    // Consolidated master clock and timer update to prevent multiple re-renders
    useEffect(() => {
        // If we are in public signage view, just listen to the broadcast channel
        if (window.location.pathname === "/signage") {
            const channel = new BroadcastChannel("slotsight-sync");
            const id = setInterval(() => setNow(new Date()), 1000);

            channel.onmessage = (event) => {
                setBays(JSON.parse(event.data));
            };

            return () => {
                clearInterval(id);
                channel.close();
            };
        }

        // ── Admin Dashboard: Poll the Python AI Backend ──
        const channel = new BroadcastChannel("slotsight-sync");
        
        const fetchAIData = async () => {
            setNow(new Date());
            
            try {
                // Fetch JSON Status & Timer in parallel for speed
                const [statusRes, timerRes] = await Promise.all([
                    fetch("http://127.0.0.1:5000/api/status", { mode: 'cors' }),
                    fetch("http://127.0.0.1:5000/api/timers", { mode: 'cors' })
                ]);

                const statusData = await statusRes.json();
                const timerData = await timerRes.json();

                setBays((prev) => {
                    const newBays = prev.map((bay) => {
                        // Keep time decrementing for other bays in the UI
                        let nextTime = bay.timeRemaining;
                        if (nextTime !== undefined && bay.id !== 6 && bay.id !== 1) {
                            nextTime = Math.max(0, nextTime - 1);
                        }

                        // Match React Bay ID (e.g., 6) to Python JSON Key (e.g., "Bay_6")
                        const aiKey = `Bay_${bay.id}`;
                        const aiStatus = statusData[aiKey];

                        // If backend didn't provide data for this bay, just decrement its timer and continue
                        if (!aiStatus) {
                            // If it hit 0 naturally, transition to Overstaying
                            if (bay.status === "Occupied" && nextTime === 0 && bay.id !== 6 && bay.id !== 1) {
                                return { ...bay, status: "Overstaying" as const, timeRemaining: 0 };
                            }
                            return { ...bay, timeRemaining: nextTime };
                        }

                        // Normalize Python's ALL_CAPS string to React's Capitalized literal types
                        let normalizedStatus: "Available" | "Occupied" | "Overstaying" = "Available";
                        if (aiStatus === "OCCUPIED") normalizedStatus = "Occupied";
                        if (aiStatus === "OVERSTAYING") normalizedStatus = "Overstaying";

                        // Parse the Timer ONLY if it's Bay 1 or Bay 6 and it's occupied
                        if ((bay.id === 6 || bay.id === 1) && (normalizedStatus === "Occupied" || normalizedStatus === "Overstaying")) {
                            const elapsedSeconds = timerData[aiKey] || 0;
                            // 15 minutes = 900 seconds
                            const MAX_TIME = 15 * 60;
                            nextTime = Math.max(0, MAX_TIME - elapsedSeconds);

                            // If countdown hits 0, trigger Overstaying
                            if (nextTime === 0) {
                                normalizedStatus = "Overstaying";
                            }
                        }

                        return {
                            ...bay,
                            status: normalizedStatus,
                            timeRemaining: nextTime,
                            vehicleType: bay.id === 6 ? "Bus" : (bay.id === 1 ? "UV Express" : bay.vehicleType) 
                        };
                    });

                    // Save and broadcast state to Signage view
                    const stringifiedBays = JSON.stringify(newBays);
                    localStorage.setItem("slotsight-state", stringifiedBays);
                    channel.postMessage(stringifiedBays);
                    return newBays;
                });

            } catch (error) {
                // Silent catch: If Python isn't running, the UI just continues with its previous state
                // This prevents the console from being spammed if the backend crashes
            }
        };

        // Poll the AI backend every 1 second
        const intervalId = setInterval(fetchAIData, 1000);
        return () => {
            clearInterval(intervalId);
            channel.close();
        };
    }, []);

    // Text-to-Speech (TTS) PA System Logic
    useEffect(() => {
        if (window.location.pathname === "/signage") return;

        const savedSettings = localStorage.getItem("slotsight-settings");
        const settings = savedSettings ? JSON.parse(savedSettings) : { paVolume: 80, language: "bisaya" };

        let updated = false;
        const nextBays = bays.map((bay) => {
            if (bay.status === "Overstaying" && !bay.audioPlayed) {
                const utterance = new SpeechSynthesisUtterance(
                    `Attention. Bay ${bay.id}, ${bay.vehicleType || "Vehicle"}, you have exceeded the loading limit. Please depart immediately.`,
                );
                
                utterance.volume = settings.paVolume / 100;

                window.speechSynthesis.speak(utterance);
                updated = true;
                return { ...bay, audioPlayed: true };
            }
            return bay;
        });

        if (updated) {
            setBays(nextBays);
            const stringifiedBays = JSON.stringify(nextBays);
            localStorage.setItem("slotsight-state", stringifiedBays);
            const channel = new BroadcastChannel("slotsight-sync");
            channel.postMessage(stringifiedBays);
            channel.close();
        }
    }, [bays]);

    if (window.location.pathname === "/signage") {
        return <PublicSignageView bays={bays} now={now} />;
    }

    if (!isAuthenticated) {
        return <AdminLogin onLogin={() => setIsAuthenticated(true)} />;
    }

    return (
        <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">
            <Sidebar
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                onLogout={() => setIsAuthenticated(false)}
            />

            {/* Right panel */}
            <div className="flex flex-col flex-1 min-w-0">
                <Header
                    clock={formatClock(now)}
                    date={formatDate(now)}
                    onViewViolations={() => setActiveTab("violations")}
                />

                {/* Scrollable content */}
                <main className="flex-1 overflow-y-auto p-5 space-y-5">
                    {activeTab === "dashboard" && <DashboardView bays={bays} />}
                    {activeTab === "analytics" && <AnalyticsView />}
                    {activeTab === "camera" && <CameraZonesView />}
                    {activeTab === "violations" && <ViolationLogsView />}
                    {activeTab === "settings" && <SettingsView />}
                </main>
            </div>
        </div>
    );
}
