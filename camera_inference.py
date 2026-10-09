"""One in-flight detection per camera; playback never waits for inference."""
from concurrent.futures import ThreadPoolExecutor


class CameraInference:
    def __init__(self, analyze):
        self.analyze = analyze
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix='camera-inference')
        self.future = None
        self.generation = 0
        self.submitted_generation = 0

    def reset(self):
        self.generation += 1

    def submit(self, frame, camera):
        if self.future is not None:
            return False
        self.submitted_generation = self.generation
        self.future = self.executor.submit(self._run, frame.copy(), camera)
        return True

    def _run(self, frame, camera):
        return frame, self.analyze(frame, camera, include_detections=True, annotate=False)

    def poll(self):
        if self.future is None or not self.future.done():
            return None
        future, self.future = self.future, None
        result = future.result()
        return result if self.submitted_generation == self.generation else None

    def close(self):
        self.executor.shutdown(wait=False, cancel_futures=True)
