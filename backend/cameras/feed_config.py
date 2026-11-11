"""Local feed configuration only. Never opens cameras or changes detector state."""
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import cv2
from urllib.parse import urlsplit, quote
from uuid import uuid4

from flask import Blueprint, jsonify, request
from backend.cameras.roi_catalog import compatible_mappings, describe_feed, mapping, validate_labels

VIDEO_EXTENSIONS = {'.mp4', '.webm', '.ogg', '.m4v', '.mov', '.avi', '.mkv'}


def video_catalog(public_root):
    root = Path(public_root).resolve()
    videos = []
    for directory in ('sample-CCTV', 'sample-videos'):
        folder = root / directory
        if not folder.is_dir() or folder.is_symlink():
            continue
        for path in sorted(folder.rglob('*')):
            # Do not follow recordings linked outside the allowed sample directory.
            if not path.is_file() or not path.resolve().is_relative_to(folder.resolve()):
                continue
            if path.suffix.lower() not in VIDEO_EXTENSIONS:
                continue
            relative = path.relative_to(root).as_posix()
            videos.append({'id': relative, 'filename': path.name, 'directory': directory,
                           'url': '/' + quote(relative, safe='/'),
                           'preview': path.suffix.lower() in {'.mp4', '.webm', '.ogg', '.m4v'}})
    return videos


def validate_feed(data, catalog):
    if not isinstance(data, dict):
        raise ValueError('Provide a feed configuration.')
    allowed = {'kind', 'name', 'direction', 'bays', 'address', 'transport', 'videoId', 'roiId'}
    if set(data) - allowed:
        raise ValueError('Unsupported fields. Camera credentials are not accepted.')
    kind, name, direction = data.get('kind'), data.get('name'), data.get('direction')
    if not isinstance(kind, str) or not isinstance(direction, str) or kind not in {'live', 'sample'} or direction not in {'northbound', 'southbound'}:
        raise ValueError('Choose a feed mode and terminal direction.')
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 80 or any(ord(c) < 32 for c in name):
        raise ValueError('Enter a feed name of 1–80 characters.')
    bays = data.get('bays')
    valid_bays = range(1, 6) if direction == 'northbound' else range(6, 11)
    if not isinstance(bays, list) or not bays or any(type(b) is not int or b not in valid_bays for b in bays):
        raise ValueError('Select bays belonging to the chosen terminal direction.')
    result = dict(kind=kind, name=name.strip(), direction=direction, bays=sorted(set(bays)),
                  address='', transport='tcp', videoId='')
    if kind == 'sample':
        if data.get('address') or data.get('transport') not in (None, '', 'tcp'):
            raise ValueError('Sample feeds cannot contain live connection details.')
        video_id = data.get('videoId')
        if not isinstance(video_id, str) or video_id not in {v['id'] for v in catalog}:
            raise ValueError('Choose an existing supported sample video.')
        result['videoId'] = video_id
        if 'roiId' in data:
            if not isinstance(data['roiId'], str):
                raise ValueError('Choose a mapping or no mapping.')
            result['roiId'] = data['roiId']
    else:
        if 'roiId' in data:
            raise ValueError('ROI selection is for sample recordings only.')
        address = data.get('address')
        if not isinstance(address, str) or not address.strip() or len(address) > 512:
            raise ValueError('Enter an IP/host address or credential-free RTSP URL.')
        address = address.strip()
        if '://' not in address:
            address = 'rtsp://' + address
        try:
            parts = urlsplit(address)
            port = parts.port
            if (parts.scheme not in {'rtsp', 'rtsps'} or not parts.hostname or parts.username is not None
                    or parts.password is not None or parts.query or parts.fragment or '%' in address
                    or '\\' in address or any(c.isspace() or ord(c) < 32 for c in address)
                    or (port is not None and port == 0)):
                raise ValueError()
        except ValueError:
            raise ValueError('Use a credential-free RTSP address without user info, query strings or fragments.') from None
        if data.get('transport') not in ('tcp', 'udp') or data.get('videoId'):
            raise ValueError('Choose TCP or UDP; live feeds cannot contain sample videos.')
        result.update(address=address, transport=data['transport'])
    return result


