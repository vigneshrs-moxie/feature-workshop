-- Evidence files (packet 2B): screenshots and videos a laptop uploaded to the private Blob store
-- (site-files), straight from the laptop with a one-time signed upload link for one path. The site
-- serves each only to its owner, through a short-lived signed link. Only the path is kept here.

CREATE TABLE evidence_files (
  runner_id bigint NOT NULL REFERENCES runners (id) ON DELETE CASCADE,
  person_id bigint NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  job text NOT NULL,
  -- The file as the job's evidence names it (evidence/…/shot.png), and where it is in the store.
  file text NOT NULL,
  pathname text NOT NULL,
  content_type text NOT NULL,
  size bigint NOT NULL,
  uploaded_at timestamptz,
  asked_at timestamptz NOT NULL,
  PRIMARY KEY (runner_id, job, file)
);
CREATE INDEX evidence_files_person ON evidence_files (person_id, job);
