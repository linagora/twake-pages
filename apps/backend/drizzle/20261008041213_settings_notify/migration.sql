-- Sent on commit, to the replicas streaming the person's settings.
CREATE FUNCTION notify_settings_change() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_notify('settings_changes', NEW.email || ' ' || NEW.version);
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE TRIGGER user_settings_notify_change AFTER INSERT OR UPDATE OF version ON user_settings
  FOR EACH ROW
  EXECUTE FUNCTION notify_settings_change();
