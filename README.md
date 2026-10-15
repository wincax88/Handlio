# Handlio

Turn screenshots into clear client handover manuals.

Handlio helps freelancers, agencies, and software implementation teams document what they deliver. Create illustrated guides, publish a version, invite clients to review it, and collect explicit acknowledgement of that exact release. Deliver the result through a private reader, a PDF, or an offline HTML package.

**[Open Handlio](https://www.handlio.cloud)** · [Quick start](#quick-start) · [Documentation](#documentation) · [License](#license)

The interface is in English. Guide content supports Unicode, including Chinese.

## What you can do

- **Prepare screenshots before upload.** Crop, redact sensitive information, and confirm each image locally. Only the flattened, reviewed image is uploaded. Add arrows, boxes, numbers, and labels as you build your guides.
- **Write structured instructions.** Start from website, software, or blank templates. Define goals, prerequisites, audiences, steps, expected results, and handover checklists. Autosave and conflict resolution help preserve edits.
- **Publish a specific version.** Run publication checks, review changes, and create immutable releases. Later edits become a new draft; existing releases keep their original content.
- **Control client access.** Invite clients by email as Viewers, Reviewers, or Confirmers. Manage sharing, download permissions, access removal, and hosting expiry.
- **Complete the handover.** Discuss questions against individual steps and request acknowledgement from up to three required confirmers. Reading a guide does not count as confirming receipt.
- **Deliver online or offline.** Offer a mobile reader, generate PDFs, or export a self-contained HTML ZIP with images and styles. Extract the ZIP and open `index.html` without a network connection.

Optional AI assistance generates structured suggestions through a configured server adapter. Suggestions require human review before publication.

## Quick start

Requires Git, **Node.js 22.13 or later**, and npm. CI and production use Node.js 24. Handlio uses Node's built-in SQLite support.

```sh
git clone https://github.com/wincax88/Handlio.git
cd Handlio
npm ci
npm run dev
```

Open **http://localhost:5173**. The API listens on `127.0.0.1:3001`, and Vite proxies `/api` requests to it. Use the `localhost` address to match the default `APP_ORIGIN`.

The default development workflow needs no external service credentials. To customize ports, email, payment, or AI settings, copy [`.env.example`](.env.example) to `.env`. If you change the frontend address, update `APP_ORIGIN` to match.

On first launch, Handlio creates `.data/handlio.sqlite`. The `.data/` directory also holds processed images and export files and is excluded from Git. Original screenshots remain in browser memory during preparation and are not sent to the server.

PDF export requires Chromium. Windows can use an installed Edge or Chrome; otherwise install the Playwright browser:

```sh
npx playwright install chromium
```

You can also set `CHROMIUM_EXECUTABLE_PATH` explicitly.

## Try a local handover

1. **Sign in.** Enter an email address and use the clearly labeled development verification code. Configuring Resend or SMTP enables real verification emails.
2. **Create a project.** Choose a template, prepare screenshots, and write the guides. Review each step and its expected result.
3. **Check the handbook.** Add an introduction, branding, support details, and a handover checklist. Preview it and resolve publication checks.
4. **Publish a release.** In Billing, use the development payment simulation to activate local project entitlements. In Versions, add a release summary and publish. The simulation creates no real charge and is unavailable in production.
5. **Invite a client.** Enable sharing in Handoff and invite another email address. Open a separate browser profile or private window to use the client account.
6. **Collect acknowledgement.** Designate the required confirmers, request receipt of the current release, and resolve blocking questions. The project owner cannot confirm on a client's behalf.
7. **Export the delivery.** Download the PDF or offline HTML ZIP from Exports.

## Project plans

Prices are in USD. Project purchases and hosting extensions are one-time payments with no automatic renewal. Applicable taxes are shown at checkout.

| Plan              | Price         | Scope                                                                                          |
| ----------------- | ------------- | ---------------------------------------------------------------------------------------------- |
| Free authoring    | $0            | One free draft, 3 guides, 20 steps, and 100 MiB of storage                                     |
| Project pack      | $19 / 90 days | Up to 10 guides, 200 steps, 1 GiB of storage, and 50 clients; publishing, sharing, and exports |
| Hosting extension | $9 / 90 days  | Extend an existing project's hosting window                                                    |

Paid projects include an allowance of 300 successful AI steps when an AI provider is configured, plus 200 new exports per hosting window with a daily limit of 10. A hosting extension does not replenish the AI allowance or automatically enable sharing.

The limits and prices are defined in [`shared/model.ts`](shared/model.ts).

## Deployment and integrations

The hosted application runs at **https://www.handlio.cloud** on Sealos. It is configured with Resend email delivery and Dodo Payments live checkout. AI remains optional and requires a separate adapter.

| Integration | Configuration                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------ |
| Email       | Resend HTTPS API or SMTP for verification codes, invitations, and notifications                        |
| Payments    | Dodo hosted checkout, verified webhooks, authoritative transaction checks, and refund/dispute handling |
| AI          | A server-side adapter for structured suggestions, with usage and cost controls                         |
| Backups     | Encrypted snapshots enabled with a backup key and destination directory                                |

Production requires `NODE_ENV=production`, an HTTPS `APP_ORIGIN`, a random `SESSION_SECRET` of at least 32 characters, and a configured email provider. `npm start` serves the API and built frontend; it does not set production environment variables for you. Keep credentials in environment secrets and out of the repository.

Pushes to `main` trigger tests, an immutable container build, and deployment through [GitHub Actions](https://github.com/wincax88/Handlio/actions/workflows/sealos.yml). The pipeline checks public HTTPS and payment configuration and verifies signed callbacks without creating a purchase. Dodo test payments run in a separate hosted instance with its own database, storage volume, and session key.

See the [Sealos deployment guide](docs/sealos.md), [deployment and recovery guide](docs/deployment.md), and [provider integration reference](docs/providers.md).

Operational acceptance still includes real purchase, refund, and dispute scenarios, independent backup and recovery drills, and manual review of supported devices and export layouts. Automated tests and signed callback checks do not replace those exercises.

## Development commands

| Command                      | Purpose                                                         |
| ---------------------------- | --------------------------------------------------------------- |
| `npm run dev`                | Start the local API and Vite development server                 |
| `npm run check`              | Run TypeScript checks                                           |
| `npm test`                   | Run server and configuration tests                              |
| `npm run test:ui`            | Run Playwright scenarios using the default Chromium project     |
| `npm run test:cross-browser` | Run scenarios in Chromium, Firefox, and WebKit                  |
| `npm run build`              | Check types and build the frontend                              |
| `npm start`                  | Serve the API and built frontend                                |
| `npm run backup`             | Create an encrypted backup using the configured backup settings |
| `npm run restore`            | Run the restore tool; follow the recovery guide before using it |

Before running the full browser suite, install its browsers and platform dependencies:

```sh
npx playwright install --with-deps chromium firefox webkit
npm run test:cross-browser
```

Server tests cover tenant isolation, CSRF, draft conflicts, image validation, payment idempotency, webhook signatures, immutable releases, acknowledgement, withdrawal, exports, and expiry. Browser scenarios cover the owner and client workflows, screenshot redaction and annotations, navigation guards, and mobile reading. WebKit automation does not replace testing on a physical Safari device.

Browser tests use isolated local provider simulations and a separate database under `.work/e2e-data/`. Generated screenshots, PDFs, and traces are excluded from Git.

## Architecture

Built with TypeScript, React, Vite, Express, SQLite, and Playwright.

```text
src/             Owner workspace, screenshot editor, and client reader
shared/          Content schemas, workspace settings, limits, and pricing
server/          Authentication, authorization, billing, jobs, assets, and exports
tests/           Server integration, configuration, and browser tests
deploy/sealos/   Application, networking, storage, and certificate manifests
scripts/         Deployment, provider verification, and test utilities
docs/            Architecture, API, integration, and acceptance references
```

Image decoding and PDF rendering use separate processes with resource limits. Published snapshots are protected by database immutability rules. Client assets and downloads are authorized on each request; downloaded copies cannot be recalled. SQLite and file-backed jobs currently use a single application instance with a persistent volume.

## License

Copyright (C) 2026 Handlio contributors.

Handlio is free software licensed under the **GNU Affero General Public License, version 3 only** (`AGPL-3.0-only`). You may use, modify, and redistribute it under the terms in [LICENSE](LICENSE). This grant does not include later versions of the license. Third-party dependencies and materials retain their respective licenses.

If you modify Handlio and make it available over a network, AGPL section 13 requires you to prominently offer the corresponding source of your version to users interacting with it. The hosted app provides source and license links in its footer. Container builds use `SOURCE_REPOSITORY` and `SOURCE_REVISION` to identify the source of the deployed version; modified deployments must point these at their own corresponding source. The GitHub Actions build sets them automatically from the repository and commit.

The software is provided without warranty, to the extent permitted by law. See [LICENSE](LICENSE) for the complete terms.

## Documentation

The detailed reference documents are currently written in Chinese.

| Document                                                              | Contents                                                                   |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [Architecture](docs/architecture.md)                                  | Data model, boundaries, and core workflows                                 |
| [API reference](docs/api.md)                                          | Endpoints and request/response contracts                                   |
| [Provider integrations](docs/providers.md)                            | Email, Dodo Payments, and AI adapters                                      |
| [Sealos deployment](docs/sealos.md)                                   | GitHub configuration, domains, TLS, and release operations                 |
| [Deployment and recovery](docs/deployment.md)                         | Production setup, backups, and restoration                                 |
| [Prototype alignment](docs/prototype-alignment.md)                    | Feature mapping against the interactive prototype                          |
| [Implementation and acceptance ledger](docs/implementation-status.md) | Historical PRD coverage and remaining acceptance work                      |
| [Additional features](docs/nonpayment-completion.md)                  | Annotations, glossary, incidents, export protection, and encrypted backups |
