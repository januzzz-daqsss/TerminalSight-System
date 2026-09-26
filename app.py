# app.py
import time
import threading
import csv
import io
from flask import Flask, jsonify, Response, request
from flask_cors import CORS
from contextlib import closing
from itsdangerous import URLSafeTimedSerializer, BadSignature
import sqlite3
import os
import hashlib
import secrets
import smtplib
from email.mime.text import MIMEText
import threading

from system_status import camera_state, snapshot
from occupancy import OccupancyState
from ocr_worker import OCRWorker, draw_sign_region

app = Flask(__name__)
CORS(app)

# --- SECURITY & DATABASE CONFIGURATION ---
DB_FILE = "terminalsight.db"
export_tokens = URLSafeTimedSerializer(secrets.token_hex(32), salt="occupancy-export")
# The PEPPER is a global secret key hardcoded into the backend.
# It is NEVER stored in the database.
PEPPER = "TerminalSight_Secret_Capstone_Pepper_2026!"

def hash_password(password, salt):
    """Combines password, salt, and pepper, then hashes them securely."""
    combined = password + salt + PEPPER
    return hashlib.sha256(combined.encode('utf-8')).hexdigest()

def init_db():
    """Initializes the database and creates a default admin if it doesn't exist."""
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()

    # We include phone_number and email for the OTP feature
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS admin_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            salt TEXT NOT NULL,
            phone_number TEXT,
            email TEXT
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS Occupancy_Log (
            log_id INTEGER PRIMARY KEY AUTOINCREMENT,
            slot_id TEXT NOT NULL,
            vehicle_type_class TEXT NOT NULL,
            arrival_timestamp TEXT NOT NULL,
            departure_timestamp TEXT,
            calculated_duration_minutes REAL
        )
    ''')

    # Preserve the existing Bay_N identifiers used by the detector and logs.
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS Parking_Slot (
            slot_id TEXT PRIMARY KEY,
            zone_id INTEGER,
            slot_number INTEGER NOT NULL UNIQUE,
            current_status_state TEXT NOT NULL DEFAULT 'Available'
        )
    ''')
    cursor.executemany(
        "INSERT OR IGNORE INTO Parking_Slot (slot_id, slot_number) VALUES (?, ?)",
        [(f"Bay_{number}", number) for number in range(1, 11)],
    )

    # Check if we need to insert the default admin
    cursor.execute("SELECT COUNT(*) FROM admin_users")
    if cursor.fetchone()[0] == 0:
        default_username = "admin"
        default_password = "password123"
        default_phone = "+639696078993" # Placeholder PH format
        default_email = "janustheq@gmail.com"

        # Generate a secure random salt specific to this user
        salt = secrets.token_hex(16)
        password_hash = hash_password(default_password, salt)

        cursor.execute(
            "INSERT INTO admin_users (username, password_hash, salt, phone_number, email) VALUES (?, ?, ?, ?, ?)",
            (default_username, password_hash, salt, default_phone, default_email)
        )


    conn.commit()
    conn.close()

# Initialize the database immediately when the app starts
init_db()

# --- FUNCTIONAL OTP SENDERS ---
SMTP_SENDER_EMAIL = "janustheq@gmail.com"
SMTP_APP_PASSWORD = os.environ.get("TERMINALSIGHT_SMTP_PASSWORD", "")

def send_email_async(to_email, otp):
    try:
        msg = MIMEText(f"Your TerminalSight Admin OTP code is: {otp}\n\nThis code will expire in 5 minutes.")
        msg['Subject'] = 'TerminalSight Password Reset OTP'
        msg['From'] = SMTP_SENDER_EMAIL
        msg['To'] = to_email

        server = smtplib.SMTP('smtp.gmail.com', 587)
        server.starttls()
        server.login(SMTP_SENDER_EMAIL, SMTP_APP_PASSWORD)
        server.send_message(msg)
        server.quit()
    except Exception as e:
        print(f"❌ Failed to send email: {e}")

# --- GLOBAL STATE VARIABLES ---
live_status = {"Bay_1": "AVAILABLE", "Bay_2": "AVAILABLE", "Bay_3": "AVAILABLE", "Bay_4": "AVAILABLE", "Bay_5": "AVAILABLE", "Bay_6": "AVAILABLE", "Bay_7": "AVAILABLE", "Bay_8": "AVAILABLE", "Bay_9": "AVAILABLE", "Bay_10": "AVAILABLE"}
timers = {
    "Bay_1": {"start_time": None, "is_active": False},
    "Bay_6": {"start_time": None, "is_active": False}
}

# OTP Storage (In-memory dict: {username: {"otp": "123456", "expires": time}})
active_otps = {}
latest_frame_sb = None # Holds the most recent image for Southbound
latest_frame_nb = None # Holds the most recent image for Northbound
occupancy = OccupancyState()
ocr_worker = None

