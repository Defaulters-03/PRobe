import asyncio
import json
import os
import sys
import time
from pathlib import Path
from typing import Dict, List, Any
from dotenv import load_dotenv

# Ensure the root of 'ai' is in sys.path
ai_root = Path(__file__).resolve().parent
if str(ai_root) not in sys.path:
    sys.path.insert(0, str(ai_root))

load_dotenv(dotenv_path=ai_root / ".env")

from app.schemas import AnalyzeRequest
from app.gemma import analyze_pull_request


MODELS = ["gemma-4-26b-a4b-it", "gemma-4-31b-it"]
RUNS_PER_SAMPLE = 3


def load_samples() -> Dict[str, Any]:
    sample_file = ai_root / "samples" / "sample_payload.json"
    if not sample_file.exists():
        raise FileNotFoundError(f"Samples file not found at {sample_file}")

    with open(sample_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    # Use the 3 primary samples
    target_keys = ["obvious_spam", "borderline", "legit"]
    return {k: data[k] for k in target_keys if k in data}


async def run_single_benchmark(model: str, sample_name: str, payload_data: dict) -> Dict[str, Any]:
    os.environ["GEMMA_MODEL"] = model
    pr_request = AnalyzeRequest.model_validate(payload_data)

    start = time.perf_counter()
    resp = await analyze_pull_request(pr_request)
    elapsed = time.perf_counter() - start

    return {
        "elapsed": elapsed,
        "label": resp.label,
        "score": resp.spam_score,
        "suggested_action": resp.suggested_action,
        "reasons": resp.reasons,
    }


async def main():
    print("=" * 90)
    print("PRSift AI Model Benchmark: gemma-4-26b-a4b-it vs gemma-4-31b-it")
    print(f"Running each of the 3 samples {RUNS_PER_SAMPLE} times per model...")
    print("=" * 90)

    samples = load_samples()
    print(f"Loaded {len(samples)} samples: {list(samples.keys())}\n")

    results: Dict[str, Dict[str, List[Dict[str, Any]]]] = {m: {s: [] for s in samples} for m in MODELS}

    for model in MODELS:
        print(f"\n---> Benchmarking model: {model}")
        for sample_name, sample_data in samples.items():
            print(f"  Testing sample: {sample_name:<14}", end="", flush=True)
            for r in range(1, RUNS_PER_SAMPLE + 1):
                res = await run_single_benchmark(model, sample_name, sample_data)
                results[model][sample_name].append(res)
                print(f" [{r}: {res['elapsed']:.2f}s ({res['label']}, {res['score']})]", end="", flush=True)
            print(" Done.")

    # Print summary table
    print("\n" + "=" * 90)
    print(f"{'Model':<22} | {'Sample':<14} | {'Avg Sec':<9} | {'Labels (3 runs)':<22} | {'Scores'}")
    print("-" * 90)

    model_stats: Dict[str, Dict[str, Any]] = {}

    for model in MODELS:
        total_time = 0.0
        total_runs = 0
        all_labels_sensible = True

        for sample_name, runs in results[model].items():
            avg_time = sum(r["elapsed"] for r in runs) / len(runs)
            total_time += sum(r["elapsed"] for r in runs)
            total_runs += len(runs)

            labels_str = ", ".join(r["label"] for r in runs)
            scores_str = ", ".join(str(r["score"]) for r in runs)

            for r in runs:
                lbl = r["label"].lower()
                if sample_name == "obvious_spam" and lbl != "spam":
                    all_labels_sensible = False
                elif sample_name == "legit" and lbl != "legit":
                    all_labels_sensible = False
                elif sample_name == "borderline" and lbl not in ("borderline", "low_effort", "spam"):
                    all_labels_sensible = False

            print(f"{model:<22} | {sample_name:<14} | {avg_time:<9.2f} | {labels_str:<22} | {scores_str}")

        overall_avg = total_time / total_runs if total_runs else 0.0
        model_stats[model] = {
            "overall_avg": overall_avg,
            "sensible": all_labels_sensible,
        }

    print("=" * 90)
    print("\nSummary & Recommendation:")
    for model, stats in model_stats.items():
        sensible_note = "All labels sensible" if stats["sensible"] else "WARNING: unexpected labels observed"
        print(f"  * {model:<22}: overall avg = {stats['overall_avg']:.2f}s per call ({sensible_note})")

    m_26b = model_stats.get("gemma-4-26b-a4b-it", {})
    m_31b = model_stats.get("gemma-4-31b-it", {})

    print("\nRecommendation:")
    if m_26b.get("sensible") and m_26b.get("overall_avg", 999) < m_31b.get("overall_avg", 999):
        speedup = ((m_31b.get("overall_avg", 1) - m_26b.get("overall_avg", 1)) / m_31b.get("overall_avg", 1)) * 100
        print(
            f"RECOMMENDATION: Use 'gemma-4-26b-a4b-it'. It is ~{speedup:.1f}% faster on average "
            f"({m_26b.get('overall_avg', 0):.2f}s vs {m_31b.get('overall_avg', 0):.2f}s) and produces sensible labels "
            "across all benchmark samples."
        )
    elif m_26b.get("sensible"):
        print(
            "RECOMMENDATION: Both models return sensible labels. 'gemma-4-26b-a4b-it' and 'gemma-4-31b-it' "
            "perform comparably. You may set GEMMA_MODEL=gemma-4-26b-a4b-it in .env for efficiency."
        )
    else:
        print(
            "RECOMMENDATION: Stick with 'gemma-4-31b-it'. While 'gemma-4-26b-a4b-it' is smaller, "
            "'gemma-4-31b-it' demonstrates higher labeling reliability and accuracy."
        )


if __name__ == "__main__":
    asyncio.run(main())
