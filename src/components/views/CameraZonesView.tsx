import { useState, useEffect } from "react";
import {
    AlertTriangle,
    MapPin,
    Plus,
    Video,
    Signal,
    X,
    Maximize,
    Activity,
} from "lucide-react";

export interface CameraFeed {
    id: number;
    name: string;
    assignedBays: string;
    rtspUrl: string;
    status: "LIVE" | "OFFLINE";
}

const INITIAL_CAMERAS: CameraFeed[] = [
    {
        id: 1,
        name: "Northbound Cam 1",
        assignedBays: "Bays 1-3",
        rtspUrl: "rtsp://192.168.1.101/stream",
        status: "LIVE",
    },
    {
        id: 2,
        name: "Southbound Cam 1",
        assignedBays: "Bays 6-8",
        rtspUrl: "rtsp://192.168.1.102/stream",
        status: "LIVE",
    },
];

function CameraHUD({ camName }: { camName: string }) {
    const [fps, setFps] = useState(24);
    const [ping, setPing] = useState(12);

    useEffect(() => {
        const interval = setInterval(() => {
            setFps(Math.floor(Math.random() * (30 - 22 + 1) + 22));
            setPing(Math.floor(Math.random() * (25 - 12 + 1) + 12));
        }, 2000);
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="absolute top-4 left-4 flex flex-col gap-2 z-20">
            <div className="bg-black/60 backdrop-blur-sm px-3 py-1.5 rounded border border-white/10 text-white text-xs font-bold font-mono tracking-wide shadow-lg">
                {camName}
            </div>
            <div className="flex items-center gap-3 bg-black/60 backdrop-blur-sm px-3 py-1.5 rounded border border-white/10 text-emerald-400 text-[10px] font-bold font-mono shadow-lg w-max">
                <span className="flex items-center gap-1.5">
                    <Activity size={12} className="text-emerald-500" /> FPS: {fps}
                </span>
                <span className="text-slate-500">|</span>
                <span className="flex items-center gap-1.5">
                    <Signal size={12} className="text-emerald-500" /> {ping}ms
                </span>
            </div>
        </div>
    );
}

export function CameraZonesView() {
    const [cameras, setCameras] = useState<CameraFeed[]>(INITIAL_CAMERAS);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingCamera, setEditingCamera] = useState<CameraFeed | null>(null);

    const [formData, setFormData] = useState({
        name: "",
        assignedBays: "",
        rtspUrl: "",
    });

    const handleFullscreen = (cameraId: number) => {
        const el = document.getElementById(`camera-feed-${cameraId}`);
        if (el) {
            if (document.fullscreenElement) {
                document.exitFullscreen();
            } else {
                el.requestFullscreen().catch((err) => {
                    console.error("Error attempting to enable fullscreen:", err);
                });
            }
        }
    };

    const handleOpenModal = (cam?: CameraFeed) => {
        if (cam) {
            setEditingCamera(cam);
            setFormData({
                name: cam.name,
                assignedBays: cam.assignedBays,
                rtspUrl: cam.rtspUrl,
            });
        } else {
            setEditingCamera(null);
            setFormData({ name: "", assignedBays: "", rtspUrl: "" });
        }
        setIsModalOpen(true);
    };

    const handleSave = (e: React.FormEvent) => {
        e.preventDefault();
        if (editingCamera) {
            setCameras(
                cameras.map((c) =>
                    c.id === editingCamera.id ? { ...c, ...formData } : c,
                ),
            );
        } else {
            setCameras([...cameras, { id: Date.now(), status: "LIVE", ...formData }]);
        }
        setIsModalOpen(false);
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-slate-800 font-bold text-lg">Camera Zones</h2>
                    <p className="text-slate-500 text-sm">
                        Live RTSP feeds and local IP camera management
                    </p>
                </div>
                <div className="flex items-center gap-4">
                    {/* AI Bounding Box Legend */}
                    <div className="hidden lg:flex items-center gap-3 bg-white border border-slate-200 px-3 py-1.5 rounded-lg shadow-sm text-xs font-semibold text-slate-600">
                        <div className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-sm bg-red-500 shadow-[0_0_5px_rgba(239,68,68,0.5)]" />
                            Occupied / Overstaying
                        </div>
                        <span className="text-slate-300">|</span>
                        <div className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-sm bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.5)]" />
                            Available Slot
                        </div>
                    </div>

                    <div className="flex items-center gap-2 bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-lg border border-emerald-200">
                        <Signal size={16} className="animate-pulse" />
                        <span className="text-sm font-bold">
                            Local Network Status: Connected
                        </span>
                    </div>
                    <button
                        onClick={() => handleOpenModal()}
                        className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-1.5 rounded-lg text-sm font-semibold hover:bg-emerald-700 transition-colors shadow-sm"
                    >
                        <Plus size={16} />
                        Add New IP Camera
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                {cameras.map((cam) => (
                    <div
                        key={cam.id}
                        className="bg-slate-800 rounded-xl overflow-hidden shadow-md flex flex-col border border-slate-700 transition-all duration-300 hover:shadow-[0_0_25px_rgba(16,185,129,0.25)] hover:border-emerald-500/50 hover:-translate-y-1"
                    >
                        {/* Video Area (Updated with AI Stream Integration) */}
                        <div id={`camera-feed-${cam.id}`} className="relative aspect-video bg-slate-900 border-b border-slate-800 flex items-center justify-center overflow-hidden group">
                            {cam.status === "LIVE" ? (
                                <>
                                    {/* --- THE FLASK AI INTEGRATION --- */}
                                    {cam.name === "Southbound Cam 1" || cam.name === "Northbound Cam 1" ? (
                                        <img
                                            src={cam.name === "Southbound Cam 1" ? "http://127.0.0.1:5000/video_feed/southbound_cam1" : "http://127.0.0.1:5000/video_feed/northbound_cam1"}
                                            alt="Live AI Stream"
                                            className="absolute inset-0 w-full h-full object-cover"
                                        />
                                    ) : (
                                        <>
                                            {/* Fallback for other cameras (Grid lines & Icon) */}
                                            <div className="absolute inset-0 border border-slate-800/50 m-4 rounded" />
                                            <Video size={48} className="text-slate-700" />
                                        </>
                                    )}
                                    {/* --------------------------------- */}

                                    {/* Overlays (These now sit elegantly on top of the live video!) */}
                                    <CameraHUD camName={cam.name + (cam.assignedBays ? ` - ${cam.assignedBays}` : "")} />

                                    <div className="absolute top-4 right-4 flex flex-col gap-2 items-end z-20">
                                        <div className="flex items-center gap-2 bg-black/60 backdrop-blur-sm px-2.5 py-1.5 rounded border border-white/10 shadow-lg">
                                            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                                            <span className="text-white text-[10px] font-bold tracking-widest uppercase">
                                                Live
                                            </span>
                                        </div>
                                        <button 
                                            onClick={() => handleFullscreen(cam.id)}
                                            className="bg-black/60 hover:bg-emerald-600/80 backdrop-blur-sm p-1.5 rounded border border-white/10 shadow-lg text-white opacity-0 group-hover:opacity-100 transition-all duration-300"
                                        >
                                            <Maximize size={14} />
                                        </button>
                                    </div>

                                    {/* Unified Glassmorphism Footer Bar */}
                                    <div className="absolute bottom-0 inset-x-0 bg-slate-900/60 backdrop-blur-md border-t border-white/10 p-3 flex items-center justify-between z-20">
                                        <div className="flex items-center gap-4">
                                            <div className="flex items-center gap-2 text-slate-300">
                                                <MapPin size={14} className="text-emerald-500" />
                                                <span className="text-xs font-mono truncate max-w-[200px]">
                                                    {cam.rtspUrl}
                                                </span>
                                            </div>
                                            <div className="hidden xl:flex text-white/50 font-mono text-[10px] bg-black/40 px-2 py-1 rounded">
                                                REC • {new Date().toISOString().substr(11, 8)}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <div className="text-emerald-400 font-mono text-[10px] bg-emerald-950/80 border border-emerald-500/30 px-2 py-1 rounded flex items-center gap-1.5 shadow-[0_0_10px_rgba(16,185,129,0.2)]">
                                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                                AI ACTIVE
                                            </div>
                                            <button
                                                onClick={() => handleOpenModal(cam)}
                                                className="bg-white/10 hover:bg-emerald-500 hover:text-white text-slate-200 text-xs font-semibold px-3 py-1 rounded transition-all duration-300 border border-white/10"
                                            >
                                                Configure
                                            </button>
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <div className="flex flex-col items-center gap-2 text-slate-600">
                                    <AlertTriangle size={32} />
                                    <span className="text-xs font-bold uppercase tracking-widest">
                                        Feed Offline
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>
                ))}

                {/* Empty Slot Placeholder */}
                <button
                    onClick={() => handleOpenModal()}
                    className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-slate-300 rounded-xl bg-slate-50/50 hover:bg-slate-100/50 hover:border-emerald-400 hover:text-emerald-600 text-slate-500 transition-all duration-300 min-h-[350px] group shadow-sm"
                >
                    <div className="w-14 h-14 rounded-full bg-slate-200 group-hover:bg-emerald-100 flex items-center justify-center transition-colors shadow-sm">
                        <Plus size={28} className="text-slate-400 group-hover:text-emerald-600 transition-colors" />
                    </div>
                    <span className="font-bold text-lg">Add New IP Camera</span>
                    <span className="text-sm font-medium opacity-70">Click to configure a new RTSP stream slot</span>
                </button>
            </div>

            {/* Modal Overlay */}
            {isModalOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
                        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                            <h3 className="text-lg font-bold text-slate-800">
                                {editingCamera ? "Configure Camera" : "Add New IP Camera"}
                            </h3>
                            <button
                                onClick={() => setIsModalOpen(false)}
                                className="text-slate-400 hover:text-slate-600 transition-colors p-1 rounded hover:bg-slate-100"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <form onSubmit={handleSave} className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                                    Camera Display Name
                                </label>
                                <input
                                    required
                                    type="text"
                                    value={formData.name}
                                    onChange={(e) =>
                                        setFormData({ ...formData, name: e.target.value })
                                    }
                                    placeholder="e.g. CAM 7"
                                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-shadow"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                                    Assigned Bays
                                </label>
                                <input
                                    type="text"
                                    value={formData.assignedBays}
                                    onChange={(e) =>
                                        setFormData({ ...formData, assignedBays: e.target.value })
                                    }
                                    placeholder="e.g. Northbound Bays 1-3"
                                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-shadow"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                                    RTSP Stream URL
                                </label>
                                <input
                                    required
                                    type="text"
                                    value={formData.rtspUrl}
                                    onChange={(e) =>
                                        setFormData({ ...formData, rtspUrl: e.target.value })
                                    }
                                    placeholder="rtsp://192.168.1.10:554/stream"
                                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-shadow"
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
                                    className="px-4 py-2 text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors shadow-sm"
                                >
                                    Save Configuration
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
