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

def analyze_frame(frame, camera="southbound", include_detections=False, annotate=True):
    # Thread-safe model inference
    with ai_lock:
        results = model(frame, conf=0.5, verbose=False)[0]
    
    # Convert bounding boxes to Shapely polygons
    detected_vehicles = []
    for box in results.boxes:
        x_min, y_min, x_max, y_max = map(int, box.xyxy[0].tolist())
        class_name = str(model.names[int(box.cls.item())]).lower()
        if class_name not in ("bus", "uv"):
            continue
        vehicle_poly = Polygon([(x_min, y_min), (x_max, y_min), (x_max, y_max), (x_min, y_max)])
        detected_vehicles.append({"polygon": vehicle_poly, "bbox": [x_min, y_min, x_max, y_max],
                                  "vehicle_type": "Bus" if class_name == "bus" else "UV Express"})

    status_dictionary = {}
    assignments = {}
    used_vehicles = set()
    polys = slot_polygons_sb if camera == "southbound" else slot_polygons_nb

    for slot_name, slot_poly in polys.items():
        is_occupied = False
        
        best_overlap = 0
        best_index = None
        for index, vehicle in enumerate(detected_vehicles):
            if index in used_vehicles:
                continue
            vehicle_poly = vehicle["polygon"]
            # Calculate Intersection over Area (IoA)
            intersection_area = vehicle_poly.intersection(slot_poly).area
            overlap_percentage = intersection_area / slot_poly.area
            
            if overlap_percentage >= OCCUPANCY_THRESHOLD and overlap_percentage > best_overlap:
                best_overlap, best_index = overlap_percentage, index
        if best_index is not None:
            is_occupied = True
            used_vehicles.add(best_index)
            assignments[slot_name] = {key: value for key, value in detected_vehicles[best_index].items() if key != "polygon"}
        
        status_dictionary[slot_name] = "OCCUPIED" if is_occupied else "AVAILABLE"

    if annotate:
        draw_slots(frame, camera, status_dictionary)
    return (status_dictionary, assignments) if include_detections else status_dictionary


def draw_slots(frame, camera, statuses):
    """Render confirmed occupancy so video overlays and public displays agree."""
    arrays = slot_arrays_sb if camera == "southbound" else slot_arrays_nb
    for name, points in arrays.items():
        status = statuses.get(name, "AVAILABLE")
        color = (0, 255, 0) if status == "AVAILABLE" else (0, 0, 255)
        pts = points.reshape((-1, 1, 2))
        cv2.polylines(frame, [pts], isClosed=True, color=color, thickness=3)
        cv2.putText(frame, f"{name}: {status}", (pts[0][0][0], pts[0][0][1] - 10),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)
