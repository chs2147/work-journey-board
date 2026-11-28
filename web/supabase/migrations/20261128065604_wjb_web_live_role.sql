begin;

create role wj_web_live login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
alter role wj_web_live set statement_timeout = '5s';
grant wj_web_app to wj_web_live with inherit true, set false, admin false;

commit;
