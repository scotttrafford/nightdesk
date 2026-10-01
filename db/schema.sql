-- NightDesk database schema (PostgreSQL 13+)
-- Usage: psql -d nightdesk -f db/schema.sql && psql -d nightdesk -f db/seed.sql

-- People callers can ask for. `name` is the first name; callers may also use
-- any of `alternate_names` (nicknames, common mis-transcriptions).
CREATE TABLE people (
    id                      serial PRIMARY KEY,
    name                    varchar(100) NOT NULL,
    last_name               varchar(100),
    alternate_names         text[],
    cell_phone              varchar(20),            -- E.164, e.g. +15555550100
    email                   varchar(100),
    -- How routine calls reach this person (see routineHandling in src/services/routing.js):
    --   business_hours  offer to connect while open, message when closed
    --   always_direct   connect immediately, any time
    --   always_screen   always offer "connect or leave a message?"
    --   message_only    never connect, emergencies included
    routing_preference      varchar(20) NOT NULL DEFAULT 'business_hours'
        CHECK (routing_preference IN ('business_hours', 'always_direct', 'always_screen', 'message_only')),
    notification_preference varchar(10) DEFAULT 'sms'
        CHECK (notification_preference IN ('sms', 'email', 'both')),
    is_default_oncall       boolean NOT NULL DEFAULT false, -- used when on_call_schedule has no entry
    active                  boolean DEFAULT true,
    notes                   text,
    created_at              timestamp DEFAULT now()
);

CREATE TABLE call_logs (
    id                  serial PRIMARY KEY,
    call_sid            varchar(100),
    caller_number       varchar(20),
    call_timestamp      timestamp DEFAULT now(),
    detected_person     varchar(100),
    emergency_detected  boolean,
    routed_to_number    varchar(20),
    full_transcript     text,
    message_left        text,
    debug_log           text,                       -- populated when verbose_logging = yes
    ai_inferred         boolean DEFAULT false,      -- HARD urgency without an exact trigger phrase
    ai_reasoning        text,
    caller_phrase       text,
    similar_to_trigger  varchar(100),
    inference_validated boolean                     -- set by an admin reviewing inferred emergencies
);

CREATE INDEX idx_unreviewed_inferences ON call_logs (ai_inferred, inference_validated)
    WHERE ai_inferred = true AND inference_validated IS NULL;

-- Phrases that steer the AI's urgency classification.
--   emergency           → HARD: transfer immediately
--   needs_clarification → SOFT: ask "What seems to be the problem?" first
--   routine             → explicitly not urgent (overrides alarming content)
--   operator            → skip the AI and route to the main line
CREATE TABLE triggers (
    id                   serial PRIMARY KEY,
    trigger_type         varchar(50) NOT NULL,
    phrase               text NOT NULL,
    priority             integer DEFAULT 0,
    active               boolean DEFAULT true,
    times_matched        integer DEFAULT 0,
    learned_from_call_id integer REFERENCES call_logs(id),
    added_at             timestamp DEFAULT now(),
    added_by             varchar(100),
    notes                text
);

CREATE INDEX idx_triggers_active ON triggers (active) WHERE active = true;

-- Weekly opening hours, in the business's local time (system_config: timezone).
CREATE TABLE business_hours (
    id          serial PRIMARY KEY,
    day_of_week integer NOT NULL UNIQUE,            -- 0 = Sunday … 6 = Saturday
    open_time   time NOT NULL,
    close_time  time NOT NULL,
    is_closed   boolean DEFAULT false,
    notes       text
);

-- Who takes after-hours emergencies, by date range.
CREATE TABLE on_call_schedule (
    id             serial PRIMARY KEY,
    person_id      integer NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    start_datetime timestamp NOT NULL,
    end_datetime   timestamp NOT NULL,
    notes          text,
    created_at     timestamp DEFAULT now()
);

CREATE INDEX idx_oncall_dates ON on_call_schedule (start_datetime, end_datetime);

-- Call-flow settings, editable in the admin panel without a restart.
-- display_name / field_type / sort_order / group_name drive the admin form.
CREATE TABLE system_config (
    key          varchar(100) PRIMARY KEY,
    value        text NOT NULL,
    description  text,
    display_name varchar(100),
    field_type   varchar(20) DEFAULT 'text',        -- text | textarea | boolean | phone
    sort_order   integer DEFAULT 0,
    group_name   varchar(50),
    updated_at   timestamp DEFAULT now()
);

-- Admin panel accounts and activity log.
CREATE TABLE users (
    id            serial PRIMARY KEY,
    username      varchar(50) NOT NULL UNIQUE,
    email         varchar(100),
    password_hash varchar(255) NOT NULL,            -- PHP password_hash()
    full_name     varchar(100),
    role          varchar(20) NOT NULL DEFAULT 'viewer', -- viewer | editor | admin
    active        boolean DEFAULT true,
    created_at    timestamp DEFAULT now(),
    last_login    timestamp,
    created_by    integer REFERENCES users(id)
);

CREATE TABLE audit_log (
    id          serial PRIMARY KEY,
    user_id     integer REFERENCES users(id),
    username    varchar(50),
    action      varchar(50) NOT NULL,
    table_name  varchar(50),
    record_id   integer,
    old_value   text,
    new_value   text,
    ip_address  varchar(45),
    created_at  timestamp DEFAULT now()
);

CREATE INDEX idx_audit_table     ON audit_log (table_name, record_id);
CREATE INDEX idx_audit_timestamp ON audit_log (created_at);
CREATE INDEX idx_audit_user      ON audit_log (user_id);
