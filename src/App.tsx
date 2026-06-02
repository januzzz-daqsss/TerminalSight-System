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

        // Otherwise (Admin Dashboard), run the simulator and broadcast state
        const channel = new BroadcastChannel("slotsight-sync");
        let mockYoloTimer = 0;

        const id = setInterval(() => {
            setNow(new Date());

            setBays((prev) => {
                let newBays = prev.map((bay) => {
                    if (bay.status === "Available") return bay;
                    if (bay.timeRemaining === undefined) return bay;

                    const next = bay.timeRemaining - 1;
                    // Transition occupied → overstaying when timer hits 0
                    if (bay.status === "Occupied" && next <= 0) {
                        return { ...bay, status: "Overstaying" as const, timeRemaining: 0 };
                    }
                    return { ...bay, timeRemaining: next };
                });

                // Mock YOLOv8 Simulator: triggers randomly roughly every 10-15 seconds
                mockYoloTimer++;
                if (
                    (mockYoloTimer >= 10 && Math.random() > 0.5) ||
                    mockYoloTimer >= 15
                ) {
                    mockYoloTimer = 0;

                    const availableBays = newBays.filter((b) => b.status === "Available");
                    const occupiedBays = newBays.filter(
                        (b) => b.status === "Occupied" || b.status === "Overstaying",
                    );

                    let isDeparture = false;
                    if (occupiedBays.length > 0 && availableBays.length === 0) {
                        isDeparture = true;
                    } else if (occupiedBays.length > 0 && availableBays.length > 0) {
                        // 40% chance a vehicle leaves instead of arriving
                        isDeparture = Math.random() > 0.6;
                    }

                    if (isDeparture) {
                        const randomBay =
                            occupiedBays[Math.floor(Math.random() * occupiedBays.length)];
                        newBays = newBays.map((bay) =>
                            bay.id === randomBay.id
                                ? {
                                    ...bay,
                                    status: "Available" as const,
                                    vehicleType: undefined,
                                    timeRemaining: undefined,
                                    audioPlayed: undefined,
                                }
                                : bay,
                        );
                    } else if (availableBays.length > 0) {
                        const randomBay =
                            availableBays[Math.floor(Math.random() * availableBays.length)];

                        // Panabo Terminal Structure: Bays 1 and 10 are strictly for UV Express
                        const isUVExpress = randomBay.id === 1 || randomBay.id === 10;
                        const vehicleType = isUVExpress ? "UV Express" : "Bus";
                        const timeRemaining = isUVExpress ? 10 * 60 : 15 * 60; // 10 mins for UV, 15 mins for Bus

                        newBays = newBays.map((bay) =>
                            bay.id === randomBay.id
                                ? {
                                    ...bay,
                                    status: "Occupied" as const,
                                    vehicleType: vehicleType,
                                    timeRemaining: timeRemaining,
                                }
                                : bay,
                        );
                    }
                }

                const stringifiedBays = JSON.stringify(newBays);
                localStorage.setItem("slotsight-state", stringifiedBays);
                channel.postMessage(stringifiedBays);
                return newBays;
            });
        }, 1000);

        return () => {
            clearInterval(id);
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
