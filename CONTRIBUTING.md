# Contributing to FelixIAMinecraft

Thanks for helping! Bug reports, ideas and pull requests are all welcome.

## Reporting a bug

Open an [issue](https://github.com/Muurrcc/FelixIAMinecraft/issues/new/choose) with the bug template. The most useful things to include:

- the output of `scripts\status.ps1`
- the last lines of the matching log in `logs\`
- your Windows version, GPU with its VRAM, and RAM

Never paste `run\rcon_*.txt`, `mindcraft\keys.json` or anything from `data\auth\`: they hold passwords and tokens.

## Setting up

```powershell
git clone https://github.com/<you>/FelixIAMinecraft.git
cd FelixIAMinecraft
powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -Player YourMinecraftName -WithTestServer
```

`-WithTestServer` adds the flat test world and the scripted tester bot used by the tests.

## Making changes

1. Create a branch: `git checkout -b fix/short-name`.
2. Keep the project portable. Everything goes inside the project folder. Don't change PATH, the registry, services, scheduled tasks or the user's `.minecraft`.
3. Keep `mindcraft/` changes small and list them under [Changes to Mindcraft](README.md#changes-to-mindcraft), so upstream updates stay easy.
4. Write PowerShell scripts in **ASCII only**. Windows PowerShell 5.1 reads UTF-8 files without a BOM as ANSI, so a single `—` or `é` can break a script. CI checks this.
5. `.bat` files need CRLF line endings. `.gitattributes` handles it.
6. New downloads go in `scripts/downloads.json` with a `sha256` or `sha512`. CI downloads them and checks the hash.
7. New dashboard text goes in both the `en` and `es` dictionaries in `dashboard/index.html` (and `MSG` in `dashboard/server.mjs`).

## Testing

- **Dashboard or scripts:** run it and check the parts you touched. `DASHBOARD_PORT=8095` starts a second dashboard next to the normal one.
- **Bot or server:** run `scripts\run_fase2_tests.ps1`. It starts the test world on port 25566 and the tester bot checks the companion over chat.
- CI runs on every push and pull request: PowerShell parsing, `node --check`, JSON validity and the download hashes.

## Pull requests

Explain what changed and why, and how you tested it. Screenshots help for dashboard changes. Small focused PRs get merged faster than big mixed ones.

By contributing you agree that your work is released under the [MIT License](LICENSE).
