import { useState } from "react";
import {
    AlertTriangle,
    MapPin,
    Plus,
    Video,
    Signal,
    X,
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

export function CameraZonesView() {
    const [cameras, setCameras] = useState<CameraFeed[]>(INITIAL_CAMERAS);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingCamera, setEditingCamera] = useState<CameraFeed | null>(null);

    const [formData, setFormData] = useState({
        name: "",
        assignedBays: "",
        rtspUrl: "",
    });

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
                    <div className="flex items-center gap-2 bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-lg border border-emerald-200">
                        <Signal size={16} className="animate-pulse" />
                        <span className="text-sm font-bold">
                            Local Network Status: Connected
                        </span>
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
                    <div
                        key={cam.id}
                        className="bg-slate-800 rounded-xl overflow-hidden shadow-md flex flex-col border border-slate-700"
                    >
                        {/* Video Area (Updated with AI Stream Integration) */}
                        <div className="relative aspect-video bg-slate-900 border-b border-slate-800 flex items-center justify-center overflow-hidden">
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
                                    <div className="absolute top-4 left-4 right-4 flex justify-between items-start z-10">
                                        <div className="bg-black/60 backdrop-blur-sm px-3 py-1.5 rounded text-white text-xs font-bold font-mono tracking-wide">
                                            {cam.name}{" "}
                                            {cam.assignedBays ? `- ${cam.assignedBays}` : ""}
                                        </div>
                                        <div className="flex items-center gap-2 bg-black/60 backdrop-blur-sm px-2.5 py-1 rounded border border-white/10 shadow-lg">
                                            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                                            <span className="text-white text-[10px] font-bold tracking-widest uppercase">
                                                Live
                                            </span>
                                        </div>
                                    </div>

                                    {/* Fake timestamp overlay */}
                                    <div className="absolute bottom-4 left-4 text-white/60 font-mono text-[10px] z-10 bg-black/40 px-2 py-1 rounded">
                                        REC • 00:00:00
                                    </div>
                                    <div className="absolute bottom-4 right-4 text-emerald-400 font-mono text-[10px] z-10 bg-black/40 px-2 py-1 rounded">
                                        AI ACTIVE
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

                        {/* Bottom Info Bar */}
                        <div className="px-4 py-3 bg-slate-800 flex items-center justify-between">
                            <div className="flex items-center gap-2 text-slate-400">
                                <MapPin size={14} />
                                <span className="text-xs font-mono truncate max-w-[200px]">
                                    {cam.rtspUrl}
                                </span>
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
                                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-shadow"
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
                                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-shadow"
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
    );
}
