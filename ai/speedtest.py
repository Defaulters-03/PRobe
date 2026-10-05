import os
import time
from pathlib import Path
from dotenv import load_dotenv
from google import genai

# 1. Load ai/.env and read GEMINI_API_KEY
env_path = Path(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path=env_path)

api_key = os.environ.get("GEMINI_API_KEY")
if not api_key:
    print("Error: GEMINI_API_KEY not found in environment.")
    raise SystemExit(1)

# 2. Create google-genai client
client = genai.Client(api_key=api_key)

models = ["gemma-4-26b-a4b-it", "gemma-4-31b-it"]
prompt = 'Reply with only this JSON: {"ok": true}'
results_summary = {}

# 3. For each model, make 2 calls measuring each call with time.time()
for model in models:
    successful_times = []
    for run in range(1, 3):
        start_time = time.time()
        try:
            response = client.models.generate_content(
                model=model,
                contents=prompt,
            )
            elapsed = time.time() - start_time
            successful_times.append(elapsed)
            # 4. Print one line: model name, run number, elapsed seconds rounded to 1 decimal, first 80 chars of response.text
            response_text = (response.text or "")[:80].replace("\r", "").replace("\n", " ")
            print(f"{model} run {run}: {elapsed:.1f}s - {response_text}")
        except Exception as e:
            # 5. On error, print model name, elapsed seconds and first 200 chars of error message, then continue
            elapsed = time.time() - start_time
            err_msg = str(e)[:200].replace("\r", "").replace("\n", " ")
            print(f"{model} run {run}: {elapsed:.1f}s - ERROR: {err_msg}")

    results_summary[model] = successful_times

# 6. At the end print a one-line summary per model
print("\n--- Summary ---")
for model in models:
    times = results_summary.get(model, [])
    if times:
        avg_time = sum(times) / len(times)
        print(f"{model}: {avg_time:.1f}s average")
    else:
        print(f"{model}: no successful calls")