def run_ai_background(video_path, camera_name):
    global live_status, timers, latest_frame_sb, latest_frame_nb

    try:
        camera_state(camera_name, "Starting", frame=True)
        cap = cv2.VideoCapture(video_path)

        if not cap.isOpened():
            camera_state(camera_name, "Disconnected")
            print(f"❌ FATAL ERROR: Could not find or open {camera_name} video at: {video_path}")
            return

        print(f"✅ AI Background Thread for {camera_name} Started Successfully!")

        frame_counter = 0
        while True:
            success, frame = cap.read()
            if not success:
                camera_state(camera_name, "Unstable")
                time.sleep(0.1)
                occupancy.clear(["Bay_1"] if camera_name == "northbound" else ["Bay_6"])
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0) # Sample loop starts a fresh occupancy session
                continue

            camera_state(camera_name, "Live", frame=True)
            frame_counter += 1
            # Skip frames to speed up video playback (YOLO is slow, so we drop frames to keep 1x speed visually)
            if frame_counter % 2 != 0:
                continue

            # 1. RUN THE AI BRAIN
            raw_frame = frame.copy()
            current_data, assignments = analyze_frame(frame, camera_name, include_detections=True, annotate=False)

            # Share session identity and the same loading clock with all displays.
            for bay in current_data:
                detection = assignments.get(bay)
                session = occupancy.update(bay, detection)
                live_status[bay] = "OCCUPIED" if session else "AVAILABLE"
                if bay in timers:
                    timers[bay]["is_active"] = session is not None
                    timers[bay]["start_time"] = (time.time() - (time.monotonic() - session["started"])) if session else None
                if detection and session and session['ocr_eligible'] and ocr_worker:
                    try:
                        ocr_worker.submit(bay, session["id"], raw_frame, detection)
                    except Exception:
                        # Sign cropping/queueing is optional and cannot stop vehicle detection.
                        app.logger.exception("OCR submission failed; detection continues")
                if session and session.get('bbox') and ocr_worker and ocr_worker.state != 'Failed':
                    try:
                        draw_sign_region(frame, session, occupancy.config, held=not session['ocr_eligible'])
                    except Exception:
                        app.logger.exception("OCR region overlay failed; detection continues")

            draw_slots(frame, camera_name, {bay: live_status[bay] for bay in current_data})
            # 3. STORE THE ANNOTATED FRAME FOR THE BROWSER
            ret, buffer = cv2.imencode('.jpg', frame)
            if camera_name == "southbound":
                latest_frame_sb = buffer.tobytes()
            else:
                latest_frame_nb = buffer.tobytes()

    except Exception as e:
        camera_state(camera_name, "Disconnected")
        print(f"\n❌ FATAL ERROR IN AI THREAD ({camera_name}): {str(e)}")
        import traceback
        traceback.print_exc()

# AI workers are started in the main entry point, not when importing API routes.

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

@app.route('/api/system/status')
def get_system_status():
    health = snapshot()
    health["ocr"] = ocr_worker.health() if ocr_worker else {"state": "Disabled", "message": None}
    response = jsonify(health)
    response.headers['Cache-Control'] = 'no-store'
    return response

@app.route('/api/bays')
def get_bays():
    response = jsonify({"bays": occupancy.snapshot(), "generated_at": time.time()})
    response.headers['Cache-Control'] = 'no-store'
    return response

@app.route('/api/ocr/debug')
def get_ocr_debug():
    if os.environ.get("TERMINALSIGHT_OCR_DEBUG") != "1":
        return jsonify(message="OCR debugging is disabled"), 404
    authorization = request.headers.get("Authorization", "")
    try:
        if not authorization.startswith("Bearer "):
            raise BadSignature("Missing token")
        identity = export_tokens.loads(authorization[7:], max_age=8 * 60 * 60)
        with closing(sqlite3.connect(DB_FILE)) as conn:
            user = conn.execute("SELECT password_hash FROM admin_users WHERE username = ?", (identity["username"],)).fetchone()
        if not user or not secrets.compare_digest(hashlib.sha256(user[0].encode()).hexdigest(), identity["credential_version"]):
            raise BadSignature("Credentials changed")
    except BadSignature:
        return jsonify(message="Administrator login required"), 401
    return jsonify(bays=occupancy.snapshot(debug=True), ocr=ocr_worker.health() if ocr_worker else {"state": "Disabled"})

@app.route('/api/status')
def get_status():
    return jsonify({f"Bay_{bay['id']}": bay["status"].upper() for bay in occupancy.snapshot()})

