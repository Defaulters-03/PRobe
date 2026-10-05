from typing import List, Optional, Literal
from pydantic import BaseModel, Field


class AuthorSchema(BaseModel):
    login: str
    account_created_at: str
    public_repos: int = 0
    followers: int = 0


class StatsSchema(BaseModel):
    changed_files: int = 0
    additions: int = 0
    deletions: int = 0


class FileSchema(BaseModel):
    filename: str
    status: str = "modified"
    additions: int = 0
    deletions: int = 0
    patch: Optional[str] = ""


class AnalyzeRequest(BaseModel):
    number: int
    title: str
    body: Optional[str] = ""
    url: str
    created_at: str
    author: AuthorSchema
    stats: StatsSchema
    files: List[FileSchema] = []


class AnalyzeResponse(BaseModel):
    label: Literal["spam", "low_effort", "legit"]
    spam_score: int = Field(ge=0, le=100)
    reasons: List[str] = Field(..., max_length=3)
    suggested_action: Literal["close", "request_changes", "review"]


class GemmaRawOutput(BaseModel):
    spam_score: int = Field(..., ge=0, le=100)
    reasons: List[str] = []
    suggested_action: Optional[str] = None
