-- NightDesk starter data: default settings, trigger phrases and business hours.
-- Replace inbound_number / main_line_number with your own numbers, then add
-- people in the admin panel.

INSERT INTO system_config (key, value, display_name, field_type, sort_order, group_name, description) VALUES
  ('greeting_business_hours', 'Hello! How can I help you today?', 'Business Hours Greeting', 'textarea', 10, 'Greetings', 'Greeting during business hours'),
  ('greeting_after_hours', 'Hello! We''re currently closed, but I can take a message. How can I help you?', 'After Hours Greeting', 'textarea', 20, 'Greetings', 'Greeting after hours'),
  ('connecting_message', 'Connecting you now.', 'Connecting Message', 'textarea', 10, 'Call Flow Messages', 'Message when transferring to a person'),
  ('message_prompt', 'Okay, what''s your message? Press pound when you''re done.', 'Message Prompt', 'textarea', 20, 'Call Flow Messages', 'Prompt before recording a message'),
  ('message_received', 'Thanks, I''ll make sure {first_name} gets that. Goodbye!', 'Message Received Confirmation', 'textarea', 30, 'Call Flow Messages', 'Confirmation after a message is recorded. Placeholders: {first_name}, {last_name}, {full_name}'),
  ('unknown_person_message', 'I don''t recognize that name. Who would you like to speak with?', 'Unknown Person Message', 'textarea', 40, 'Call Flow Messages', 'Played when the caller names someone not in the system'),
  ('clarify_person_message', 'I found more than one {first_name}. Could you please provide their last name?', 'Duplicate First Name Prompt', 'textarea', 45, 'Call Flow Messages', 'Prompt when a first name matches multiple people. Placeholder: {first_name}'),
  ('business_hours_transfer_prompt', 'Would you like me to transfer you directly, or shall I take a message?', 'Business Hours Transfer Prompt', 'textarea', 50, 'Call Flow Messages', 'Offered when direct transfer is allowed during business hours'),
  ('retry_message_1', 'I''m sorry, I didn''t catch that. Could you please repeat?', 'First Retry Message', 'textarea', 60, 'Call Flow Messages', 'First retry prompt when no speech was heard'),
  ('retry_message_2', 'I''m still having trouble hearing you. Let''s try one more time.', 'Second Retry Message', 'textarea', 70, 'Call Flow Messages', 'Final retry prompt when no speech was heard'),
  ('silent_fallback_message', 'I apologize, I''m having trouble understanding you. Let me connect you.', 'Silent Caller Fallback Message', 'textarea', 80, 'Call Flow Messages', 'Played before transferring a silent caller to the main line (business hours)'),
  ('silence_goodbye_message', 'I didn''t hear anything. Goodbye.', 'Silence Goodbye (After Hours)', 'textarea', 90, 'Call Flow Messages', 'Played when the caller is silent while leaving an emergency message'),
  ('silence_transfer_message', 'I didn''t hear anything. Let me connect you to the main line.', 'Silence Transfer (Business Hours)', 'textarea', 100, 'Call Flow Messages', 'Played when a prompt times out and the call goes to the main line'),
  ('after_hours_no_response_message', 'We''re currently closed and unable to take your call. Please call back during business hours. Goodbye.', 'After Hours No Response Message', 'textarea', 110, 'Call Flow Messages', 'Played before hanging up on a silent caller after hours'),
  ('no_operator_message', 'I''m sorry, there''s no operator available. Who would you like to leave a message for?', 'No Operator Message', 'textarea', 115, 'Call Flow Messages', 'Played when a caller asks for the operator or main line but none is available'),
  ('operator_business_hours_only', 'yes', 'Operator: Business Hours Only', 'boolean', 120, 'Call Flow Messages', 'If yes, operator requests only reach the main line during business hours'),
  ('emergency_transfer_message', 'This sounds urgent, connecting you right away.', 'Emergency Transfer Message', 'textarea', 10, 'Emergency', 'Message when transferring an emergency call'),
  ('emergency_no_oncall_message', 'This is an emergency but no one is available. Please leave a detailed message after the tone.', 'Emergency (No On-Call) Message', 'textarea', 20, 'Emergency', 'Emergency with nobody on call'),
  ('emergency_message_confirmation', 'Your message has been recorded. We''ll get back to you as soon as possible. Goodbye!', 'Emergency Message Confirmation', 'textarea', 30, 'Emergency', 'Confirmation after an emergency message is saved'),
  ('emergency_notify_all', 'yes', 'Notify All on Emergency (yes/no)', 'boolean', 40, 'Emergency', 'Text everyone when an emergency arrives and nobody is on call'),
  ('inbound_number', '+15555550100', 'Inbound Phone Number', 'phone', 10, 'Phone Numbers', 'Your Twilio number (also the SMS sender)'),
  ('main_line_number', '+15555550199', 'Main Line Number', 'phone', 20, 'Phone Numbers', 'Staffed number for operator requests and fallbacks. Leave blank if you have no main line: NightDesk then never offers or transfers to one.'),
  ('technical_error_message', 'I''m sorry, I''m having technical difficulties. Please try again shortly.', 'Technical Error Message', 'textarea', 10, 'System', 'Played before hanging up on an unexpected error'),
  ('technical_error_transfer_message', 'I''m sorry, I''m having technical difficulties. Let me connect you to the main line.', 'Technical Error Transfer', 'textarea', 20, 'System', 'Played before transferring to the main line on an unexpected error'),
  ('verbose_logging', 'no', 'Verbose Logging (yes/no)', 'boolean', 30, 'System', 'Store a step-by-step debug log with each call'),
  ('speech_timeout', '2', 'Speech Timeout (seconds)', 'text', 10, 'Timing', 'Seconds of silence that end the caller''s turn'),
  ('max_retries', '2', 'Max Retries', 'text', 20, 'Timing', 'Silent turns allowed before giving up'),
  ('timezone', 'America/Toronto', 'Timezone', 'text', 30, 'Timing', 'IANA timezone that business hours are written in');