@app.route('/api/export/csv', methods=['GET'])
@app.route('/api/export/occupancy-csv', methods=['GET'])
def export_occupancy_csv():
    """Export vehicle turnaround and occupancy history as a CSV download."""
    authorization = request.headers.get("Authorization", "")
    try:
        if not authorization.startswith("Bearer "):
            raise BadSignature("Missing token")
        identity = export_tokens.loads(authorization[7:], max_age=8 * 60 * 60)
    except BadSignature:
        return jsonify(message="Please sign in again to export logs."), 401

    try:
        with closing(sqlite3.connect(DB_FILE)) as conn:
            user = conn.execute(
                "SELECT password_hash FROM admin_users WHERE username = ?",
                (identity["username"],),
            ).fetchone()
            if not user or not secrets.compare_digest(hashlib.sha256(user[0].encode()).hexdigest(), identity["credential_version"]):
                return jsonify(message="Please sign in again to export logs."), 401
            logs = conn.execute('''
                SELECT o.log_id, o.slot_id, o.vehicle_type_class,
                       o.arrival_timestamp, o.departure_timestamp,
                       o.calculated_duration_minutes, p.slot_number
                FROM Occupancy_Log AS o
                LEFT JOIN Parking_Slot AS p ON p.slot_id = o.slot_id
                ORDER BY o.arrival_timestamp DESC, o.log_id DESC
            ''').fetchall()
    except sqlite3.Error:
        app.logger.exception("Occupancy export failed")
        return jsonify(message="Unable to export occupancy logs. Please try again."), 503

    csv_buffer = io.StringIO(newline="")
    writer = csv.writer(csv_buffer)
    writer.writerow([
        "log_id",
        "slot_id",
        "vehicle_type_class",
        "arrival_timestamp",
        "departure_timestamp",
        "calculated_duration_minutes",
        "slot_number",
    ])
    # Quoting alone does not prevent spreadsheet formula execution.
    def safe_cell(value):
        if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")):
            return "'" + value
        if isinstance(value, str) and value.startswith(("\t", "\r", "\n")):
            return "'" + value
        return value
    writer.writerows([safe_cell(value) for value in row] for row in logs)

    response = Response(csv_buffer.getvalue(), mimetype="text/csv")
    response.headers["Content-Disposition"] = (
        "attachment; filename=occupancy_logs.csv"
    )
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response

# Optional: Consolidated timer endpoint
@app.route('/api/timers')
def get_all_timers():
    return jsonify({f"Bay_{bay['id']}": bay['elapsedSeconds'] for bay in occupancy.snapshot()})

# Legacy single bay routes just in case the UI is explicitly calling them
@app.route('/api/login', methods=['POST', 'OPTIONS'])
def login():
    if request.method == 'OPTIONS':
        return jsonify({'success': True}), 200

    data = request.json
    username = data.get("username")
    password = data.get("password")

    if not username or not password:
        return jsonify({"success": False, "message": "Missing credentials"}), 400

    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("SELECT password_hash, salt, phone_number FROM admin_users WHERE username = ?", (username,))
    user = cursor.fetchone()
    conn.close()

    if not user:
        return jsonify({"success": False, "message": "Invalid username or password"}), 401

    stored_hash, user_salt, phone_number = user

    # Hash the provided password with the user's specific salt and the global pepper
    attempted_hash = hash_password(password, user_salt)

    if attempted_hash == stored_hash:
        return jsonify({
            "success": True,
            "message": "Login successful",
            "export_token": export_tokens.dumps({"username": username, "credential_version": hashlib.sha256(stored_hash.encode()).hexdigest()}),
            "user": {
                "username": username,
                "phone_number": phone_number
            }
        })
    else:
        return jsonify({"success": False, "message": "Invalid username or password"}), 401

@app.route('/api/update_account', methods=['POST', 'OPTIONS'])
def update_account():
    if request.method == 'OPTIONS':
        return jsonify({'success': True}), 200

    data = request.json
    current_username = data.get("current_username")
    old_password = data.get("old_password")
    new_username = data.get("new_username")
    new_password = data.get("new_password")

    if not current_username or not old_password:
        return jsonify({"success": False, "message": "Missing credentials"}), 400

    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("SELECT id, password_hash, salt FROM admin_users WHERE username = ?", (current_username,))
    user = cursor.fetchone()

    if not user:
        conn.close()
        return jsonify({"success": False, "message": "User not found"}), 404

    user_id, stored_hash, user_salt = user
    attempted_hash = hash_password(old_password, user_salt)

    if attempted_hash != stored_hash:
        conn.close()
        return jsonify({"success": False, "message": "Incorrect current password"}), 401

    # Validation logic (Server-side defense)
    if new_password:
        if len(new_password) < 12 or not any(c.islower() for c in new_password) or not any(c.isupper() for c in new_password) or not any(c.isdigit() for c in new_password) or not any(c in "@#$%^&*()_+-=[]{}|;:',.<>/?" for c in new_password):
            conn.close()
            return jsonify({"success": False, "message": "Password does not meet strict criteria"}), 400

    # Update logic
    final_username = new_username if new_username else current_username

    try:
        if new_password:
            # Generate a completely NEW salt when changing password
            new_salt = secrets.token_hex(16)
            new_hash = hash_password(new_password, new_salt)
            cursor.execute("UPDATE admin_users SET username = ?, password_hash = ?, salt = ? WHERE id = ?", (final_username, new_hash, new_salt, user_id))
        else:
            cursor.execute("UPDATE admin_users SET username = ? WHERE id = ?", (final_username, user_id))

        conn.commit()
        conn.close()
        return jsonify({"success": True, "message": "Account updated successfully", "new_username": final_username})
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({"success": False, "message": "Username already taken"}), 400

