"""Observed visits in the existing SQLite schema; no synthetic loop departures."""
from contextlib import closing
from datetime import datetime, timezone
import sqlite3
import time


class OccupancyHistory:
    def __init__(self, database):
        self.database = database
        # Serialized by OccupancyState.lock. Old rows stay incomplete on restart.
        self.active = {}

    def __call__(self, event, bay, session, now):
        key = session['id']
        if event == 'interrupted':
            self.active.pop(key, None)
            return
        timestamp = datetime.fromtimestamp(time.time() - max(0, time.monotonic() - now), timezone.utc).isoformat()
        with closing(sqlite3.connect(self.database, timeout=.2)) as conn, conn:
            if event == 'arrival':
                row = conn.execute('INSERT INTO Occupancy_Log (slot_id, vehicle_type_class, arrival_timestamp) VALUES (?, ?, ?)',
                                   (bay, session['vehicle_type'], timestamp))
                conn.commit()
                self.active[key] = row.lastrowid
            elif event == 'departure' and key in self.active:
                conn.execute('UPDATE Occupancy_Log SET departure_timestamp=?, calculated_duration_minutes=? WHERE log_id=? AND departure_timestamp IS NULL',
                             (timestamp, max(0, now - session['started']) / 60, self.active[key]))
                conn.commit()
                self.active.pop(key, None)
