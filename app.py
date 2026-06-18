# app.py
import cv2
import time
import threading
from flask import Flask, jsonify, Response, request
from flask_cors import CORS
from detector import analyze_frame # IMPORTING YOUR AI BRAIN
import sqlite3
import os
import hashlib
import secrets
import smtplib
from email.mime.text import MIMEText
import threading

app = Flask(__name__)
CORS(app) 

# --- SECURITY & DATABASE CONFIGURATION ---
DB_FILE = "terminalsight.db"
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
# For Email: Replace with your actual Gmail account and App Password
SMTP_SENDER_EMAIL = "janustheq@gmail.com"
SMTP_APP_PASSWORD = "riyt tskb wazx ckbu" # Generate this from Google Account Settings -> Security -> App Passwords

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
    print("🚀 TerminalSight API Server Running on http://127.0.0.1:5000")
    app.run(port=5000, debug=False) # Keep debug=False when using threading!