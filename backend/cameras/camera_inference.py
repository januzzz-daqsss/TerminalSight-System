"""One in-flight detection per camera; playback never waits for inference."""
from concurrent.futures import ThreadPoolExecutor, Future
from collections import deque
import threading


class FairInferenceExecutor:
    """One shared consumer, bounded FIFO, canceled jobs release their frame buffers."""
    def __init__(self, capacity=10):
        self.capacity = capacity
        self.pending = deque()
        self.condition = threading.Condition()
        self.closed = False
        self.thread = None

    def submit(self, fn, *args):
        with self.condition:
            self.pending = deque(job for job in self.pending if not job[0].cancelled())
            if self.closed or len(self.pending) >= self.capacity:
                raise RuntimeError('Operational inference queue is unavailable or full.')
            future = Future()
            self.pending.append((future, fn, args))
            if self.thread is None:
                self.thread = threading.Thread(target=self._run, name='operational-inference', daemon=True)
                self.thread.start()
            self.condition.notify()
            return future

    def _run(self):
        while True:
            with self.condition:
                self.condition.wait_for(lambda: self.pending or self.closed)
                if not self.pending:
                    return
                future, fn, args = self.pending.popleft()
            if future.set_running_or_notify_cancel():
                try:
                    future.set_result(fn(*args))
                except BaseException as error:
                    future.set_exception(error)
            # Do not retain the last source frame while idle.
            del args, fn, future

    def shutdown(self, wait=False, cancel_futures=True):
        with self.condition:
            self.closed = True
            if cancel_futures:
                for future, _, _ in self.pending:
                    future.cancel()
                self.pending.clear()
            self.condition.notify_all()
        if wait and self.thread:
            self.thread.join()


class CameraInference:
    def __init__(self, analyze, executor=None):
        self.analyze = analyze
        self.owns_executor = executor is None
        self.executor = executor or ThreadPoolExecutor(max_workers=1, thread_name_prefix='camera-inference')
        self.future = None
        self.generation = 0
        self.submitted_generation = 0

    def reset(self):
        self.generation += 1

    def submit(self, frame, camera, roi=None):
        if self.future is not None:
            return False

        self.submitted_generation = self.generation
        self.future = self.executor.submit(
            self._run,
            frame.copy(),
            camera,
            roi
        )
        return True

    def _run(self, frame, camera, roi=None):
        if roi is None:
            result = self.analyze(
                frame,
                camera,
                include_detections=True,
                annotate=False
            )
        else:
            result = self.analyze(
                frame,
                camera,
                include_detections=True,
                annotate=False,
                roi=roi
            )

        return frame, result

    def poll(self):
        if self.future is None or not self.future.done():
            return None
        future, self.future = self.future, None
        result = future.result()
        return result if self.submitted_generation == self.generation else None

    def close(self):
        self.reset()
        if self.future is not None:
            self.future.cancel()
        if self.owns_executor:
            self.executor.shutdown(wait=False, cancel_futures=True)
