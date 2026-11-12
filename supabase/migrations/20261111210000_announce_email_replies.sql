-- Announce Staff > Email replies (Asad's rule: a change people see ships with a "What's new"
-- notification). No table or rule changes: replies are engine leads under the source
-- "email-reply", written by /api/engine/reply with the engine's shared secret, and the existing
-- engine_leads rules decide who sees them (a rep their own, an admin all). Two notes: everyone on
-- staff, then admins. Safe to run twice: it only adds the notes again.
select public.announce(
  'New: email replies',
  'When someone answers an email you sent from Lamp, it lands in Staff > Email replies with their own words, and you get a notification.',
  '/staff?view=replies',
  'all'
);
select public.announce(
  'Admins: every email reply',
  'You see every reply to every Lamp email in Staff > Email replies, and you are told about each one, so nothing the sender misses goes unseen. Opt-outs are filed as do not call.',
  '/staff?view=replies',
  'admin'
);