INSERT INTO triggers (trigger_type, phrase, priority, added_by) VALUES
  ('emergency', 'emergency', 100, 'seed'),
  ('emergency', 'urgent', 100, 'seed'),
  ('emergency', 'asap', 100, 'seed'),
  ('emergency', 'right away', 100, 'seed'),
  ('emergency', 'immediately', 100, 'seed'),
  ('emergency', 'need help', 100, 'seed'),
  ('needs_clarification', 'I really need to', 80, 'seed'),
  ('needs_clarification', 'it''s important', 75, 'seed'),
  ('needs_clarification', 'I have to reach', 75, 'seed'),
  ('needs_clarification', 'as soon as possible', 70, 'seed'),
  ('needs_clarification', 'time-sensitive', 70, 'seed'),
  ('routine', 'no rush', 60, 'seed'),
  ('routine', 'could I talk to', 50, 'seed'),
  ('routine', 'I would like to', 50, 'seed'),
  ('routine', 'when you get a chance', 50, 'seed'),
  ('routine', 'whenever you have time', 50, 'seed'),
  ('routine', 'just wanted to', 45, 'seed'),
  ('routine', 'I''m calling about', 45, 'seed'),
  ('operator', 'operator', 1, 'seed'),
  ('operator', 'reception', 1, 'seed'),
  ('operator', 'front desk', 1, 'seed'),
  ('operator', 'main line', 1, 'seed');

-- Monday–Friday 9:00–17:00; closed weekends.
INSERT INTO business_hours (day_of_week, open_time, close_time, is_closed) VALUES
  (0, '00:00', '00:00', true),
  (1, '09:00', '17:00', false),
  (2, '09:00', '17:00', false),
  (3, '09:00', '17:00', false),
  (4, '09:00', '17:00', false),
  (5, '09:00', '17:00', false),
  (6, '00:00', '00:00', true);
