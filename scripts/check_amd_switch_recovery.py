"""Manual hardware regression: switch AMD models under camera-like load."""
import sys
from pathlib import Path
import tempfile
import threading
import time
import cv2
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from detection_runtime import DetectionRuntime


def main():
    frames=[]
    for filename in ['sample-VID_20260604_131402.mp4','sample-VID_20260604_133427.mp4']:
        cap=cv2.VideoCapture(str(ROOT/'public/sample-videos'/filename))
        ok,frame=cap.read();cap.release()
        if not ok: raise RuntimeError('Missing sample video')
        frames.append(frame)
    with tempfile.TemporaryDirectory() as folder:
        runtime=DetectionRuntime(Path(folder)/'settings.json')
        stop=threading.Event();errors=[];counts=[0,0]
        def camera(index):
            while not stop.is_set():
                try:
                    runtime.predict(frames[index]);counts[index]+=1
                except Exception as error:
                    errors.append(str(error));break
                stop.wait(.1)
        threads=[]
        try:
            runtime.switch('ssd300_vgg16','amd')
            for index in range(2):
                thread=threading.Thread(target=camera,args=(index,));thread.start();threads.append(thread)
            time.sleep(1)
            for name in ['fasterrcnn_resnet50_fpn','ssd300_vgg16','fasterrcnn_resnet50_fpn']:
                runtime.switch(name,'amd')
                print('Switched:',runtime.model,runtime.device,flush=True)
                time.sleep(1)
            assert runtime.device=='amd'
            # Terminate only our private test worker, never the user's server.
            with runtime.lock:
                runtime.adapter.directml.process.terminate()
                runtime.adapter.directml.process.join(5)
                recovered=runtime.predict(frames[0])
            assert runtime.device=='cpu' and recovered
            print('Worker crash recovered on CPU:',recovered,flush=True)
        finally:
            stop.set()
            for thread in threads:thread.join(30)
            if runtime.adapter is not None:runtime.adapter.close()
        assert not errors, errors
        assert min(counts)>0,counts
        print('Switch/recovery check passed; camera inference counts:',counts,flush=True)

if __name__=='__main__':
    main()
