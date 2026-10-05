import json
import os
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

# Load sample payload
samples_path = Path(__file__).parent / "samples" / "sample_payload.json"
if samples_path.exists():
    with open(samples_path, "r", encoding="utf-8") as f:
        samples = json.load(f)
    sample_request = samples.get("obvious_spam", list(samples.values())[0])
else:
    sample_request = {
        "number": 101,
        "title": "Update README.md",
        "body": "",
        "url": "https://github.com/prsift/example-repo/pull/101",
        "created_at": "2026-10-04T12:00:00Z",
        "author": {
            "login": "spammy-hacktober-bot",
            "account_created_at": "2026-10-03T08:00:00Z",
            "public_repos": 1,
            "followers": 0,
        },
        "stats": {"changed_files": 1, "additions": 1, "deletions": 1},
        "files": [
            {
                "filename": "README.md",
                "status": "modified",
                "additions": 1,
                "deletions": 1,
                "patch": "@@ -12,3 +12,3 @@\n-PRSift is an open-source tool.\n+PRSift is an open-source tool. \n",
            }
        ],
    }

URL = os.environ.get("ANALYZE_URL", "http://localhost:8000/analyze")
NUM_REQUESTS = 6
results_lock = threading.Lock()
request_results = []


def send_worker(request_id: int, payload_bytes: bytes) -> None:
    req = urllib.request.Request(
        URL,
        data=payload_bytes,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    start_time = time.time()
    status_code = None
    error_msg = None
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            status_code = resp.status
            _ = resp.read()
    except urllib.error.HTTPError as he:
        status_code = he.code
        error_msg = f"HTTP {he.code}"
    except Exception as ex:
        error_msg = str(ex)

    elapsed_seconds = time.time() - start_time
    with results_lock:
        request_results.append((request_id, elapsed_seconds, status_code, error_msg))

    status_info = f"status={status_code}" if status_code else f"error={error_msg}"
    print(f"Request {request_id}: {elapsed_seconds:.2f}s ({status_info})")


def main() -> None:
    payload_bytes = json.dumps(sample_request).encode("utf-8")
    print(f"Launching {NUM_REQUESTS} concurrent requests to {URL}...")

    threads = []
    wall_start = time.time()

    for i in range(1, NUM_REQUESTS + 1):
        t = threading.Thread(target=send_worker, args=(i, payload_bytes))
        threads.append(t)
        t.start()

    for t in threads:
        t.join()

    total_wall_time = time.time() - wall_start
    print("-" * 50)
    print(f"All {NUM_REQUESTS} requests completed.")
    for req_id, sec, code, err in sorted(request_results, key=lambda x: x[0]):
        status_str = f"HTTP {code}" if code else f"Error: {err}"
        print(f"  - Request {req_id}: {sec:.2f}s [{status_str}]")
    print(f"Total wall time: {total_wall_time:.2f}s")


if __name__ == "__main__":
    main()
