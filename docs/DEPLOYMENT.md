# Cloudflare Worker deployment

The `Deploy Worker` GitHub Actions workflow runs on pushes to `main` and manual dispatch. It installs dependencies, runs `pnpm typecheck` and `pnpm test`, then deploys `wrangler.toml` to Cloudflare Workers.

## Required GitHub repository secrets

- `CLOUDFLARE_API_TOKEN`: Cloudflare API token scoped to the target account with Workers Scripts Edit permission.
- `CLOUDFLARE_ACCOUNT_ID`: the Cloudflare account ID containing the `astratrade-ai` Worker.

Never commit either value to the repository or print it in logs.

## Post-deployment validation

Verify the latest run under GitHub Actions, then check the deployed Worker `/health` endpoint and confirm that the live version exposes the expected signal statistics and scheduled outcome-resolution behavior. An API provider outage or HTTP 402 must be reported as unavailable data, not as a valid signal.
