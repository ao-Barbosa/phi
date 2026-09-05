# Environment Variables

Phi uses environment variables in three ways:

- Variables such as `PHI_OFFLINE` configure the Phi process.
- Phi sets process markers so child processes can identify Phi as the launching agent.
- Commands run by the LLM-callable shell tools receive `PHI_*` variables describing the current session.

Provider API-key variables are documented separately in [Providers](providers.md#environment-variables-or-auth-file).

## Process Marker

The CLI and RPC entry points set two process markers:

- `AI_AGENT=phi` is a generic marker that lets tooling identify Phi as the agent that launched the process.
- `PHI_CODING_AGENT=true` is Phi-specific and lets child processes detect that they run inside Phi.

Child processes inherit both markers. They are not session-specific and are not set automatically when Phi is embedded through the SDK.

## Shell Tool Session Environment

Commands run by the `bash` and `powershell` tools receive the current Phi session state:

| Variable | Description |
|----------|-------------|
| `PHI_SESSION_ID` | Current session ID |
| `PHI_SESSION_FILE` | Absolute path to the current session JSONL file; unset for ephemeral sessions |
| `PHI_PROVIDER` | Currently selected model provider |
| `PHI_MODEL` | Currently selected model ID |
| `PHI_REASONING_LEVEL` | Current effective reasoning level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max` |

The values are resolved when each command starts. Switching models or changing the reasoning level therefore affects the next shell command without restarting Phi. `PHI_PROVIDER` and `PHI_MODEL` identify the selected Phi model, not a different upstream model that a router may choose internally.

When asked which model or provider is running, inspect these variables instead of inferring the answer from the system prompt:

```bash
printf '%s/%s\n' "$PHI_PROVIDER" "$PHI_MODEL"
printf 'reasoning=%s session=%s\n' "$PHI_REASONING_LEVEL" "$PHI_SESSION_ID"
```

The session file can be inspected directly when the session is persistent:

```bash
if [ -n "$PHI_SESSION_FILE" ]; then
  tail -n 1 "$PHI_SESSION_FILE"
fi
```

These variables are injected into the LLM-callable `bash` and `powershell` tools. They are not injected into user-entered `!` or `!!` commands.

### Custom Shell Tools

Tools created with `createBashTool()` or `createPowerShellTool()` expose the session environment by default when registered with Phi. Injection happens before `spawnHook`, so a hook receives the variables in `ctx.env`:

```typescript
const bashTool = createBashTool(cwd, {
  spawnHook: (ctx) => ({
    ...ctx,
    env: { ...ctx.env, CI: "1" },
  }),
});
```

Disable session metadata independently of the spawn hook:

```typescript
const powershellTool = createPowerShellTool(cwd, {
  exposeSessionEnvironment: false,
  spawnHook: (ctx) => ctx,
});
```

When disabled, Phi removes inherited values for these variables so nested Phi processes do not expose stale parent-session metadata.

## Phi Process Configuration

These variables are read by Phi itself:

| Variable | Description |
|----------|-------------|
| `PHI_CODING_AGENT_DIR` | Override the config directory; default is `~/.phi/agent` |
| `PHI_CODING_AGENT_SESSION_DIR` | Override session storage; overridden by `--session-dir` |
| `PHI_PACKAGE_DIR` | Override the package directory, useful for Nix/Guix store paths |
| `PHI_SERVER_DIR` | Override the experimental server profile and socket directory; default is `~/.phi/server` |
| `PHI_SERVER_ID` | Select the logical experimental server ID when `--server-id` is omitted |
| `PHI_OFFLINE` | Disable startup network operations, including update checks, package updates, and install/update telemetry |
| `PHI_SKIP_VERSION_CHECK` | Disable the latest-version request |
| `PHI_TELEMETRY` | Override install/update telemetry and provider attribution headers: `1`/`true`/`yes` or `0`/`false`/`no` |
| `PHI_CACHE_RETENTION` | Set to `long` for extended provider prompt caching where supported |
| `PHI_SHARE_VIEWER_URL` | Override the base URL used by `/share` |
| `PHI_HARDWARE_CURSOR` | Set to `1` to show the hardware cursor; see [Terminal setup](terminal-setup.md) |
| `PHI_HYPERLINKS` | Override OSC 8 hyperlink detection with `1`, `0`, or `auto` |
| `PHI_IMAGE_PROTOCOL` | Override inline image detection with `kitty`, `iterm2`, `none`, or `auto` |
| `PHI_TRUE_COLOR` | Override truecolor detection with `1`, `0`, or `auto` |
| `PHI_TUI_ESC_TIMEOUT` | How long to wait after a lone ESC before treating it as Escape, in milliseconds; defaults to `100` over SSH and `10` otherwise. Increase if Alt-key input is misread as Escape |
| `VISUAL`, `EDITOR` | External editor fallback when `externalEditor` is unset |
| `HTTP_PROXY`, `HTTPS_PROXY` | Proxy outbound HTTP requests |

Provider credentials such as `ANTHROPIC_APHI_KEY`, `OPENAI_APHI_KEY`, and cloud-provider configuration are listed in [Providers](providers.md#environment-variables-or-auth-file).
