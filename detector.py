# detector.py
import cv2
from ultralytics import YOLO
from shapely.geometry import Polygon
import numpy as np
import threading

# Load inference model
model = YOLO("trained_models/yolov8n/best.pt")
ai_lock = threading.Lock()

# Parking slot coordinates
SLOTS_SOUTHBOUND = {
    "Bay_6": [(1457, 825), (821, 882), (565, 678), (898, 651)]
}
SLOTS_NORTHBOUND = {
    "Bay_1": [(1615, 794), (786, 844), (656, 598), (1074, 586)] 
}

# Pre-compute polygons and arrays for performance
slot_polygons_sb = {name: Polygon(coords) for name, coords in SLOTS_SOUTHBOUND.items()}
slot_arrays_sb = {name: np.array(coords, np.int32) for name, coords in SLOTS_SOUTHBOUND.items()}

slot_polygons_nb = {name: Polygon(coords) for name, coords in SLOTS_NORTHBOUND.items()}
slot_arrays_nb = {name: np.array(coords, np.int32) for name, coords in SLOTS_NORTHBOUND.items()}

OCCUPANCY_THRESHOLD = 0.20

def analyze_frame(frame, camera="southbound"):
    # Thread-safe model inference
    with ai_lock:
        results = model(frame, conf=0.5, verbose=False)[0]
    
    # Convert bounding boxes to Shapely polygons
    detected_vehicles = []
    for box in results.boxes.xyxy:
        x_min, y_min, x_max, y_max = int(box[0]), int(box[1]), int(box[2]), int(box[3])
        vehicle_poly = Polygon([(x_min, y_min), (x_max, y_min), (x_max, y_max), (x_min, y_max)])
        detected_vehicles.append(vehicle_poly)

    status_dictionary = {}
    polys = slot_polygons_sb if camera == "southbound" else slot_polygons_nb
    arrays = slot_arrays_sb if camera == "southbound" else slot_arrays_nb

    for slot_name, slot_poly in polys.items():
        is_occupied = False
        
        for vehicle_poly in detected_vehicles:
            # Calculate Intersection over Area (IoA)
            intersection_area = vehicle_poly.intersection(slot_poly).area
            overlap_percentage = intersection_area / slot_poly.area
            
            if overlap_percentage >= OCCUPANCY_THRESHOLD:
                is_occupied = True
                break
        
        # Render bounding boxes
        pts = arrays[slot_name].reshape((-1, 1, 2))
        
        if is_occupied:
            status_dictionary[slot_name] = "OCCUPIED"
            cv2.polylines(frame, [pts], isClosed=True, color=(0, 0, 255), thickness=3)
            cv2.putText(frame, f"{slot_name}: OCCUPIED", (pts[0][0][0], pts[0][0][1] - 10), 
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)
        else:
            status_dictionary[slot_name] = "AVAILABLE"
            cv2.polylines(frame, [pts], isClosed=True, color=(0, 255, 0), thickness=3)
            cv2.putText(frame, f"{slot_name}: AVAILABLE", (pts[0][0][0], pts[0][0][1] - 10), 
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)

    return status_dictionary