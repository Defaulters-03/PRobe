"""
Concurrency check for the PRobe AI service.

Usage (AI service must already be running on port 8000, run this in a SECOND terminal):
    cd ai
    .venv\\Scripts\\python.exe concurrency_test.py        # 10 concurrent requests
    .venv\\Scripts\\python.exe concurrency_test.py 6      # custom number of requests

Reading the result: N parallel requests should take about as long as ONE request.
If the total is close to N x the single time, requests are queueing (a blocking call).
Non-200 statuses (for example 429) mean you are hitting the model's rate limit.
"""
import concurrent.futures
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

URL = os.environ.get("ANALYZE_URL", "http://localhost:8000/analyze")
HEALTH_URL = URL.rsplit("/", 1)[0] + "/health"
TIMEOUT_SECONDS = 60

FALLBACK_SAMPLE = {
    "number": 101,
    "title": "Update README.md",
    "body": "",
    "url": "https://github.com/example/example-repo/pull/101",
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
            "patch": "@@ -12,3 +12,3 @@\n-PRobe is an open-source tool.\n+PRobe is an open-source tool. \n",
        }
    ],
}


def load_sample() -> dict:
    path = Path(__file__).resolve().parent / "samples" / "sample_payload.json"
    if path.exists():
        with open(path, "r", encoding="utf-8") as f:
            samples = json.load(f)
        return samples.get("obvious_spam") or list(samples.values())[0]
    return FALLBACK_SAMPLE


def send_request(payload_bytes: bytes) -> dict:
    """Send one /analyze request. Never raises: errors are returned in the result."""
    req = urllib.request.Request(
        URL,
        data=payload_bytes,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    t0 = time.perf_counter()
    result = {"elapsed": 0.0, "status": None, "label": None, "score": None, "error": None}
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
            result["status"] = resp.status
            data = json.loads(resp.read().decode("utf-8"))
            result["label"] = data.get("label")
            result["score"] = data.get("spam_score")
    except urllib.error.HTTPError as he:
        result["status"] = he.code
        result["error"] = f"HTTP {he.code}"
    except Exception as ex:  # timeouts, connection errors, bad JSON
        result["error"] = str(ex)[:120]
    result["elapsed"] = time.perf_counter() - t0
    return result


def server_is_up() -> bool:
    try:
        with urllib.request.urlopen(HEALTH_URL, timeout=3) as resp:
            return resp.status == 200
    except Exception:
        return False


def describe(r: dict) -> str:
    if r["status"] == 200:
        return f"label={r['label']} score={r['score']}"
    return f"FAILED ({r['error'] or r['status']})"


def main() -> None:
    num_requests = 10
    if len(sys.argv) > 1:
        try:
            num_requests = max(1, int(sys.argv[1]))
        except ValueError:
            print("Usage: python concurrency_test.py [number_of_requests]")
            sys.exit(1)

    print("=" * 70)
    print("PRobe AI service concurrency test")
    print(f"Target: {URL}")
    print("=" * 70)

    if not server_is_up():
        print(f"\nCannot reach {HEALTH_URL}.")
        print("Start the AI service first in another terminal:")
        print("  cd ai")
        print("  .venv\\Scripts\\Activate.ps1")
        print("  python -m uvicorn app.main:app --reload --port 8000")
        sys.exit(1)

    payload_bytes = json.dumps(load_sample()).encode("utf-8")

    print("\nBaseline: one request on its own...")
    single = send_request(payload_bytes)
    print(f"  {single['elapsed']:.2f}s  {describe(single)}")
    if single["status"] != 200:
        print("\nThe baseline request failed, so the concurrency test is not meaningful.")
        sys.exit(1)

    print(f"\nSending {num_requests} requests at the same time...")
    wall_start = time.perf_counter()
    with concurrent.futures.ThreadPoolExecutor(max_workers=num_requests) as pool:
        results = list(pool.map(lambda _: send_request(payload_bytes), range(num_requests)))
    wall = time.perf_counter() - wall_start

    print("-" * 70)
    for i, r in enumerate(results, 1):
        print(f"  Request {i:>2}: {r['elapsed']:6.2f}s  {describe(r)}")
    print("-" * 70)

    ok = sum(1 for r in results if r["status"] == 200)
    failed = num_requests - ok
    avg = sum(r["elapsed"] for r in results) / len(results)
    serial = single["elapsed"] * num_requests

    print("\nSUMMARY")
    print(f"  Single request            : {single['elapsed']:.2f}s")
    print(f"  {num_requests} requests, total wall time : {wall:.2f}s")
    print(f"  Average per request       : {avg:.2f}s")
    print(f"  Serial estimate (queued)  : {serial:.2f}s")
    print(f"  Successful / failed       : {ok} / {failed}")

    if failed:
        print("\n[WARNING] Some requests failed. HTTP 429 means you hit the model's rate limit;")
        print("  lower the number of simultaneous AI calls in the backend or retry later.")

    if num_requests >= 2:
        if wall < serial * 0.5:
            print("\n[PASS] Requests ran in parallel (total time is far below the serial estimate).")
        else:
            print("\n[FAIL] Total time is close to the serial estimate: requests are queueing.")
            print("  Check that the /analyze endpoint is a plain `def` (not async) and calls")
            print("  analyze_pull_request without await.")


if __name__ == "__main__":
    main()