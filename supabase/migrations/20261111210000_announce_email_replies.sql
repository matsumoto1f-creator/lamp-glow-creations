-- Announce Staff > Email replies to the admins (Asad's rule: a change people see ships with a
-- "What's new" notification). No table or rule changes: replies are engine leads under the source
-- "email-reply", written by /api/engine/reply with the engine's shared secret, and the existing
-- engine_leads rules decide who sees them (a rep their own, an admin all). Safe to run twice: it
-- only adds one more notification each time.
select public.announce(
  'New: email replies',
  'When someone answers a Lamp email, it lands in Staff > Email replies with their own words. The rep who sent the email and every admin get a notification, so nothing the sender misses goes unseen.',
  '/staff?view=replies',
  'admin'
);
