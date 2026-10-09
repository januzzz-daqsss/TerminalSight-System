"""Contain native DirectML failures in a disposable spawned worker."""
import multiprocessing


def _worker(connection, name):
    try:
        from detection_directml import DirectMLAdapter, TorchvisionDirectMLAdapter
        adapter = DirectMLAdapter() if name == 'yolov8' else TorchvisionDirectMLAdapter(name)
        connection.send(('ok', None))
        while True:
            frame = connection.recv()
            if frame is None:
                break
            connection.send(('ok', adapter.predict(frame)))
    except EOFError:
        pass
    except Exception as error:
        try:
            connection.send(('error', str(error)))
        except (OSError, EOFError):
            pass
    finally:
        connection.close()


class ProcessAdapter:
    def __init__(self, name, *, target=_worker, startup_timeout=120):
        context = multiprocessing.get_context('spawn')
        self.connection, child = context.Pipe()
        self.process = context.Process(target=target, args=(child, name), daemon=True)
        self.process.start()
        child.close()
        try:
            self._receive(startup_timeout)
        except Exception:
            self.close()
            raise

    def _receive(self, timeout):
        try:
            if not self.connection.poll(timeout):
                raise RuntimeError('AMD worker timed out.')
            status, result = self.connection.recv()
        except (EOFError, OSError) as error:
            self.process.join(timeout=.2)
            raise RuntimeError(f'AMD worker stopped unexpectedly (exit {self.process.exitcode}).') from error
        if status != 'ok':
            raise RuntimeError(f'AMD worker failed: {result}')
        return result

    def predict(self, frame):
        try:
            if not self.process.is_alive():
                raise RuntimeError(f'AMD worker exited ({self.process.exitcode}).')
            self.connection.send(frame)
            return self._receive(30)
        except (OSError, EOFError) as error:
            raise RuntimeError('AMD worker connection failed.') from error

    def close(self):
        # Do not depend on a potentially hung native runtime to service a message.
        if self.process.is_alive():
            self.process.terminate()
        self.process.join(timeout=5)
        if self.process.is_alive():
            self.process.kill()
            self.process.join(timeout=5)
        self.connection.close()