def create_feed_blueprint(authorize, database_path, public_root):
    bp = Blueprint('camera_feed_config', __name__)

    @bp.before_request
    def protect():
        return authorize()

    @bp.after_request
    def private_response(response):
        response.headers['Cache-Control'] = 'no-store'
        return response

    def connect():
        path = Path(database_path())
        path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(path, timeout=5)
        conn.execute('CREATE TABLE IF NOT EXISTS feeds (id TEXT PRIMARY KEY, configuration TEXT NOT NULL)')
        conn.execute('CREATE TABLE IF NOT EXISTS legacy_display (id INTEGER PRIMARY KEY, configuration TEXT NOT NULL)')
        return conn

    @bp.patch('/api/camera-feeds/display/<int:camera_id>')
    def legacy_display(camera_id):
        # Presentation only: never import or call a camera/occupancy worker here.
        if camera_id not in (1, 2):
            return jsonify(message='Unknown display card.'), 404
        if request.content_length is None or request.content_length > 2048:
            return jsonify(message='Display settings are too large.'), 413
        data = request.get_json(silent=True)
        try:
            if not isinstance(data, dict) or set(data) != {'name', 'direction', 'bays', 'hidden'} or type(data['hidden']) is not bool:
                raise ValueError('Provide only display name, direction, bays and visibility.')
            validated = validate_feed(dict(kind='sample', name=data['name'], direction=data['direction'],
                bays=data['bays'], videoId='display-only'), [{'id': 'display-only'}])
            settings = {key: validated[key] for key in ('name', 'direction', 'bays')}
            settings['hidden'] = data['hidden']
            with closing(connect()) as conn, conn:
                conn.execute('INSERT OR REPLACE INTO legacy_display VALUES (?, ?)', (camera_id, json.dumps(settings)))
            return jsonify(display={'id': camera_id, **settings})
        except ValueError as error:
            return jsonify(message=str(error)), 400
        except (sqlite3.Error, OSError):
            return jsonify(message='Display settings could not be saved.'), 503

    @bp.route('/api/camera-feeds/videos')
    def videos():
        try:
            return jsonify(videos=video_catalog(public_root()))
        except OSError:
            return jsonify(message='Sample directories are unavailable.'), 503

    @bp.get('/api/camera-feeds/roi')
    def roi_options():
        video_id = request.args.get('videoId')
        if video_id not in {v['id'] for v in video_catalog(public_root())}:
            return jsonify(message='Choose an existing supported sample video.'), 400
        try:
            options, rejected = compatible_mappings(Path(public_root()).parent, video_id)
            return jsonify(mappings=options, excluded=rejected)
        except OSError:
            return jsonify(message='Local ROI mappings are unavailable.'), 503

    def describe(data):
        return describe_feed(Path(public_root()).parent, data)

    @bp.route('/api/camera-feeds', methods=['GET', 'POST'])
    @bp.route('/api/camera-feeds/<feed_id>', methods=['PATCH', 'DELETE'])
    def feeds(feed_id=None):
        try:
            if request.method in {'POST', 'PATCH'}:
                if request.content_length is None or request.content_length > 16384:
                    return jsonify(message='Feed configuration is too large.'), 413
                data = validate_feed(request.get_json(silent=True), video_catalog(public_root()))
                if data.get('roiId'):
                    validate_labels(data, mapping(Path(public_root()).parent, data['videoId'], data['roiId']))
            with closing(connect()) as conn, conn:
                if request.method == 'GET':
                    return jsonify(feeds=[describe({'id': row[0], **json.loads(row[1])})
                                          for row in conn.execute('SELECT id, configuration FROM feeds ORDER BY rowid')],
                                   legacyDisplays=[{'id': row[0], **json.loads(row[1])}
                                          for row in conn.execute('SELECT id, configuration FROM legacy_display ORDER BY id')])
                if feed_id:
                    existing = conn.execute('SELECT configuration FROM feeds WHERE id = ?', (feed_id,)).fetchone()
                    if not existing:
                        return jsonify(message='Feed no longer exists. Refresh the list.'), 404
                    if request.method == 'DELETE':
                        conn.execute('DELETE FROM feeds WHERE id = ?', (feed_id,))
                        return jsonify(success=True)
                    if json.loads(existing[0])['kind'] != data['kind']:
                        raise ValueError('A feed cannot change modes. Add a separate configuration instead.')
                    conn.execute('UPDATE feeds SET configuration = ? WHERE id = ?', (json.dumps(data), feed_id))
                else:
                    if conn.execute('SELECT COUNT(*) FROM feeds').fetchone()[0] >= 100:
                        return jsonify(message='A maximum of 100 feed configurations is supported.'), 409
                    feed_id = uuid4().hex
                    conn.execute('INSERT INTO feeds VALUES (?, ?)', (feed_id, json.dumps(data)))
                return jsonify(feed=describe({'id': feed_id, **data})), 201 if request.method == 'POST' else 200
        except ValueError as error:
            return jsonify(message=str(error)), 400
        except (sqlite3.Error, OSError):
            return jsonify(message='Local feed configuration is unavailable. Check local storage access.'), 503
        except (TypeError, KeyError, cv2.error):
            return jsonify(message='ROI mapping could not be validated. Check the JSON and recording.'), 400

    return bp
