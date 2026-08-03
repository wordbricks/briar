---
name: browser
description: Use ego-browser or agent-browser to verify user-visible interfaces and capture screenshots for Briar result evidence. Use when a Briar task changes a UI or requires browser-based validation.
---

# Browser Automation

This file is a discovery stub. The complete, version-matched guide is embedded in the Briar CLI so
the instructions stay aligned with the workflow and evidence commands that will execute them.

## Load the guide

Before using browser automation in a Briar run, load the complete guide:

```text
briar skills get browser
```

Read the returned Markdown completely. It includes the browser tool explicitly selected in Briar
Settings, explains how to load that tool's version-matched skill, isolate browser work, verify a UI,
capture screenshots, attach them to Briar evidence, and report an exact reason when capture is
unavailable. Do not substitute the unselected browser tool as a fallback.

If `skills get` is unavailable, the selected Briar CLI is incompatible with this Skill. Report the
version mismatch instead of reconstructing the workflow from memory.
