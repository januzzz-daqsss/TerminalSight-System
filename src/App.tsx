import { PublicView } from "./components/views/PublicView";
import { useNotifications } from "./notifications/useNotifications";
import { NotificationBanner, SystemDetails } from "./notifications/NotificationUI";
import type { Notice, Target } from "./notifications/model";
import { useState, useEffect, useCallback } from "react";
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
    const isPublic = ['/signage', '/public-view'].includes(window.location.pathname);
    const [bays, setBays] = useState<Bay[]>(initialBays);
    const [activeTab, setActiveTab] = useState("dashboard");
    const [liveDataReady, setLiveDataReady] = useState(false);
    const [showSystem, setShowSystem] = useState(false);
    const closeSystem = useCallback(() => setShowSystem(false), []);
    const [focusTarget, setFocusTarget] = useState<{ target: Target; nonce: number } | null>(null);
    const notifications = useNotifications(bays, isAuthenticated && !isPublic, liveDataReady);
    const inspectNotice = (notice: Notice) => {
        notifications.markRead(notice.id);
        if (notice.target?.kind === 'system') setShowSystem(true);
        else if (notice.target) {
            setActiveTab(notice.target.kind === 'bay' ? 'dashboard' : 'camera');
            setFocusTarget({ target: notice.target, nonce: Date.now() });
        }
    };
    useEffect(() => {
        if (!focusTarget || focusTarget.target.kind === 'system') return;
        const { target } = focusTarget;
        const frame = requestAnimationFrame(() => {
            const element = document.getElementById(`${target.kind}-${target.id}`);
            element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            element?.focus({ preventScroll: true });
        });
        const timer = setTimeout(() => setFocusTarget(null), 5000);
        return () => { cancelAnimationFrame(frame); clearTimeout(timer); };
    }, [focusTarget]);

    // Every display polls the same snapshot; no separate browser countdown can drift.
    useEffect(() => {
        let stopped = false;
        let timer: ReturnType<typeof setTimeout>;
        let controller: AbortController;
        const clock = setInterval(() => setNow(new Date()), 1000);
        const poll = async () => {
            controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);
            try {
                const response = await fetch('/api/bays', { signal: controller.signal, cache: 'no-store' });
                if (!response.ok) throw new Error('Bay data unavailable');
                const data: { bays: Bay[] } = await response.json();
                if (!Array.isArray(data.bays) || data.bays.length !== 10) throw new Error('Invalid bay data');
                if (stopped) return;
                setBays(previous => data.bays.map(bay => ({ ...bay,
                    audioPlayed: bay.status !== 'Available' && previous.find(old => old.id === bay.id)?.sessionId === bay.sessionId
                        ? previous.find(old => old.id === bay.id)?.audioPlayed : false,
                })));
                setLiveDataReady(true);
            } catch {
                if (!stopped) setLiveDataReady(false);
            } finally {
                clearTimeout(timeout);
                if (!stopped) timer = setTimeout(poll, 1000);
            }
        };
        void poll();
        return () => { stopped = true; controller?.abort(); clearTimeout(timer); clearInterval(clock); };
    }, []);

    // Text-to-Speech (TTS) PA System Logic
    useEffect(() => {
        if (isPublic || !isAuthenticated || !liveDataReady) return;

        const savedSettings = localStorage.getItem("terminalsight-settings");
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
        }
    }, [bays, liveDataReady, isPublic, isAuthenticated]);

    if (window.location.pathname === "/signage") {
        return <PublicSignageView bays={bays} now={now} live={liveDataReady} />;
    }

    if (window.location.pathname === "/public-view") {
        return <PublicView bays={bays} now={now} live={liveDataReady} />;
    }

    if (!isAuthenticated) {
        return <AdminLogin onLogin={() => setIsAuthenticated(true)} />;
    }

    return (
        <div className="flex h-screen print:h-auto bg-slate-50 overflow-hidden print:overflow-visible font-sans">
            <Sidebar
                system={notifications.system}
                onSystemDetails={() => setShowSystem(true)}
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                onLogout={() => {
                    sessionStorage.removeItem("terminalsight-export-token");
                    setIsAuthenticated(false);
                }}
            />

            {/* Right panel */}
            <div className="flex flex-col flex-1 min-w-0">
                <Header
                    clock={formatClock(now)}
                    date={formatDate(now)}
                    notices={notifications.notices}
                    markRead={notifications.markRead}
                    markAllRead={notifications.markAllRead}
                    inspect={inspectNotice}
                />

                {notifications.banners[0] && <div className="relative z-40 flex shrink-0 justify-center px-5 pt-3 print:hidden"><NotificationBanner key={notifications.banners[0].id} notice={notifications.banners[0]} dismiss={notifications.dismiss} inspect={inspectNotice} /></div>}
                {showSystem && <SystemDetails system={notifications.system} close={closeSystem} testNotification={notifications.testNotification} />}
                {/* Scrollable content */}
                <main className="flex-1 overflow-y-auto print:overflow-visible print:p-0 p-5 space-y-5">
                    {activeTab === "dashboard" && <DashboardView bays={bays} focusedBay={focusTarget?.target.kind === "bay" ? focusTarget.target.id : undefined} />}
                    {activeTab === "analytics" && <AnalyticsView />}
                    {activeTab === "camera" && <CameraZonesView health={notifications.system.cameras} localOnline={notifications.system.local === "Online"} focusedCamera={focusTarget?.target.kind === "camera" ? focusTarget.target.id : undefined} />}
                    {activeTab === "violations" && <ViolationLogsView />}
                    {activeTab === "settings" && <SettingsView />}
                </main>
            </div>
        </div>
    );
}
