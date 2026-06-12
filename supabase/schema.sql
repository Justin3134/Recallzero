-- Recall0 schema
create extension if not exists pgcrypto;

create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade,
  name text not null,
  description text,
  industry text not null,
  sub_industry text,
  products jsonb default '[]'::jsonb,
  ingredients jsonb default '[]'::jsonb,
  claims jsonb default '[]'::jsonb,
  jurisdictions jsonb default '[]'::jsonb,
  employee_count text,
  website text,
  created_at timestamptz default now()
);

create table if not exists regulatory_surface (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies on delete cascade,
  agency text not null,
  jurisdiction text not null,
  relevance text,
  relevance_score float default 0.5,
  priority text default 'medium',
  key_regulations jsonb default '[]'::jsonb,
  watch_urls jsonb default '[]'::jsonb,
  last_crawled timestamptz,
  created_at timestamptz default now()
);

create table if not exists alerts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies on delete cascade,
  title text not null,
  summary text not null,
  agency text not null,
  jurisdiction text,
  severity text not null,
  affected_products jsonb default '[]'::jsonb,
  required_action text,
  deadline text,
  source_url text,
  source_title text,
  raw_tavily_data jsonb,
  is_read boolean default false,
  created_at timestamptz default now()
);

create table if not exists document_scans (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies on delete cascade,
  file_name text,
  file_type text,
  extracted_text text,
  findings jsonb default '[]'::jsonb,
  overall_risk text,
  risk_score int,
  summary text,
  regulations_checked jsonb default '[]'::jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_companies_user on companies(user_id);
create index if not exists idx_surface_company on regulatory_surface(company_id);
create index if not exists idx_alerts_company on alerts(company_id, created_at desc);
create index if not exists idx_scans_company on document_scans(company_id, created_at desc);

-- RLS
alter table companies enable row level security;
alter table regulatory_surface enable row level security;
alter table alerts enable row level security;
alter table document_scans enable row level security;

drop policy if exists "companies_owner" on companies;
create policy "companies_owner" on companies
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "surface_owner" on regulatory_surface;
create policy "surface_owner" on regulatory_surface
  for all using (
    exists (select 1 from companies c where c.id = company_id and c.user_id = auth.uid())
  ) with check (
    exists (select 1 from companies c where c.id = company_id and c.user_id = auth.uid())
  );

drop policy if exists "alerts_owner" on alerts;
create policy "alerts_owner" on alerts
  for all using (
    exists (select 1 from companies c where c.id = company_id and c.user_id = auth.uid())
  ) with check (
    exists (select 1 from companies c where c.id = company_id and c.user_id = auth.uid())
  );

drop policy if exists "scans_owner" on document_scans;
create policy "scans_owner" on document_scans
  for all using (
    exists (select 1 from companies c where c.id = company_id and c.user_id = auth.uid())
  ) with check (
    exists (select 1 from companies c where c.id = company_id and c.user_id = auth.uid())
  );
