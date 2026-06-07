import cv2
import threading
from ultralytics import YOLO
from shapely.geometry import Polygon
import numpy as np

# 1. LOAD YOUR MODEL
model = YOLO("best.pt")

# 2. DEFINE YOUR PARKING SLOTS
SLOTS_SOUTHBOUND = {
    "Bay_6": [(1457, 825), (821, 882), (565, 678), (898, 651)]
}
SLOTS_NORTHBOUND = {
    "Bay_1": [(1615, 794), (786, 844), (656, 598), (1074, 586)] 
}

# 3. GLOBAL SETUP (Run once for performance)
slot_polygons_sb = {name: Polygon(coords) for name, coords in SLOTS_SOUTHBOUND.items()}
slot_arrays_sb = {name: np.array(coords, np.int32) for name, coords in SLOTS_SOUTHBOUND.items()}

slot_polygons_nb = {name: Polygon(coords) for name, coords in SLOTS_NORTHBOUND.items()}
slot_arrays_nb = {name: np.array(coords, np.int32) for name, coords in SLOTS_NORTHBOUND.items()}

OCCUPANCY_THRESHOLD = 0.20

# Thread lock to prevent PyTorch from deadlocking when 2 threads call it simultaneously
ai_lock = threading.Lock()

def analyze_frame(frame, camera="southbound"):
    """
    Takes a raw video frame, runs YOLOv8, calculates IoA, draws the UI, 
    and returns the live status dictionary.
    """
    # Run YOLOv8 AI safely across threads
    with ai_lock:
        results = model(frame, conf=0.5, verbose=False)[0]
    
    # Extract AI Bounding Boxes into Shapely Polygons
    detected_vehicles = []
    for box in results.boxes.xyxy:
        x_min, y_min, x_max, y_max = int(box[0]), int(box[1]), int(box[2]), int(box[3])
        vehicle_poly = Polygon([(x_min, y_min), (x_max, y_min), (x_max, y_max), (x_min, y_max)])
        detected_vehicles.append(vehicle_poly)

    # Dictionary to hold the results for this specific frame
    status_dictionary = {}

    # INTERSECTION OVER AREA (IoA) MATH
    polys = slot_polygons_sb if camera == "southbound" else slot_polygons_nb
    arrays = slot_arrays_sb if camera == "southbound" else slot_arrays_nb

    for slot_name, slot_poly in polys.items():
        is_occupied = False
        
        for vehicle_poly in detected_vehicles:
            # Calculate how much the vehicle overlaps the slot
            intersection_area = vehicle_poly.intersection(slot_poly).area
            overlap_percentage = intersection_area / slot_poly.area
            
            if overlap_percentage >= OCCUPANCY_THRESHOLD:
                is_occupied = True
                break # Stop checking other vehicles for this slot
        
        # DRAW THE RESULTS ON THE SCREEN
        pts = arrays[slot_name].reshape((-1, 1, 2))
        
        if is_occupied:
            status_dictionary[slot_name] = "OCCUPIED"
            # Draw RED for Occupied
            cv2.polylines(frame, [pts], isClosed=True, color=(0, 0, 255), thickness=3)
            cv2.putText(frame, f"{slot_name}: OCCUPIED", (pts[0][0][0], pts[0][0][1] - 10), 
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)
        else:
            status_dictionary[slot_name] = "AVAILABLE"
            # Draw GREEN for Available
            cv2.polylines(frame, [pts], isClosed=True, color=(0, 255, 0), thickness=3)
            cv2.putText(frame, f"{slot_name}: AVAILABLE", (pts[0][0][0], pts[0][0][1] - 10), 
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)

    # Return the data so app.py can send it to the React dashboard
    return status_dictionary