# Local connections to your deployed bots

The local hub reads the shared database, but that alone does not authenticate a message to a bot. The signing key remains on the deployed hub. Pulling development variables intentionally does not download it.

Refresh the development environment through the Vercel project linked to your hub:

```sh
cd apps/hub
vercel env pull .env.local --environment=development --yes
```

Local connections use `DEV_RELAY_URL`, pointing to your deployed hub, and the `VERCEL_OIDC_TOKEN` of the development environment. The deployed hub's bot and Live relays stay closed unless it has `DEV_RELAY_USERS`: a comma-separated list of the Vercel user ids allowed through.

The relay validates the token's Vercel signature, expiry, configured team and the fixed `busy-hub` project subject used by the hub/bot protocol, requires it to be a development token, and matches its `user_id` claim against the list. `busy-hub` is the protocol issuer; the Vercel team is your `VERCEL_TEAM_SLUG`. The grant follows the person rather than one token, so it survives the token's rotation every few hours; another team member's otherwise-valid token is refused until their id is listed. Without the list the relay answers 404; a missing, invalid or unlisted credential gets 401.

Your user id is the `user_id` claim of a pulled development token, and also the `id` that `vercel api /v2/user` prints. Set `DEV_RELAY_USERS` on the deployed hub once and redeploy it; remove it to close the relay. Keep the `.env.local` file private. Do not print bearer tokens or pull the deployed signing key as a workaround.

The local hub reads the shared database, but its `SESSION_SECRET` is intentionally different from any deployed environment. OAuth subscription grants are encrypted with that secret, so a grant connected from localhost cannot be read by a deployed hub. Connect providers from the `HUB_URL` environment you intend to use; do not overwrite a deployed grant from localhost or change the deployed secret to make a local grant readable.

For a connection check, read the existing session stream or the authenticated agent-info route. Do not create a real routine merely to test connectivity. Existing bots need the current template deployed before their info exposes `manage_routines`; updating the hub alone does not change a bot's tools.
