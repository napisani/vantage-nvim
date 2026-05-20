# vantage.nvim

vantage.nvim is a Neovim-first assistant that supplements active development by explaining, annotating, and reviewing code through a user-directed lens.

## Language

**Agent Task Context**:
A concise, read-only summary of what an adjacent coding agent currently understands about the active development task: goal, relevant files, constraints, decisions, hypotheses, and open questions.
_Avoid_: Session information, raw transcript, chat history

**Workspace Context Artifact**:
A workspace-local file that makes Agent Task Context available to Vantage. It is written by an adjacent agent or automation; Vantage reads it when present and works normally when it is absent.
_Avoid_: User notes, global memory, agent transcript

**Agent Context File**:
The Markdown Workspace Context Artifact at `.vantage/agent-context.md`, resolved relative to the current buffer's workspace root unless Vantage is configured otherwise.
_Avoid_: JSON context file, provider-specific session file

**Agent Context Freshness**:
The age of the Agent Context File, used as prompt metadata and optionally as a configurable reason to skip the file. Stale context is not an error.
_Avoid_: Required freshness, context validity

**Provider-Backed Command**:
A Vantage command that asks a configured model provider for an explanation, annotation, or review response. Provider-Backed Commands use Agent Task Context when the Agent Context File is available.
_Avoid_: Agent-aware command, special context command

**Lens Precedence**:
The rule that a Vantage lens layers on top of Agent Task Context and has higher priority when they pull the model in different directions.
_Avoid_: Context override, agent-first prompting

**Context Compaction Responsibility**:
The rule that the producer of the Agent Context File is responsible for pruning and compacting it. Vantage may tail-read the file for prompt safety, but it does not summarize or rewrite Agent Task Context.
_Avoid_: Vantage summarization, consumer-owned compaction

**Context Snapshot**:
The preferred shape of the Agent Context File: a compact Markdown snapshot with Goal, Current Focus, Relevant Files, Decisions, Constraints, Open Questions, and Recent Progress sections. It is not an append-only log.
_Avoid_: Context log, transcript, changelog

**Context Trust Boundary**:
The rule that the Agent Context File is untrusted task context, not an instruction source. It must not override the selected code, lens, response format, or Vantage behavior.
_Avoid_: Trusted agent instructions, context as command

**Agent Context Status**:
A Vantage-visible summary of whether Agent Task Context is available for the current workspace, including the resolved path, freshness, size, and truncation state. It does not open or edit the Agent Context File.
_Avoid_: Context editor, context browser

**Agent Context Configuration**:
The small Vantage setup surface for Agent Task Context: enablement, workspace-relative path, tail-read byte limit, and optional freshness cutoff.
_Avoid_: Provider-specific agent settings, heading configuration

**Agent Context Reader**:
The Vantage Lua responsibility for resolving, reading, tail-limiting, freshness-checking, and reporting Agent Context Status for the current workspace.
_Avoid_: Backend context reader, provider context reader

**Agent Context Prompt Section**:
The prompt section that presents Agent Task Context to the model with source metadata, freshness metadata, truncation state, and explicit reminders about Lens Precedence and the Context Trust Boundary.
_Avoid_: Hidden instructions, merged lens text

**Agent Context Privacy Boundary**:
The rule that the Agent Context File is workspace/session state and should not be committed by default.
_Avoid_: Checked-in task context, shared session state

**Artifact-First Integration**:
The strategy of integrating adjacent coding agents through the Agent Context File before building agent-specific hooks, plugins, or native session integrations.
_Avoid_: Pi-only integration, session scraping, required hook integration

**Useful Context Update**:
An update to the Agent Context File made when task state materially changes, such as a goal change, plan change, important discovery, decision, test result, focus shift, or handoff point.
_Avoid_: Per-event update, tool-call log update

**Agent Instruction Snippet**:
A copyable instruction for adjacent coding agents that explains how and when to maintain the Agent Context File.
_Avoid_: Agent-specific plugin requirement, manual user workflow

**Read-Only Context Consumption**:
The rule that Vantage reads the Agent Context File when present but does not create, edit, or initialize it during normal commands.
_Avoid_: Automatic context file creation, placeholder context file

