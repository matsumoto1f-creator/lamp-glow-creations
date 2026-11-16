-- 2026-11-16: Staff > Email engine now says, in words, which day it is talking about, what went out, what
-- waits for approval and when the next emails are written. No table or function changes; this only tells
-- admins once. Safe to run twice (the where-not-exists keeps it to one announcement).
select public.announce(
  'Admins: the email engine page now explains itself',
  'Staff > Email engine opens with one line for today: how many emails went out, how many wait for your approval, and when the next ones are written. Each mailbox says "Done for today", "Waiting for your approval" or why it is held, and its bar now shows clearly how much of today''s limit is used. Also new: an approved email now goes out at 9:30 AM where that business is, never earlier, so a California business is not emailed at 6 AM. The page shows these as "Approved, going out" with the time the last one goes.',
  '/staff?view=autopilot',
  'admin'
)
where not exists (
  select 1 from public.notifications
  where kind = 'announcement' and title = 'Admins: the email engine page now explains itself'
);