@app.route('/api/request_otp', methods=['POST', 'OPTIONS'])
def request_otp():
    if request.method == 'OPTIONS':
        return jsonify({'success': True}), 200

    data = request.json
    contact = data.get("contact") # Now explicitly expects email

    if not contact:
        return jsonify({"success": False, "message": "Email address required."}), 400

    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("SELECT username, email FROM admin_users WHERE email = ?", (contact,))
    user = cursor.fetchone()
    conn.close()

    if not user:
        return jsonify({"success": False, "message": "No administrator found with that email address."}), 404

    username, email = user

    # Generate 6-digit OTP
    otp = str(secrets.randbelow(900000) + 100000)

    # Store OTP with a 5-minute expiration
    active_otps[username] = {
        "otp": otp,
        "expires": time.time() + 300
    }

    # Actually send the OTP in a background thread so the API doesn't freeze waiting for the network
    threading.Thread(target=send_email_async, args=(email, otp)).start()

    # For security, you shouldn't return the real OTP to the frontend in production,
    # but we'll leave it in the payload for now so you can still test it before hooking up the Gmail account.
    return jsonify({"success": True, "message": f"OTP sent to email: {email}", "username": username, "demo_otp": otp})

@app.route('/api/reset_password', methods=['POST', 'OPTIONS'])
def reset_password():
    if request.method == 'OPTIONS':
        return jsonify({'success': True}), 200

    data = request.json
    username = data.get("username")
    otp = data.get("otp")
    new_password = data.get("new_password")

    if not username or not otp or not new_password:
        return jsonify({"success": False, "message": "Missing required fields."}), 400

    # Check if OTP exists and is valid
    if username not in active_otps:
        return jsonify({"success": False, "message": "No active OTP request found."}), 400

    otp_data = active_otps[username]
    if time.time() > otp_data["expires"]:
        del active_otps[username]
        return jsonify({"success": False, "message": "OTP has expired."}), 400

    if otp_data["otp"] != otp:
        return jsonify({"success": False, "message": "Invalid OTP code."}), 400

    # Validate strict password criteria
    if len(new_password) < 12 or not any(c.islower() for c in new_password) or not any(c.isupper() for c in new_password) or not any(c.isdigit() for c in new_password) or not any(c in "@#$%^&*()_+-=[]{}|;:',.<>/?" for c in new_password):
        return jsonify({"success": False, "message": "Password does not meet strict criteria."}), 400

    # Reset the password
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    new_salt = secrets.token_hex(16)
    new_hash = hash_password(new_password, new_salt)
    cursor.execute("UPDATE admin_users SET password_hash = ?, salt = ? WHERE username = ?", (new_hash, new_salt, username))
    conn.commit()
    conn.close()

    # Clear the used OTP
    del active_otps[username]

    return jsonify({"success": True, "message": "Password has been securely reset!"})

@app.route('/api/bay6/timer')
def get_timer_6():
    return jsonify(seconds=occupancy.snapshot()[5]['elapsedSeconds'])

@app.route('/api/bay1/timer')
def get_timer_1():
    return jsonify(seconds=occupancy.snapshot()[0]['elapsedSeconds'])

if __name__ == '__main__':
    if os.environ.get("TERMINALSIGHT_DISABLE_AI") != "1":
        import cv2
        from detector import analyze_frame, draw_slots
        ocr_worker = OCRWorker(occupancy)
        ocr_worker.start()
        threading.Thread(target=run_ai_background, args=(r"public\sample-videos\sample-VID_20260604_133427.mp4", "southbound"), daemon=True).start()
        threading.Thread(target=run_ai_background, args=(r"public\sample-videos\sample-VID_20260604_131402.mp4", "northbound"), daemon=True).start()
    print("🚀 TerminalSight API Server Running on http://127.0.0.1:5000")
    app.run(port=5000, debug=False) # Keep debug=False when using threading!
