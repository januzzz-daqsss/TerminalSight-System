from ultralytics import YOLO

# 1. Load your winning Capstone model
model = YOLO("best.pt")

# 2. Export the model to ONNX format
# Using opset=12 or 13 ensures maximum compatibility with older AMD drivers
print("Exporting to ONNX...")
success = model.export(format="onnx", opset=12, simplify=True)

print(f"✅ Export complete! File saved to: {success}")