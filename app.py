# app.py
import cv2
import time
import threading
from flask import Flask, jsonify, Response
from flask_cors import CORS
from detector import analyze_frame # IMPORTING YOUR AI BRAIN

app = Flask(__name__)
CORS(app) 

# --- GLOBAL STATE VARIABLES ---
live_status = {"Bay_1": "AVAILABLE", "Bay_2": "AVAILABLE", "Bay_3": "AVAILABLE", "Bay_4": "AVAILABLE", "Bay_5": "AVAILABLE", "Bay_6": "AVAILABLE", "Bay_7": "AVAILABLE", "Bay_8": "AVAILABLE", "Bay_9": "AVAILABLE", "Bay_10": "AVAILABLE"}
timers = {
    "Bay_1": {"start_time": None, "is_active": False},
    "Bay_6": {"start_time": None, "is_active": False}
}
latest_frame_sb = None # Holds the most recent image for Southbound
latest_frame_nb = None # Holds the most recent image for Northbound

def run_ai_background(video_path, camera_name):
    global live_status, timers, latest_frame_sb, latest_frame_nb
    
    try:
        cap = cv2.VideoCapture(video_path)

        if not cap.isOpened():
            print(f"❌ FATAL ERROR: Could not find or open {camera_name} video at: {video_path}")
            return

        print(f"✅ AI Background Thread for {camera_name} Started Successfully!")
        
        frame_counter = 0
        while True:
            success, frame = cap.read()
            if not success:
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0) # Loop video 
                continue

            frame_counter += 1
            # Skip frames to speed up video playback (YOLO is slow, so we drop frames to keep 1x speed visually)
            if frame_counter % 2 != 0:
                continue

            # 1. RUN THE AI BRAIN
            current_data = analyze_frame(frame, camera_name) 

            # 2. UPDATE STATUS AND TIMER LOGIC
            for bay, status in current_data.items():
                if status == "OCCUPIED":
                    live_status[bay] = "OCCUPIED"
                    if bay in timers:
                        if not timers[bay]["is_active"]:
                            timers[bay]["start_time"] = time.time()
                            timers[bay]["is_active"] = True
                else:
                    live_status[bay] = "AVAILABLE"
                    if bay in timers:
                        timers[bay]["is_active"] = False

            # 3. STORE THE ANNOTATED FRAME FOR THE BROWSER
            ret, buffer = cv2.imencode('.jpg', frame)
            if camera_name == "southbound":
                latest_frame_sb = buffer.tobytes()
            else:
                latest_frame_nb = buffer.tobytes()
            
    except Exception as e:
        print(f"\n❌ FATAL ERROR IN AI THREAD ({camera_name}): {str(e)}")
        import traceback
        traceback.print_exc()

# --- START THE AI THREADS IMMEDIATELY ---
# Southbound Cam (Bay 6-8 usually)
threading.Thread(target=run_ai_background, args=(r"public\sample-videos\sample-VID_20260604_133427.mp4", "southbound"), daemon=True).start()
# Northbound Cam (Bay 1 UV Express)
threading.Thread(target=run_ai_background, args=(r"public\sample-videos\sample-VID_20260604_131402.mp4", "northbound"), daemon=True).start()

def stream_video(camera_name):
    """Simply serves whatever the latest frame is to the browser"""
    global latest_frame_sb, latest_frame_nb
    while True:
        frame = latest_frame_sb if camera_name == "southbound" else latest_frame_nb
        if frame is not None:
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')
        time.sleep(0.03)

# --- FLASK API ROUTES ---
@app.route('/video_feed/southbound_cam1')
def video_feed_sb():
    return Response(stream_video("southbound"), mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/video_feed/northbound_cam1')
def video_feed_nb():
    return Response(stream_video("northbound"), mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/api/status')
def get_status():
    return jsonify(live_status)

# Optional: Consolidated timer endpoint
@app.route('/api/timers')
def get_all_timers():
    result = {}
    for bay, timer_data in timers.items():
        if timer_data["is_active"]:
            elapsed = time.time() - timer_data["start_time"]
            result[bay] = int(elapsed)
        else:
            result[bay] = 0
    return jsonify(result)

# Legacy single bay routes just in case the UI is explicitly calling them
@app.route('/api/bay6/timer')
def get_timer_6():
    if timers["Bay_6"]["is_active"]:
        elapsed = time.time() - timers["Bay_6"]["start_time"]
        return jsonify({"seconds": int(elapsed)})
    return jsonify({"seconds": 0})

@app.route('/api/bay1/timer')
def get_timer_1():
    if timers["Bay_1"]["is_active"]:
        elapsed = time.time() - timers["Bay_1"]["start_time"]
        return jsonify({"seconds": int(elapsed)})
    return jsonify({"seconds": 0})

if __name__ == '__main__':
    print("🚀 SlotSight API Server Running on http://127.0.0.1:5000")
    app.run(port=5000, debug=False) # Keep debug=False when using threading!