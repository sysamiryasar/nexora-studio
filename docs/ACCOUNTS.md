# Accounts, sign-in and the AI editor

NEXORA has no cloud service. **An account lives on the computer where it was created** and does not follow you to another PC. Its job is to separate people's libraries, protect the app with a sign-in and 2FA, and hold personal settings.

The sign-in protects the app. Project folders on disk are ordinary files and are not encrypted.

## One account for every computer (Google Sheet, recommended)
This build is connected to its server through `electron/gas.config.json`, and every copy of the app uses it. The setup link is hidden while that file exists. To change servers, edit that file. After changing the script in Apps Script, use Deploy > Manage deployments > edit > New version so the address stays the same.

1. Create a Google Sheet. Open **Extensions > Apps Script**.
2. In NEXORA press **Sign in › Connect online accounts › Copy server script**. Replace everything in the Apps Script editor with it and save.
3. **Deploy > New deployment > Web app**. Execute as: **Me**. Who has access: **Anyone**. Approve the permissions.
4. Paste the address ending in `/exec` into NEXORA and press Connect. To ship it to everyone, put `{ "url": "…/exec" }` in `electron/gas.config.json`.

Never share the Sheet: it holds e-mail addresses and 2FA secrets. Passwords are not stored in it. After editing the script, deploy a new version. E-mails come from your Google account, and the script stops at 80 a day.

## One account for every computer (Supabase)
The app is ready for online accounts. It switches to them as soon as `electron/cloud.config.json` exists:

```json
{ "url": "https://YOUR-PROJECT.supabase.co", "publishableKey": "sb_publishable_…" }
```

Use only the publishable (anon) key. The service/secret key must never go in the app.

In the Supabase dashboard:
1. **Authentication › URL configuration:** add `http://127.0.0.1:*/**` to the redirect URLs.
2. **Authentication › Providers:** turn on Email, Google, Azure (Microsoft) and GitHub, and paste the IDs from those companies. Each provider's callback URL is shown on that page.
3. **Authentication › Emails:** set up custom SMTP. Change the "Reset password" and "Magic link" templates to include `{{ .Token }}`, because the app asks for the code.
4. **Multi-factor:** keep TOTP enabled.
5. Deploy account deletion once: `supabase functions deploy delete-account` (source in `supabase/functions/`).

Online mode differs in small ways: password reset is by e-mailed code, there are no recovery codes, connecting a second provider to an existing account is not available yet, and the profile photo stays on each computer. Name, role and default project settings follow the account.

This has been tested against a local stand-in for Supabase's API, not a real project yet.

## Sign-in options today
The sign-in screen is e-mail and password only. Google and Microsoft are switched off in the interface (`ENABLED` in `nexora/app/account.js`). GitHub stays off until it has a Client ID: create an OAuth App at https://github.com/settings/developers, tick **Enable Device Flow**, then paste the Client ID under **Profile › Connected accounts › GitHub › Set up**. The GitHub button then appears on the sign-in screen.

## What works with no setup
- E-mail and password accounts (scrypt, lockout after repeated failures)
- Two-factor authentication with any authenticator app, plus 10 single-use recovery codes
- Password reset with a recovery code
- Profile: name, role, photo, default resolution and frame rate, activity log, data download, account deletion

The account file is `%APPDATA%\nexora-studio\accounts\accounts.db`, encrypted with Windows DPAPI through Electron `safeStorage`.

## Google, Microsoft and GitHub
These companies only allow sign-in for apps registered with them. Registration is free, and whoever distributes NEXORA does it once. Then paste the IDs in **Sign in › Set up sign-in providers**, or ship them in `electron/auth.config.json`:

```json
{ "google": { "clientId": "…", "clientSecret": "…" }, "microsoft": { "clientId": "…" }, "github": { "clientId": "…" } }
```

| Provider | Where | Settings |
|---|---|---|
| Google | [Cloud Console › Credentials](https://console.cloud.google.com/apis/credentials) | Create an OAuth client of type **Desktop app**. Configure the consent screen with scopes `openid`, `email`, `profile`. A desktop client's secret is not confidential by design. Publish the consent screen, or add test users, before others can sign in. |
| Microsoft | [Entra › App registrations](https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) | New registration, "Accounts in any organizational directory and personal Microsoft accounts". Add platform **Mobile and desktop applications** with redirect URI `http://localhost`. |
| GitHub | [Developer settings › OAuth Apps](https://github.com/settings/developers) | New OAuth App, any callback URL, tick **Enable Device Flow**. |
| Single sign-on | Your identity provider | Any OpenID Connect provider. Register a native/public app with a loopback redirect, then enter the issuer URL and Client ID. |

An external login only opens the account it was connected to. Accounts are never merged because their e-mail addresses match. To add Google to a password account, sign in with the password and use **Profile › Connected accounts**.

## E-mail features
Verification e-mails, sign-in codes, e-mailed 2FA codes and e-mailed password resets need an SMTP account, set under **Profile › E-mail delivery**. Use a Gmail or Outlook app password, or a service like SendGrid. NEXORA refuses to send through a remote server that does not offer TLS.

## AI editor
The panel opens with **AI Editor** in the top bar. It runs on Claude through Anthropic's official SDK and needs your own Anthropic API key from [console.anthropic.com](https://console.anthropic.com/settings/keys). Usage is billed to that key.

- The key is encrypted with DPAPI and stays in Electron's main process.
- Nothing is sent until you press Send. Then your request, project structure, clip names, any frame the AI views and any transcript it reads go to Anthropic.
- It edits through about 30 tools: cut, trim, ripple delete, move, speed, transform and keyframes, audio, titles, colour adjustments, the effects library, transitions, markers, silence removal, scene detection, transcription, captions and project resolution.
- Every edit is on the undo stack, and **Undo last request** reverts a whole request.
- It can look at rendered frames, but it cannot generate new images, video or audio, and it will not start a final export by itself. It can open the export dialog.
- Default model: Claude Opus 5.5. Sonnet 5.5 and Haiku 5.5 are in the panel's model menu.
- On Opus and Sonnet, if a safety check declines a request, Anthropic re-runs it on its recommended fallback model.
