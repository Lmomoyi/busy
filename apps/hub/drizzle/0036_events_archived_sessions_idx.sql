-- Every page load asks, per bot, whether it has an archived conversation, and the archive
-- lists a bot's sessions by their consumed deliveries. Without this both read the whole
-- events table: 68 ms and 31 ms on 400,000 events, 7 ms and 4 ms with it. The index only
-- holds one row per message the user sent (240 kB for those 400,000 events).
CREATE INDEX IF NOT EXISTS events_archived_sessions_idx
  ON public.events (bot_id, session_id)
  WHERE type = 'delivery.consumed';
