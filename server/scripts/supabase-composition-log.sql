-- Run this in the Supabase SQL Editor (one-time setup)
-- Creates the strategy composition history table and trigger.
-- After running this, execute: node server/scripts/seed-composition-log.cjs

CREATE TABLE IF NOT EXISTS strategy_composition_log_c (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id     uuid NOT NULL,
  effective_from  date NOT NULL,
  effective_to    date,          -- NULL means currently active
  holdings        jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comp_log_strategy_date
  ON strategy_composition_log_c (strategy_id, effective_from);

-- Trigger: whenever strategies_c.holdings changes, close the current log
-- entry and open a new one so the full rebalance history is always accurate.
CREATE OR REPLACE FUNCTION _fn_log_strategy_composition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.holdings IS DISTINCT FROM OLD.holdings) THEN
    UPDATE strategy_composition_log_c
       SET effective_to = CURRENT_DATE - 1
     WHERE strategy_id = NEW.id AND effective_to IS NULL;
    INSERT INTO strategy_composition_log_c (strategy_id, effective_from, holdings)
    VALUES (NEW.id, CURRENT_DATE, NEW.holdings);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_strategy_composition ON strategies_c;
CREATE TRIGGER trg_log_strategy_composition
AFTER UPDATE ON strategies_c
FOR EACH ROW EXECUTE FUNCTION _fn_log_strategy_composition();
