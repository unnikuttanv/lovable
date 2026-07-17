"""Typed contracts between the agents (coder-buddy style).

The whole pipeline can be read from these models:
plan() returns a PlanResult; a "build" plan goes to architect(), which returns a
TaskPlan — an ordered work queue of ImplementationTasks; coder() then implements
one task per LLM call, returning raw file content (no schema needed).
"""
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

_FORBIDDEN = ("src/main.jsx",)


class PlanResult(BaseModel):
    mode: Literal["build", "clarify", "chat"]
    plan: Optional[str] = None       # mode == "build": what to implement/change
    question: Optional[str] = None   # mode == "clarify": the one question to ask the user
    reply: Optional[str] = None      # mode == "chat": conversational answer


class ImplementationTask(BaseModel):
    path: str = Field(description="File to create or modify, under src/")
    description: str = Field(description="What to implement in this file")

    @field_validator("path")
    @classmethod
    def _valid_path(cls, v: str) -> str:
        v = v.replace("\\", "/")
        if not v.startswith("src/") or ".." in v or v in _FORBIDDEN:
            raise ValueError(f"illegal path: {v}")
        return v


class TaskPlan(BaseModel):
    summary: str = Field(description="One short sentence describing what is being built/changed")
    tasks: list[ImplementationTask] = Field(min_length=1)
    dependencies: dict[str, str] = Field(default_factory=dict, description="Extra npm packages beyond react/react-dom/lucide-react")
    deleted: list[str] = Field(default_factory=list, description="Existing file paths to remove")
