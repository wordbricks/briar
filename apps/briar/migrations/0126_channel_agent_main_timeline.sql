-- Agent replies to ordinary channel and DM messages used to be stored as
-- thread replies. Rebuild their placement from the trigger message so existing
-- conversations match the current rule: root triggers stay in the main
-- timeline, while explicit thread triggers stay in their thread.
update briar_channel_messages
set parent_message_id = (
  select trigger_message.parent_message_id
  from briar_channel_agent_reply_jobs reply_job
  join briar_channel_messages trigger_message
    on trigger_message.id = reply_job.trigger_message_id
   and trigger_message.channel_id = reply_job.channel_id
  where reply_job.reply_message_id = briar_channel_messages.id
    and reply_job.channel_id = briar_channel_messages.channel_id
    and reply_job.status = 'completed'
)
where exists (
  select 1
  from briar_channel_agent_reply_jobs reply_job
  join briar_channel_messages trigger_message
    on trigger_message.id = reply_job.trigger_message_id
   and trigger_message.channel_id = reply_job.channel_id
  where reply_job.reply_message_id = briar_channel_messages.id
    and reply_job.channel_id = briar_channel_messages.channel_id
    and reply_job.status = 'completed'
);
