-- LOCAL TEST ONLY: simulates the trusted Auth gateway; does not verify JWTs.
CREATE ROLE wjb_poc_owner NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE authenticated NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE anon NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
REVOKE ALL ON FUNCTION auth.uid(), auth.jwt() FROM PUBLIC;
GRANT USAGE ON SCHEMA auth TO wjb_poc_owner, authenticated;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.jwt() TO wjb_poc_owner, authenticated;
CREATE SCHEMA wjb_v2 AUTHORIZATION wjb_poc_owner;
