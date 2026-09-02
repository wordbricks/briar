# Briar agent exec

This package owns the shared Computer Use execution path. Provider adapters,
the Worker, and the managed-computer box service use the same resource,
serialization, validation, and Connect client code from here.

The structure follows the Grok Bot 0.18 `agent-exec` boundary. Briar implements
only the Computer Use arm. It does not mirror Grok shell, file, MCP, or subagent
executors.
