alter table schedules add column if not exists playback_mode text not null default 'loop';
alter table schedules add column if not exists play_start text;

