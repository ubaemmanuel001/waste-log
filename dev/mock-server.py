#!/usr/bin/env python3
"""Mock of the Google Apps Script backend (same protocol) for local testing.
Usage: python3 dev/mock-server.py  →  http://localhost:8764/exec
Seeded admin: admin@logbook.test / password123
"""
import json, hashlib, uuid, os, datetime
from http.server import BaseHTTPRequestHandler, HTTPServer

DB = os.path.join(os.path.dirname(__file__), 'mock-db.json')
SHEETS = {
    'Entries': ['id','date','facilityId','boxKg','wasteKg','rate','amount','receivedBy','status','note','createdAt'],
    'Facilities': ['id','name','category','createdAt'],
    'Settings': ['key','value'],
    'Users': ['email','name','role','passHash','salt','createdAt'],
    'Tokens': ['token','email','expiresAt'],
}

def load():
    if not os.path.exists(DB):
        salt = uuid.uuid4().hex
        admin = dict(email='admin@logbook.test', name='Owner', role='admin', salt=salt,
                     passHash=hashlib.sha256(f'{salt}:password123'.encode()).hexdigest(),
                     createdAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
        json.dump({n: [] for n in SHEETS} | {'Users': [admin]}, open(DB, 'w'))
    return json.load(open(DB))

def save(db):
    json.dump(db, open(DB, 'w'), indent=1)

def norm_entry(e):
    return dict(id=str(e.get('id','')), date=str(e.get('date',''))[:10], facilityId=str(e.get('facilityId','')),
                boxKg=float(e.get('boxKg') or 0), wasteKg=float(e.get('wasteKg') or 0),
                rate=float(e.get('rate') or 0), amount=float(e.get('amount') or 0),
                receivedBy=str(e.get('receivedBy') or ''), status=str(e.get('status') or 'Paid'),
                note=str(e.get('note') or ''),
                createdAt=e.get('createdAt') or datetime.datetime.now(datetime.timezone.utc).isoformat())

def norm_fac(f):
    return dict(id=str(f.get('id','')), name=str(f.get('name','')), category=str(f.get('category','')),
                createdAt=f.get('createdAt') or datetime.datetime.now(datetime.timezone.utc).isoformat())

def all_data(db):
    try: settings = json.loads(db['Settings'][0]['value']) if db['Settings'] else {}
    except Exception: settings = {}
    return dict(entries=[norm_entry(e) for e in db['Entries']],
                facilities=[norm_fac(f) for f in db['Facilities']], settings=settings)

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _json(self, obj):
        body = json.dumps(obj).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def do_GET(self):
        self._json({'ok': True, 'app': 'mock backend running'})
    def do_POST(self):
        req = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}')
        db = load()
        act = req.get('action')
        try:
            if act == 'login':
                email = str(req.get('email','')).strip().lower()
                u = next((u for u in db['Users'] if u['email'].lower() == email), None)
                if not u or hashlib.sha256(f"{u['salt']}:{req.get('password','')}".encode()).hexdigest() != u['passHash']:
                    return self._json({'ok': False, 'error': 'Wrong email or password'})
                token = uuid.uuid4().hex + uuid.uuid4().hex[:8]
                db['Tokens'].append(dict(token=token, email=email,
                                         expiresAt=(datetime.datetime.now(datetime.timezone.utc)
                                                    + datetime.timedelta(days=30)).isoformat()))
                save(db)
                return self._json({'ok': True, 'token': token, 'email': email, 'name': u['name'], 'role': u['role']})
            # everything else requires a valid token
            t = next((t for t in db['Tokens'] if t['token'] == req.get('token')), None)
            if not t or datetime.datetime.fromisoformat(t['expiresAt']) < datetime.datetime.now(datetime.timezone.utc):
                return self._json({'ok': False, 'error': 'AUTH'})
            user = next(u for u in db['Users'] if u['email'].lower() == t['email'].lower())
            if act == 'getData':
                return self._json({'ok': True, 'data': all_data(db)})
            if act == 'mutate':
                for op in req.get('ops', []):
                    typ = op.get('type')
                    if typ == 'entry_upsert':
                        e = norm_entry(op['entry'])
                        db['Entries'] = [x for x in db['Entries'] if x['id'] != e['id']] + [e]
                    elif typ == 'entry_delete':
                        db['Entries'] = [x for x in db['Entries'] if x['id'] != op.get('id')]
                    elif typ == 'facility_upsert':
                        f = norm_fac(op['facility'])
                        db['Facilities'] = [x for x in db['Facilities'] if x['id'] != f['id']] + [f]
                    elif typ == 'facility_delete':
                        db['Facilities'] = [x for x in db['Facilities'] if x['id'] != op.get('id')]
                    elif typ == 'settings_save':
                        db['Settings'] = [dict(key='settings', value=json.dumps(op.get('settings') or {}))]
                    elif typ == 'replace_all':
                        db['Entries'] = [norm_entry(e) for e in op.get('entries', [])]
                        db['Facilities'] = [norm_fac(f) for f in op.get('facilities', [])]
                        if op.get('settings') is not None:
                            db['Settings'] = [dict(key='settings', value=json.dumps(op['settings']))]
                save(db)
                return self._json({'ok': True})
            if act in ('listUsers', 'addUser', 'deleteUser'):
                if user['role'] != 'admin':
                    return self._json({'ok': False, 'error': 'Only administrators can do that'})
                if act == 'listUsers':
                    return self._json({'ok': True, 'users': [{k: u[k] for k in ('email','name','role','createdAt')} for u in db['Users']]})
                if act == 'addUser':
                    email = str(req.get('email','')).strip().lower()
                    if req.get('role') == 'admin' or '@' not in email or len(req.get('password','')) < 6:
                        return self._json({'ok': False, 'error': 'Invalid details'})
                    if any(u['email'].lower() == email for u in db['Users']):
                        return self._json({'ok': False, 'error': 'A user with that email already exists'})
                    salt = uuid.uuid4().hex
                    db['Users'].append(dict(email=email, name=str(req.get('name','')), role='staff', salt=salt,
                                            passHash=hashlib.sha256(f'{salt}:{req["password"]}'.encode()).hexdigest(),
                                            createdAt=datetime.datetime.now(datetime.timezone.utc).isoformat()))
                    save(db)
                    return self._json({'ok': True})
                if act == 'deleteUser':
                    email = str(req.get('email','')).lower()
                    if email == user['email'].lower():
                        return self._json({'ok': False, 'error': 'You cannot remove your own access'})
                    db['Users'] = [u for u in db['Users'] if u['email'].lower() != email]
                    db['Tokens'] = [t2 for t2 in db['Tokens'] if t2['email'].lower() != email]
                    save(db)
                    return self._json({'ok': True})
            return self._json({'ok': False, 'error': 'Unknown action'})
        except Exception as err:
            return self._json({'ok': False, 'error': str(err)})

HTTPServer(('127.0.0.1', 8764), H).serve_forever()
