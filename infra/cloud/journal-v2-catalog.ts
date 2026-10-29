/** Passive compiled format only. No store, interpreter, namespace, readiness or execution capability. */
export const cloudJournalV2Catalog = Object.freeze({
  format: 1 as const,
  kind: "synkies-cloud-journal-v2-catalog" as const,
  applicationId: 0x53594a31,
  userVersion: 2 as const,
  pageSize: 4096,
  maxPages: 512,
  databaseLimit: 2097152,
  rollbackLimit: 4194304,
  observationJsonLimit: 1984,
  ddl: `CREATE TABLE journal_genesis(id INTEGER PRIMARY KEY CHECK(id=1), scope_sha256 TEXT NOT NULL CHECK(length(CAST(scope_sha256 AS BLOB))=64), genesis_sha256 TEXT NOT NULL CHECK(length(CAST(genesis_sha256 AS BLOB))=64), genesis_json TEXT NOT NULL CHECK(length(CAST(genesis_json AS BLOB)) BETWEEN 1 AND 1572864)) STRICT;
CREATE TABLE journal_state(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL CHECK(revision BETWEEN 0 AND 9007199254740991)) STRICT;
CREATE TABLE journal_intents(stack_kind TEXT PRIMARY KEY NOT NULL CHECK(stack_kind IN ('artifacts','guard','sentinel','data')), client_request_token TEXT NOT NULL CHECK(length(CAST(client_request_token AS BLOB)) BETWEEN 1 AND 128), intent_sha256 TEXT NOT NULL CHECK(length(CAST(intent_sha256 AS BLOB))=64), intent_json TEXT NOT NULL CHECK(length(CAST(intent_json AS BLOB)) BETWEEN 1 AND 4096), request_sha256 TEXT NOT NULL CHECK(length(CAST(request_sha256 AS BLOB))=64), unsigned_sha256 TEXT NOT NULL CHECK(length(CAST(unsigned_sha256 AS BLOB))=64), request_json TEXT NOT NULL CHECK(length(CAST(request_json AS BLOB)) BETWEEN 1 AND 16384), prepared_revision INTEGER NOT NULL CHECK(prepared_revision BETWEEN 1 AND 9007199254740991)) STRICT;
CREATE TABLE journal_fences(stack_kind TEXT PRIMARY KEY NOT NULL CHECK(stack_kind IN ('artifacts','guard','sentinel','data')) REFERENCES journal_intents(stack_kind), client_request_token TEXT NOT NULL CHECK(length(CAST(client_request_token AS BLOB)) BETWEEN 1 AND 128), intent_sha256 TEXT NOT NULL CHECK(length(CAST(intent_sha256 AS BLOB))=64), request_sha256 TEXT NOT NULL CHECK(length(CAST(request_sha256 AS BLOB))=64), unsigned_sha256 TEXT NOT NULL CHECK(length(CAST(unsigned_sha256 AS BLOB))=64), fenced_revision INTEGER NOT NULL CHECK(fenced_revision BETWEEN 1 AND 9007199254740991)) STRICT;
CREATE TABLE journal_observations(observation_id INTEGER PRIMARY KEY CHECK(observation_id BETWEEN 1 AND 96), category TEXT NOT NULL CHECK(category IN ('ordinary','cleanup')), observation_json TEXT NOT NULL CHECK(length(CAST(observation_json AS BLOB)) BETWEEN 1 AND 1984), recorded_revision INTEGER NOT NULL CHECK(recorded_revision BETWEEN 1 AND 9007199254740991)) STRICT;
CREATE TABLE journal_teardown(id INTEGER PRIMARY KEY CHECK(id=1), teardown_json TEXT NOT NULL CHECK(length(CAST(teardown_json AS BLOB)) BETWEEN 1 AND 1984), recorded_revision INTEGER NOT NULL CHECK(recorded_revision BETWEEN 1 AND 9007199254740991)) STRICT;
CREATE UNIQUE INDEX journal_intent_token ON journal_intents(client_request_token);
CREATE INDEX journal_observation_category ON journal_observations(category);
CREATE TRIGGER journal_genesis_insert_once BEFORE INSERT ON journal_genesis WHEN EXISTS(SELECT 1 FROM journal_genesis) BEGIN SELECT RAISE(ABORT,'Cloud journal write unavailable'); END;
CREATE TRIGGER journal_genesis_no_update BEFORE UPDATE ON journal_genesis BEGIN SELECT RAISE(ABORT,'Cloud journal write unavailable'); END;
CREATE TRIGGER journal_genesis_no_delete BEFORE DELETE ON journal_genesis BEGIN SELECT RAISE(ABORT,'Cloud journal write unavailable'); END;
CREATE TRIGGER journal_state_insert_once BEFORE INSERT ON journal_state WHEN EXISTS(SELECT 1 FROM journal_state) BEGIN SELECT RAISE(ABORT,'Cloud journal write unavailable'); END;
CREATE TRIGGER journal_state_step BEFORE UPDATE ON journal_state WHEN NEW.id!=OLD.id OR NEW.revision!=OLD.revision+1 BEGIN SELECT RAISE(ABORT,'Cloud journal write unavailable'); END;
CREATE TRIGGER journal_state_no_delete BEFORE DELETE ON journal_state BEGIN SELECT RAISE(ABORT,'Cloud journal write unavailable'); END;
CREATE TRIGGER journal_intents_insert_once BEFORE INSERT ON journal_intents WHEN EXISTS(SELECT 1 FROM journal_intents WHERE stack_kind=NEW.stack_kind OR client_request_token=NEW.client_request_token) BEGIN SELECT RAISE(ABORT,'Cloud journal write unavailable'); END;
CREATE TRIGGER journal_intents_no_update BEFORE UPDATE ON journal_intents BEGIN SELECT RAISE(ABORT,'Cloud journal write unavailable'); END;
CREATE TRIGGER journal_intents_no_delete BEFORE DELETE ON journal_intents BEGIN SELECT RAISE(ABORT,'Cloud journal write unavailable'); END;
CREATE TRIGGER journal_fences_insert_bound BEFORE INSERT ON journal_fences WHEN EXISTS(SELECT 1 FROM journal_fences WHERE stack_kind=NEW.stack_kind) OR NOT EXISTS(SELECT 1 FROM journal_intents WHERE stack_kind=NEW.stack_kind AND client_request_token=NEW.client_request_token AND intent_sha256=NEW.intent_sha256 AND request_sha256=NEW.request_sha256 AND unsigned_sha256=NEW.unsigned_sha256 AND prepared_revision<NEW.fenced_revision) BEGIN SELECT RAISE(ABORT,'Cloud journal write unavailable'); END;
CREATE TRIGGER journal_fences_no_update BEFORE UPDATE ON journal_fences BEGIN SELECT RAISE(ABORT,'Cloud journal write unavailable'); END;
CREATE TRIGGER journal_fences_no_delete BEFORE DELETE ON journal_fences BEGIN SELECT RAISE(ABORT,'Cloud journal write unavailable'); END;
CREATE TRIGGER journal_observations_insert_capacity BEFORE INSERT ON journal_observations WHEN EXISTS(SELECT 1 FROM journal_observations WHERE observation_id=NEW.observation_id) OR NEW.observation_id!=COALESCE((SELECT MAX(observation_id) FROM journal_observations),0)+1 OR (NEW.category='ordinary' AND (SELECT COUNT(*) FROM journal_observations WHERE category='ordinary')>=64) OR (NEW.category='cleanup' AND (SELECT COUNT(*) FROM journal_observations WHERE category='cleanup')>=32) BEGIN SELECT RAISE(ABORT,'Cloud journal write unavailable'); END;
CREATE TRIGGER journal_observations_no_update BEFORE UPDATE ON journal_observations BEGIN SELECT RAISE(ABORT,'Cloud journal write unavailable'); END;
CREATE TRIGGER journal_observations_no_delete BEFORE DELETE ON journal_observations BEGIN SELECT RAISE(ABORT,'Cloud journal write unavailable'); END;
CREATE TRIGGER journal_teardown_insert_once BEFORE INSERT ON journal_teardown WHEN EXISTS(SELECT 1 FROM journal_teardown) BEGIN SELECT RAISE(ABORT,'Cloud journal write unavailable'); END;
CREATE TRIGGER journal_teardown_no_update BEFORE UPDATE ON journal_teardown BEGIN SELECT RAISE(ABORT,'Cloud journal write unavailable'); END;
CREATE TRIGGER journal_teardown_no_delete BEFORE DELETE ON journal_teardown BEGIN SELECT RAISE(ABORT,'Cloud journal write unavailable'); END;
`,
});
