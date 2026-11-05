# Lamp in Slack

What it does once set up:

- **Your alerts as DMs.** Everything under your bell in Lamp (new file, a file given to you, a
  document added, offer accepted, funded, a merchant starting your link, and the 7:45 "N new leads
  for today") also arrives as a DM from the Lamp app, with a link back into Lamp.
- **Deal alerts in a channel.** New signed files, accepted offers, funded deals and merchants
  starting a link post to the deals channel, once per event, with whose file it is.
- **`/lamp`.** `/lamp today` shows your leads by status and your files by stage; `/lamp lead ISK`
  or `/lamp 718-555` finds one of your leads with who to ask for. Only you see the answer.

People are matched by email: **use the same email in Slack as you sign in to Lamp with.**

## Setup (about 10 minutes, once)

1. **Make the workspace.** At slack.com/get-started, create a workspace (for example "Lamp") with
   your getlamp.app email. Make a channel for deal alerts, for example `#deals`.
2. **Invite the team** with the emails they use to sign in to Lamp (Stevie, Zeus, Darrell,
   Christian, Derrick, Micheal, and you).
3. **Make the app.** At api.slack.com/apps: Create New App, then From a manifest, pick the
   workspace, and paste `docs/slack-app-manifest.yml`. Create it, then Install to Workspace and
   Allow.
4. **Copy two values into Lovable** (Lamp project, More, Settings, Secrets). Paste each one
   straight from Slack into Lovable; don't send them anywhere else.
   - `SLACK_BOT_TOKEN`: OAuth & Permissions, "Bot User OAuth Token" (starts with xoxb-).
   - `SLACK_SIGNING_SECRET`: Basic Information, App Credentials, "Signing Secret".
5. **The deals channel.** In Slack, open `#deals`, type `/invite @Lamp`. Then open the channel's
   name at the top, scroll to the bottom of About, and copy the Channel ID (starts with C). Add it in
   Lovable as `SLACK_DEALS_CHANNEL`. It isn't a secret.
6. **Database.** Run `supabase/migrations/20261105150000_slack_relay.sql` once (Lovable, Database,
   SQL editor). It makes the relay secret inside the database; nothing to copy.
7. **Try it.** In Slack, type `/lamp help`, then `/lamp today`.

## How it fits together

- `notifications` insert -> trigger `notifications_to_slack` -> POST `/api/slack/relay` with the
  notification id and a secret from Vault -> the site reads the row, DMs the person (Slack
  `users.lookupByEmail`), and for deal events claims a row in `slack_channel_posts` so the channel
  hears it once.
- `/lamp` -> POST `/api/slack/command`, checked against `SLACK_SIGNING_SECRET` (and refused if
  older than five minutes), matched to a Lamp login by Slack email; reps see only their own leads,
  admins everyone's.
- With `SLACK_BOT_TOKEN` unset, the relay does nothing and `/lamp` says it isn't connected.
- Turn it off: remove `SLACK_BOT_TOKEN` in Lovable. Remove it entirely:
  `drop trigger notifications_to_slack on public.notifications;`
