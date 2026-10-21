# Start here: mirel-media

This filename is retained for compatibility with the original project handoff. Current setup documentation is in English.

Work in the existing `D:\code\mirel-media` directory; do not extract an old archive over it or initialize another repository.

1. Read [README.md](README.md) for local startup and checks.
2. Follow [docs/EMAIL_SETUP.md](docs/EMAIL_SETUP.md) for Resend (default), or [docs/GMAIL_SETUP.md](docs/GMAIL_SETUP.md) for optional Gmail send-only access.
3. Follow [docs/LAUNCH.md](docs/LAUNCH.md) when you are ready to configure hosting and verify real delivery.

Use Node.js 24 or later. No package installation is required. Keep credentials in the ignored local `.env` or private hosting environment variables. The implementation has mocked tests; real mailbox authorization, inbox delivery and deployment remain manual steps.
