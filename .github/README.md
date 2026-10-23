# VS Code agent pack

## Install
1. Open your project folder in VS Code.
2. Copy the `.github` folder from this pack into the project root (merge if you already have one).
3. Open Copilot Chat, open the agent dropdown, and your agents appear: planner, implementer, debugger, reviewer, test-writer, security-auditor, refactorer, docs-writer.
4. To make them available in every project, copy the `.agent.md` files to your user-level agents folder (`~/.copilot/agents`) instead.

## Recommended workflow
planner -> implementer -> test-writer -> reviewer -> (security-auditor) -> docs-writer
Each agent shows handoff buttons to jump to the next one.
Use debugger whenever something breaks. Use refactorer when code works but is messy.

## Tips
- Fill in `copilot-instructions.md` first; every agent reads it.
- Read-only agents (planner, reviewer, security-auditor) list their allowed tools. Use the Configure Tools button in chat to adjust if tool names differ in your version.
- Edit the prompts freely; they are plain Markdown.
