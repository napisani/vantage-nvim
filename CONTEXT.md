# vantage.nvim

vantage.nvim is a review loop between Neovim and the Pi coding agent running beside it: you ask about code, request changes, and ask for tours and annotations, and the agent that edits the code answers in its own conversation.

## Language

**Adjacent Agent**:
The interactive Pi session running in the same workspace as Neovim, with the `pi-vantage-nvim` extension loaded. It is the only thing that answers Vantage.
_Avoid_: Vantage agent, buddy session, backend

**pi-vantage-nvim**:
The Pi extension shipped in this repository. It holds the Review State, turns Neovim's actions into agent messages, registers the Reply Tools, and serves Neovim over the Channel.
_Avoid_: Bridge, server, backend

**Channel**:
The owner-only Unix socket between Neovim's Lua and pi-vantage-nvim, carrying one JSON message per line. Socket names carry a hash of the canonical workspace root and the Pi process id.
_Avoid_: Bridge, IPC snapshot, stdio backend

**Review State**:
Everything the review knows: Threads, Tours, the Review Base, and whether the agent is busy. pi-vantage-nvim is its only writer; Neovim holds a read-only copy replaced on every change.
_Avoid_: Session output, transcript

**Thread**:
One conversation about code: a Question, a Change Request, a Walkthrough Request or a Diff Tour Request. It is Anchored to lines or is about the workspace as a whole. Ids are Q, R, W and T followed by a number.
_Avoid_: Comment, note, request (alone)

**Anchor**:
The file, line range, side (current code or the base side of a diff) and the quoted lines a Thread is about. After edits it is found again by extmark, then by the quoted text, then by the agent's report.
_Avoid_: Location, position

**Question**:
A Thread the agent answers in words, optionally with code locations that can go to quickfix. Explain is a preset Question.
_Avoid_: Search, query

**Change Request**:
A Thread asking the agent to edit code. It waits as pending until its Round is sent, and ends done, declined or needs-input.
_Avoid_: Edit, fix

**Round**:
The pending Change Requests sent to the agent together in one message, which the agent reports on in one `vantage_request_update` call.
_Avoid_: Batch, queue

**Tour**:
An ordered list of stops with notes that the agent publishes: a Walkthrough (shown in quickfix) or a Diff Tour (shown in Diffview, with stops on either side of a comparison). The agent may publish one unasked.
_Avoid_: Walkthrough file, diff-tour artifact

**Review Base**:
An optional git ref, its merge base, and a target (the working tree or a commit). When set, every agent message names the diff, and changed files can be listed.
_Avoid_: Stored reference, PR base

**Reply Tools**:
The tools pi-vantage-nvim gives the agent: `vantage_answer`, `vantage_request_update`, `vantage_walkthrough`, `vantage_diff_tour` and `vantage_annotate`. The two tour tools are active from session start; the others switch on with the first Vantage message.
_Avoid_: Submit tools, MCP tools

**Withdraw**:
Cancelling a request the agent has not seen: pi-vantage-nvim rewrites its message before the model reads it. A request already being worked on is cancelled with a notice on the agent's next turn instead. Cancel never aborts the agent's turn.
_Avoid_: Abort, kill

**Resolved**:
A Thread the user has finished with. Its sign hides; it stays in the thread list until cleared, and a follow-up reopens it.
_Avoid_: Closed, done

**Annotation Block**:
A note drawn as virtual lines above a code line. Annotate sends candidate lines and a percentage-based budget; the agent picks which lines deserve a block. Blocks are drawn only in the Neovim that asked and are not part of the Review State.
_Avoid_: Inline comment, virtual hint

**Lens**:
The user's framing for answers, such as "explain for a learner", sent as one line with every request.
_Avoid_: Prompt prefix, persona

**Review Core**:
`require("vantage.review")`: the latest Review State, the actions that change it, and the `User VantageReviewChanged` event. It never opens windows; the built-in views and the user's own views read it.
_Avoid_: Controller, backend

**Composition**:
The persistent staging buffer whose send opens a workspace-level Question or Change Request.
_Avoid_: Scratchpad, prompt builder

## Example dialogue

Dev: "Can I ask the agent why this retry exists without leaving Neovim?"

Domain expert: "Yes. `:VantageAsk` opens a Question anchored to those lines; the adjacent agent answers with `vantage_answer` and the sign on the line shows it."

Dev: "And if I want three changes made?"

Domain expert: "Queue three Change Requests and send the Round. The agent edits, then reports each one as done, declined or needs-input in one update."

Dev: "What if I change my mind about one while the agent is busy?"

Domain expert: "Cancel it. If the agent has not seen the Round yet, Vantage withdraws it from the message; if it is working on it, the agent gets a notice. Its turn is never aborted."

Dev: "Does Vantage still work without Pi running?"

Domain expert: "Prompt history, the lens, composition staging and monitor mode do. Anything that needs an answer needs the Adjacent Agent."
