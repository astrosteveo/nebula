# nebula-ui demo: a real Claude Code session with the mod installed, driven from the keyboard.
# Render from the repo root with `vhs docs/demo/nebula-ui.tape` (it runs two short model turns).
Output docs/demo/nebula-ui.gif
Output docs/demo/nebula-ui.mp4

Set Shell "bash"
Set FontSize 15
Set Width 1400
Set Height 860
Set Padding 16
Set Theme "Catppuccin Mocha"
Set TypingSpeed 18ms

Hide
# A clean session: none of the recording session's own markers, and links drawn as hyperlinks.
Type "unset CLAUDECODE CLAUDE_CODE_BRIDGE_SESSION_ID CLAUDE_CODE_CHILD_SESSION CLAUDE_CODE_ENTRYPOINT CLAUDE_CODE_EXECPATH CLAUDE_CODE_MESSAGING_SOCKET CLAUDE_CODE_MESSAGING_TOKEN CLAUDE_CODE_SESSION_ATTENDED CLAUDE_CODE_SESSION_ID CLAUDE_EFFORT CLAUDE_JOB_DIR CLAUDE_PID; export FORCE_HYPERLINK=1" Enter
Type "clear" Enter
Show

# Only what the demo needs is allowed, so no permission dialog interrupts it.
Type `claude --permission-mode default --allowedTools "Bash(git log:*)" "Bash(wc:*)" "Bash(curl:*)" mcp__nebula-ui__processes mcp__nebula-ui__process_control` Enter
Wait+Screen@30s /for shortcuts|\/nebula/
Sleep 2s

# 1. A reply that shows the restyled transcript: prompt bar, tool rows, heading, table, callout, a runnable frame.
#    Its closing words are asked for in another form, so the wait matches the reply, never the prompt.
Type "Give me a short tour reply to show off this UI. First run `wc -l plugins/nebula-ui/hooks/*`. Then reply with a level-2 heading, a table of those files with their line counts, a [!TIP] callout about /nebula, and an sh code block with python3 -m http.server 8799. Close with the words tour and complete, capitalized, as a sentence."
Enter
Wait+Screen@150s /Tour complete/
Sleep 4s

# 2. Claude starts a server in the process manager and reads it back through its own tools.
Type "Start python3 -m http.server 8799 with your process_control tool, then confirm with the processes tool that it serves. Answer in one short sentence with only its localhost URL, then the words all and set, capitalized, as a sentence."
Enter
Wait+Screen@150s /All set/
Sleep 4s

# 3. The process list.
Type "/procs" Sleep 400ms Enter
Wait+Screen@15s /Processes pane opened/
Sleep 5s

# 4. The panel: every part is a toggle. Flip tool rows off (the engine's own rows come back), then on again.
Type "/nebula" Sleep 400ms Enter
Wait+Screen@15s /Press a number/
Sleep 3s
Type "3"
Sleep 3s
Type "3"
Sleep 4s

# Off camera: ending the session stops the server with it; the pkill is a backstop.
Hide
Escape
Type "/exit" Sleep 400ms Enter
Sleep 3s
Type "pkill -f '[h]ttp.server 8799'; true" Enter
