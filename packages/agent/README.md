# @calebx/agent

Conversational agent pipeline for CALEBX. Provides a single entry point:

runAgent(userId: number, message: string): Promise<string>

Internally runs a two-stage LLM pipeline (extraction → response) over
OpenRouter and retrieves/stores per-user memories via mem0.ai.

This package may import from @calebx/core for types only. No package
in core/ imports from here.
