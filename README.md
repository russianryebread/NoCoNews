# NoCoNews

A text-first community news aggregator running on Cloudflare Workers and D1. See [the technical specification](TECHNICAL_SPEC.md) for the intended release scope.

## Local development

```sh
npm ci
npm run check
npm run db:local
npm run dev
```

The default config uses a local D1 placeholder. Public pages load on an empty database. Sign-in requires the staging settings below. Wrangler simulates email in local mode.

## Prepare a staging deployment

1. Sign in with `npx wrangler login` and check the selected Cloudflare account with `npx wrangler whoami`.
2. Create a dedicated D1 database with `npx wrangler d1 create noconews-staging`. Copy `wrangler.jsonc` to the ignored file `wrangler.staging.jsonc`. Set the Worker name to `noconews-staging` and replace the local database name and ID with the staging values.
3. Enable Cloudflare Email Routing for the sender domain. Verify every tester's destination address in that Cloudflare account, including the initial administrator. Set `MAIL_FROM` to an address on the sender domain, `LOGIN_RECIPIENTS` to the comma-separated verified addresses, and `ADMIN_EMAIL` to one of those addresses. Set `send_email[0].allowed_destination_addresses` to the same addresses as an array. Keep the staging config local.
4. Set `PUBLIC_ORIGIN` to the exact HTTPS origin for the staging Worker. Set `SITE_NAME` to the community's display name. Create a Turnstile widget for the staging hostname and put its public key in `TURNSTILE_SITE_KEY`.

Before deploying, validate the bundle and apply migrations to the dedicated staging database. Set the Turnstile secret through Wrangler's interactive prompt. The first deployment can include the secret by creating a temporary file outside the repository containing the single `TURNSTILE_SECRET` key, then passing it with `--secrets-file` and deleting the temporary file afterward. For subsequent changes, use `wrangler secret put TURNSTILE_SECRET --config wrangler.staging.jsonc`.

```sh
npx wrangler deploy --config wrangler.staging.jsonc --dry-run
npx wrangler d1 migrations apply DB --remote --config wrangler.staging.jsonc
npx wrangler deploy --config wrangler.staging.jsonc --secrets-file /absolute/path/to/staging-secrets.json
```

## Staging acceptance

- Open the public feed and search while signed out.
- Sign in with the verified admin address, choose a username, and publish community guidelines. Confirm that the same email link cannot be reused.
- Sign in as a second verified tester. Submit a story, reply, upvote the other member's content, and undo the vote.
- Report a story as the tester, then hide and restore it from the admin queue. Check that the public discussion and search follow its visibility.
- Wait for the next scheduled ranking refresh and verify the Top feed. Check that unlisted addresses receive the generic response without sending email.
