# opencode-aware

OpenCode plugin that exposes tools for session, context, agent, model, database,
and OpenCode documentation awareness.

## Compatibility

Version `0.4.0` targets the OpenCode v2 plugin API. Pin it in v2 configuration:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-aware@0.4.0"]
}
```

Version `0.3.0` is the final release compatible with OpenCode v1. Keep that
version pinned while using v1:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-aware@0.3.0"]
}
```

The v2 plugin provides `get_session_id`, `get_session_db_info`,
`get_context_info`, `get_agent_info`, `get_all_agents`, and `get_opencode_docs`.
See the [repository README](https://github.com/tbrandenburg/opencode-aware#readme)
for tool details and development instructions.

## License

MIT.
