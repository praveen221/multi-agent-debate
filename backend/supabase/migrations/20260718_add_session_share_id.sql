-- Public share links. Null = private (default). Set to an unguessable slug
-- when the owner shares; cleared on unshare, and a re-share generates a
-- fresh slug so revoked links stay dead.
alter table mad_sessions add column share_id text unique;
