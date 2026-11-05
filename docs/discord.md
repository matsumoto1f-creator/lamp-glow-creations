# Lamp in Discord

What it does once set up:

- **Your alerts as DMs.** Everything under your bell in Lamp (new file, a file given to you, a
  document added, offer accepted, funded, a merchant starting your link, and the 7:45 "N new leads
  for today") also arrives as a Discord DM from the Lamp bot, with a link back into Lamp.
- **Deal alerts in #deals.** New signed files, accepted offers, funded deals and merchants starting
  a link post to #deals, once per event, with whose file it is.
- **`/lamp`.** `/lamp today` shows your leads by status and files by stage; `/lamp lead ISK` finds
  one of your leads with who to ask for; `/lamp link` connects your Discord to your Lamp login.
  Only you see the answers.

## Setup (about 10 minutes, once)

1. **Make the server.** In Discord: the + on the left, Create My Own, "For a club or community"
   is fine, name it Lamp. Add a text channel `#deals`. Invite the team (Invite People).
2. **Make the app.** At discord.com/developers/applications: New Application, name it Lamp.
   - **General Information:** copy the Public Key into Lovable (Lamp project, More, Settings,
     Secrets) as `DISCORD_PUBLIC_KEY`.
   - **Bot:** Reset Token, copy it straight into Lovable as `DISCORD_BOT_TOKEN`. Don't paste it
     anywhere else.
3. **The #deals channel.** Add its channel id in Lovable as `DISCORD_DEALS_CHANNEL` (not a secret: in
   Discord, the number at the end of the channel's address on discord.com). The bot posts there
   itself; it needs Send Messages, which the invite link below grants. (A channel webhook URL in
   `DISCORD_DEALS_WEBHOOK` also works instead; it is a secret.)
4. **Publish** the site in Lovable so it picks up the three values.
5. **Point Discord at Lamp.** Back in the Developer Portal, General Information, Interactions
   Endpoint URL: `https://getlamp.app/api/discord/interactions`, Save. (Discord checks it right
   then; if it won't save, the public key in step 2 isn't in Lovable yet or the site isn't
   published.)
6. **Add the bot to the server.** Developer Portal, OAuth2, URL Generator: tick `bot` and
   `applications.commands`, then under Bot Permissions tick Send Messages. Open the URL it makes,
   pick the Lamp server, Authorize.
7. **Register /lamp.** Tell Claude; it calls `/api/discord/setup` once (guarded by the engine's
   push secret, which the War Room already holds).
8. **Everyone connects once.** Each person types `/lamp link` in the Lamp server and opens the link
   it gives them while signed in to Lamp. From then on their alerts come to their DMs.

## How it fits together

- `notifications` insert -> trigger `notifications_to_team` (pg_net) -> POST `/api/team/relay` with
  the notification id and a secret from Vault -> the site reads the row, DMs the person if they've
  linked (`profiles.discord_id`), and for deal events claims a row in `team_channel_posts` so #deals
  hears it once (the bot posts to `DISCORD_DEALS_CHANNEL`, or the webhook if that's set instead).
- `/lamp` -> POST `/api/discord/interactions`, checked against `DISCORD_PUBLIC_KEY` (Ed25519) and
  refused if older than five minutes. `/lamp link` hands back a link signed with the Vault secret,
  good for 30 minutes; `/discord-link` finishes it for the signed-in staff member.
- With `DISCORD_BOT_TOKEN` unset the relay does nothing. Turn it off: remove `DISCORD_BOT_TOKEN`.
  Remove it entirely: `drop trigger notifications_to_team on public.notifications;`