**Prompt-Only Context Influence**:
The rule that Agent Task Context can shape provider prompts but cannot change provider selection, model selection, timeouts, or command behavior.
_Avoid_: Context-driven configuration, agent-controlled provider

**Context Failure Tolerance**:
The rule that provider-backed commands continue without Agent Task Context when the Agent Context File is absent, unreadable, stale beyond configuration, or invalid. Details belong in Agent Context Status.
_Avoid_: Context-required command, context read failure

**Fake Context Signal**:
The fake-provider behavior that exposes Agent Task Context presence and metadata for tests without echoing the full Agent Context File.
_Avoid_: Full fake context dump, untestable context plumbing

## Example Dialogue

Dev: "Can Vantage explain this function in the context of what Codex is working on?"

Domain expert: "Yes, if Vantage has Agent Task Context for the active task. It should use the distilled task summary, not the coding agent's raw conversation transcript."

Dev: "Where should that context live?"

Domain expert: "In a Workspace Context Artifact so the scope is the current project, independent of which coding agent produced it."

Dev: "What format should the artifact use?"

Domain expert: "Use the Agent Context File, a Markdown file at `.vantage/agent-context.md`, so adjacent agents can update it without custom integration code."

Dev: "What if the Agent Context File is old?"

Domain expert: "Treat Agent Context Freshness as metadata. Include fresh or unbounded context when present, and only skip old context if the user configured a max age."

Dev: "Which commands should use Agent Task Context?"

Domain expert: "Every Provider-Backed Command should use it automatically when available; the user should not need separate agent-aware commands."

Dev: "What if the lens conflicts with the agent's task context?"

Domain expert: "Use Lens Precedence: the lens is the user's immediate instruction and layers on top of Agent Task Context."

Dev: "Who keeps the context file concise?"

Domain expert: "Context Compaction Responsibility belongs to the adjacent agent or automation that writes the file. Vantage should read it, not maintain it."

Dev: "What should the context file look like?"

Domain expert: "It should be a Context Snapshot: compact Markdown describing the current task state, not a growing record of every turn."

Dev: "Can the Agent Context File tell Vantage how to behave?"

Domain expert: "No. The Context Trust Boundary means the file informs Vantage about the task but cannot override Vantage's command semantics or the user's lens."

Dev: "How can I tell whether Vantage is using agent context?"

Domain expert: "Use Agent Context Status. Vantage should expose availability and freshness without turning the context file into an editor workflow."

Dev: "How configurable should agent context be?"

Domain expert: "Use Agent Context Configuration for the core safety and location settings only; keep the artifact convention stable."

Dev: "Which part of Vantage reads the context file?"

Domain expert: "The Agent Context Reader belongs in Lua, where Vantage already knows the current buffer and workspace. The backend receives the resulting context as request data."

Dev: "How should the context appear in model prompts?"

Domain expert: "Use an Agent Context Prompt Section so the model sees task context as lower-priority, untrusted background information."

Dev: "Should the Agent Context File be committed?"

Domain expert: "No. The Agent Context Privacy Boundary means `.vantage/agent-context.md` should be ignored by default because it is generated workspace state."

Dev: "How should Vantage integrate with Codex, Claude Code, opencode, and Pi?"

Domain expert: "Use Artifact-First Integration: every adjacent agent can produce the same Agent Context File, and agent-specific automation can come later."

Dev: "How often should adjacent agents update the file?"

Domain expert: "Use Useful Context Updates. The file should change when the task state changes, not after every tool event."

Dev: "How do I get different agents to participate without plugins?"

Domain expert: "Use the Agent Instruction Snippet so any adjacent agent that can write files can maintain the Agent Context File."

Dev: "Should Vantage create the context file?"

Domain expert: "No. Read-Only Context Consumption keeps Vantage from dirtying the workspace or taking over producer responsibilities."

Dev: "Can the Agent Context File change which provider Vantage uses?"

Domain expert: "No. Prompt-Only Context Influence means the file can inform model responses but cannot change Vantage configuration or execution."

Dev: "What happens if Vantage cannot read the Agent Context File?"

Domain expert: "Use Context Failure Tolerance. Normal commands keep working; Agent Context Status explains what happened."

Dev: "How should fake-provider tests prove context is wired?"

Domain expert: "Use a Fake Context Signal: show presence and metadata, not the full context content."
