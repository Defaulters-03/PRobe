import concurrent.futures
import json
import os
import socket
import sys
import threading
import time
import urllib.request
from pathlib import Path
from dotenv import load_dotenv

ai_root = Path(__file__).resolve().parent
if str(ai_root) not in sys.path:
    sys.path.insert(0, str(ai_root))

load_dotenv(dotenv_path=ai_root / ".env")


def is_port_in_use(port: int, host: str = "127.0.0.1") -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex((host, port)) == 0


def wait_for_server(url: str, timeout: float = 10.0) -> bool:
    start = time.time()
    while time.time() - start < timeout:
        try:
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=1.0) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            time.sleep(0.2)
    return False


def start_uvicorn_in_thread(host: str = "127.0.0.1", port: int = 8000):
    import uvicorn
    from app.main import app

    config = uvicorn.Config(
        app=app,
        host=host,
        port=port,
        log_level="warning",
        access_log=False,
    )
    server = uvicorn.Server(config)
    t = threading.Thread(target=server.run, daemon=True)
    t.start()
    return server


def send_analyze_request(url: str, payload_bytes: bytes) -> dict:
    req = urllib.request.Request(
        url,
        data=payload_bytes,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=15.0) as resp:
        body = resp.read()
        elapsed = time.perf_counter() - t0
        res_json = json.loads(body.decode("utf-8"))
        return {
            "elapsed": elapsed,
            "status": resp.status,
            "data": res_json,
        }


def main():
    print("=" * 80)
    print("PRSift Concurrency Verification Test")
    print("Goal: Send 8 concurrent requests simultaneously using threads.")
    print("=" * 80)

    # 1. Load the first sample (obvious_spam)
    sample_file = ai_root / "samples" / "sample_payload.json"
    with open(sample_file, "r", encoding="utf-8") as f:
        samples = json.load(f)

    # The first sample is obvious_spam
    sample_key = "obvious_spam"
    sample_payload = samples[sample_key]
    payload_bytes = json.dumps(sample_payload).encode("utf-8")

    # 2. Check / Start Server
    port = 8000
    host = "127.0.0.1"
    server_url = f"http://{host}:{port}/analyze"
    health_url = f"http://{host}:{port}/health"

    if not is_port_in_use(port, host):
        print(f"No existing server detected on port {port}. Starting in-process uvicorn server...")
        start_uvicorn_in_thread(host, port)
        if not wait_for_server(health_url, timeout=10.0):
            print("ERROR: Failed to start uvicorn server!")
            sys.exit(1)
        print("Uvicorn server is up and healthy.\n")
    else:
        print(f"Using existing server listening on http://{host}:{port}/\n")

    # 3. Baseline single request
    print("Running baseline single request...")
    single_res = send_analyze_request(server_url, payload_bytes)
    single_time = single_res["elapsed"]
    print(f"Baseline single request finished in: {single_time:.2f}s")
    print(f"Response: label={single_res['data']['label']}, score={single_res['data']['spam_score']}, action={single_res['data']['suggested_action']}\n")

    # 4. 8 Concurrent requests via ThreadPoolExecutor
    num_requests = 8
    print(f"Dispatching {num_requests} concurrent requests across {num_requests} threads...")
    
    wall_start = time.perf_counter()
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=num_requests) as executor:
        futures = [
            executor.submit(send_analyze_request, server_url, payload_bytes)
            for _ in range(num_requests)
        ]
        for f in concurrent.futures.as_completed(futures):
            results.append(f.result())
    total_wall_time = time.perf_counter() - wall_start

    print(f"\nAll {num_requests} concurrent requests completed!")
    print("-" * 60)
    for idx, r in enumerate(results, 1):
        print(f"  Request {idx}: latency = {r['elapsed']:.2f}s | label = {r['data']['label']} | score = {r['data']['spam_score']}")
    print("-" * 60)

    avg_request_latency = sum(r["elapsed"] for r in results) / len(results)
    serial_estimated_time = single_time * num_requests
    ratio = total_wall_time / single_time if single_time > 0 else 1.0

    print(f"\nRESULTS SUMMARY:")
    print(f"  * Baseline 1-request time : {single_time:.2f}s")
    print(f"  * Total wall time (8 reqs): {total_wall_time:.2f}s")
    print(f"  * Avg latency per request : {avg_request_latency:.2f}s")
    print(f"  * Theoretical serial time : {serial_estimated_time:.2f}s (if requests were blocked 8x)")
    print(f"  * Wall time to single ratio: {ratio:.2f}x")

    if total_wall_time < (serial_estimated_time * 0.5):
        print("\n[SUCCESS] CONCURRENCY VERIFICATION PASSED!")
        print(f"  Wall time ({total_wall_time:.2f}s) is close to a single request ({single_time:.2f}s), NOT serialized ({serial_estimated_time:.2f}s).")
        print("  Requests ran concurrently in parallel without blocking the FastAPI event loop.")
    else:
        print("\n[FAIL] Concurrency issue detected: wall time is close to serial execution.")


if __name__ == "__main__":
    main()
