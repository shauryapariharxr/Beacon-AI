# Run Doc — Beacon (Next.js Dev Server)

## How to reproduce the artifacts

This thread's workspace is the main checkout, so no file copying is needed.

1. Install dependencies:
   ```bash
   npm install
   ```
2. Ensure `.env.local` exists with `GROQ_API_KEY`, `JWT_SECRET`, and `DATABASE_URL`.
   If missing, copy from the main checkout (same path — this IS the main checkout).

## How to run the server

Start the Next.js dev server on port 3000 (default):

```powershell
powershell -NoProfile -Command "(Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','dev' -RedirectStandardOutput '.freebuff\preview-a5ef15b7-2ff6-4ad3-947b-01490ce72147.log' -RedirectStandardError '.freebuff\preview-a5ef15b7-2ff6-4ad3-947b-01490ce72147.log.err' -WindowStyle Hidden -PassThru).Id"
```

Verify the process is alive:
```powershell
powershell -NoProfile -Command "Get-Process -Id <pid>"
```

Wait for http://localhost:3000 to respond before registering the preview.
