# Sample-video detection

Both original MP4 files remain in `public/sample-videos/`. Active AI mode loops them
through the existing trained YOLO model and Shapely parking polygons. The current
polygons monitor Bay 1 (Northbound) and Bay 6 (Southbound).

From the project folder in PowerShell, start the backend with:

```powershell
$env:TERMINALSIGHT_DISABLE_AI = '0'
$env:PYTHONIOENCODING = 'utf-8'
$env:YOLO_CONFIG_DIR = "$PWD"
.venv\Scripts\python app.py
```

Run `npm.cmd run dev` in another terminal, then open Camera Zones.
Stop an already running backend before launching another instance on port 5000.

If API-only mode is intentionally enabled (`TERMINALSIGHT_DISABLE_AI=1`), Camera
Zones plays the preserved sample videos directly with a **Detection off** label.
Active processing uses the annotated backend stream labeled **Sample video / AI**.
Videos are not deleted or replaced. They remain excluded from Git because of size.
