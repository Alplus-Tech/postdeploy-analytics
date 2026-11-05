import json, sqlite3, sys, time, pathlib, resource

# Read-only query worker: no database or temporary-file writes.
resource.setrlimit(resource.RLIMIT_AS, (512 * 1024**2, 512 * 1024**2))
db = sqlite3.connect(pathlib.Path(sys.argv[1]).resolve().as_uri() + '?mode=ro', uri=True)
db.row_factory = sqlite3.Row
db.execute('PRAGMA query_only=ON')
db.execute('PRAGMA temp_store=MEMORY')
db.execute('PRAGMA cache_size=-8192')
for line in sys.stdin:
    request = json.loads(line)
    start = time.monotonic()
    db.set_progress_handler(lambda: time.monotonic() - start > 25, 10000)
    try:
        query, params = request['query'], request['params']
        plan = [dict(r) for r in db.execute('EXPLAIN QUERY PLAN ' + query, params)]
        rows = db.execute(query, params).fetchmany(10001)
        if len(rows) > 10000:
            raise ValueError('Aggregate output exceeds 10000 rows')
        result = {'rows': [dict(r) for r in rows], 'plan': plan}
    except Exception as error:
        result = {'error': str(error)}
    result['ms'] = round((time.monotonic() - start) * 1000, 2)
    print(json.dumps(result), flush=True)
