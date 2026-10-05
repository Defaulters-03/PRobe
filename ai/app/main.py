# ==============================================================================
# PRSift AI Service - Pull Request Triage API
#
# PowerShell Test Commands:
# 1. Health check:
#    Invoke-RestMethod -Uri "http://localhost:8000/health" -Method Get
#
# 2. Test All Samples (obvious_spam, borderline, legit, first_timer_legit):
#    $samples = (Get-Content .\samples\sample_payload.json | ConvertFrom-Json); @('obvious_spam', 'borderline', 'legit', 'first_timer_legit') | ForEach-Object { Write-Host "`n=== Testing $_ ===" -ForegroundColor Cyan; Invoke-RestMethod -Uri "http://localhost:8000/analyze" -Method Post -ContentType "application/json" -Body ($samples.$_ | ConvertTo-Json -Depth 10) }
#
# 3. Test Single Sample (e.g. obvious_spam or first_timer_legit):
#    Invoke-RestMethod -Uri "http://localhost:8000/analyze" -Method Post -ContentType "application/json" -Body ((Get-Content .\samples\sample_payload.json | ConvertFrom-Json).first_timer_legit | ConvertTo-Json -Depth 10)
# ==============================================================================

from contextlib import asynccontextmanager
import logging
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Load .env file from the ai directory
env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=env_path)

from app.schemas import AnalyzeRequest, AnalyzeResponse
from app.gemma import analyze_pull_request

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("prsift.api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting PRSift AI Service...")
    yield
    logger.info("Shutting down PRSift AI Service...")


app = FastAPI(
    title="PRSift AI Service",
    description="Automated triage service for GitHub PRs using Gemma 4",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check() -> dict:
    """Health check endpoint."""
    return {"ok": True}


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze_pr(payload: AnalyzeRequest) -> AnalyzeResponse:
    """
    Analyze incoming GitHub pull request data to judge whether it is spam / low effort
    or a legitimate open-source contribution.
    """
    return await analyze_pull_request(payload)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
