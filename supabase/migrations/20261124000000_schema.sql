-- Tenantry schema: organizations (tenants), members, invitations, projects
-- (the example tenant data), billing state mirrored from Stripe, and an
-- append-only audit log.
--
-- The rules that matter for security live in the database:
--   * row-level security on every table in the public schema
--   * plan limits enforced by triggers, so a direct API call can't skip them
--   * audit rows written by triggers, so app code can't forget to write them

create type public.org_role as enum ('admin', 'member');

-- ---------------------------------------------------------------------------
-- Plans. The only place limits are defined. The app reads this table for
-- display; triggers read it for enforcement. null means unlimited.
-- ---------------------------------------------------------------------------
create table public.plans (
  id text primary key,
  name text not null,
  monthly_price_cents integer not null,
  max_members integer,
  max_projects integer,
  sort integer not null
);

insert into public.plans (id, name, monthly_price_cents, max_members, max_projects, sort) values
  ('free',     'Free',     0,    2,    3,    0),
  ('pro',      'Pro',      2900, 10,   25,   1),
  ('business', 'Business', 9900, null, null, 2);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text not null,
  full_name text check (char_length(full_name) <= 100),
  is_platform_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);

create table public.memberships (
  org_id uuid not null references public.organizations on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  role public.org_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index memberships_user_id_idx on public.memberships (user_id);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations on delete cascade,
  email text not null check (email = lower(email) and email like '%_@_%'),
  role public.org_role not null default 'member',
  -- Only the SHA-256 of the token is stored. The raw token exists in the
  -- invite link and nowhere else, so a database leak can't be used to join.
  token_hash text not null unique,
  invited_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users on delete set null,
  revoked_at timestamptz
);
create unique index invitations_one_open_per_email
  on public.invitations (org_id, email)
  where accepted_at is null and revoked_at is null;

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  created_by uuid references public.profiles on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_org_id_created_at_idx on public.projects (org_id, created_at desc);

-- One row per organization. plan_id is the plan the org is entitled to right
-- now, which is not always the plan it pays for (a canceled or unpaid
-- subscription falls back to free). Only the webhook handler writes here.
create table public.subscriptions (
  org_id uuid primary key references public.organizations on delete cascade,
  plan_id text not null default 'free' references public.plans,
  status text not null default 'none',
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  stripe_price_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  payment_failed_at timestamptz,
  -- created time of the newest Stripe subscription event applied; older
  -- events that arrive late are recorded but not applied
  last_stripe_event_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Every Stripe event id we have processed. The primary key is what makes a
-- redelivered event a no-op.
create table public.stripe_events (
  id text primary key,
  type text not null,
  org_id uuid references public.organizations on delete set null,
  stripe_created_at timestamptz not null,
  received_at timestamptz not null default now(),
  outcome text not null
);
create index stripe_events_received_at_idx on public.stripe_events (received_at desc);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations on delete cascade,
  actor_id uuid references auth.users on delete set null,
  actor_email text,
  action text not null,
  target_type text,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_org_id_created_at_idx on public.audit_logs (org_id, created_at desc, id desc);

-- ---------------------------------------------------------------------------
-- Membership helpers. security definer so policies on other tables can call
-- them without recursing into the memberships policies.
-- ---------------------------------------------------------------------------
create function public.is_org_member(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships
    where org_id = p_org_id and user_id = (select auth.uid())
  );
$$;

create function public.is_org_admin(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships
    where org_id = p_org_id and user_id = (select auth.uid()) and role = 'admin'
  );
$$;

create function public.shares_org_with(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.memberships mine
    join public.memberships theirs on theirs.org_id = mine.org_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = p_user_id
  );
$$;

-- Internal: write one audit row. Not callable by API users.
create function public.write_audit(
  p_org_id uuid,
  p_action text,
  p_target_type text default null,
  p_target_id text default null,
  p_metadata jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
begin
  -- Rows deleted by an org-level cascade have nothing to attach to.
  if not exists (select 1 from public.organizations where id = p_org_id) then
    return;
  end if;
  insert into public.audit_logs (org_id, actor_id, actor_email, action, target_type, target_id, metadata)
  values (
    p_org_id,
    v_actor,
    (select email from public.profiles where id = v_actor),
    p_action,
    p_target_type,
    p_target_id,
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

-- Plan limits for an org, falling back to free if the row is missing.
create function public.org_limits(p_org_id uuid, out plan_id text, out max_members integer, out max_projects integer)
language sql stable security definer set search_path = '' as $$
  select p.id, p.max_members, p.max_projects
  from public.plans p
  where p.id = coalesce((select s.plan_id from public.subscriptions s where s.org_id = p_org_id), 'free');
$$;

-- ---------------------------------------------------------------------------
-- New auth user -> profile
-- ---------------------------------------------------------------------------
create function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, lower(new.email), nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Plan limit enforcement. An advisory lock per org serializes concurrent
-- inserts, so two requests racing for the last slot can't both win.
-- ---------------------------------------------------------------------------
create function public.enforce_project_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_limits record;
  v_count integer;
begin
  -- Triggers run before RLS checks the new row. Let RLS reject outsiders
  -- first, so they get "permission denied" and learn nothing about the plan.
  if auth.uid() is not null and not public.is_org_member(new.org_id) then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('projects:' || new.org_id::text, 0));
  select * into v_limits from public.org_limits(new.org_id);
  if v_limits.max_projects is null then
    return new;
  end if;
  select count(*) into v_count from public.projects where org_id = new.org_id;
  if v_count >= v_limits.max_projects then
    raise exception 'plan_limit_reached'
      using detail = 'projects', hint = format('The %s plan allows %s projects.', v_limits.plan_id, v_limits.max_projects);
  end if;
  return new;
end;
$$;

create trigger enforce_project_limit
  before insert on public.projects
  for each row execute function public.enforce_project_limit();

-- Seats: members plus open invitations can't exceed the plan.
create function public.enforce_seat_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_limits record;
  v_used integer;
begin
  -- Same as above: non-admins can't invite, so let RLS say so. Membership
  -- rows are only ever inserted by our own functions, never directly.
  if tg_table_name = 'invitations' and auth.uid() is not null and not public.is_org_admin(new.org_id) then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('seats:' || new.org_id::text, 0));
  select * into v_limits from public.org_limits(new.org_id);
  if v_limits.max_members is null then
    return new;
  end if;

  select count(*) into v_used from public.memberships where org_id = new.org_id;
  if tg_table_name = 'invitations' then
    v_used := v_used + (
      select count(*) from public.invitations
      where org_id = new.org_id and accepted_at is null and revoked_at is null and expires_at > now()
    );
  end if;

  if v_used >= v_limits.max_members then
    raise exception 'plan_limit_reached'
      using detail = 'members', hint = format('The %s plan allows %s members.', v_limits.plan_id, v_limits.max_members);
  end if;
  return new;
end;
$$;

create trigger enforce_seat_limit
  before insert on public.memberships
  for each row execute function public.enforce_seat_limit();

create trigger enforce_seat_limit
  before insert on public.invitations
  for each row execute function public.enforce_seat_limit();

-- An org always keeps at least one admin.
create function public.keep_one_admin()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role <> 'admin' then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and new.role = 'admin' then
    return new;
  end if;
  if not exists (select 1 from public.organizations where id = old.org_id) then
    return coalesce(new, old);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('seats:' || old.org_id::text, 0));
  if not exists (
    select 1 from public.memberships
    where org_id = old.org_id and role = 'admin' and user_id <> old.user_id
  ) then
    raise exception 'last_admin'
      using hint = 'Make someone else an admin first.';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger keep_one_admin
  before update of role or delete on public.memberships
  for each row execute function public.keep_one_admin();

create function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger touch_updated_at before update on public.projects
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Audit triggers
-- ---------------------------------------------------------------------------
create function public.audit_projects()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_changes jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    perform public.write_audit(new.org_id, 'project.created', 'project', new.id::text, jsonb_build_object('name', new.name));
  elsif tg_op = 'UPDATE' then
    if new.name is distinct from old.name then
      v_changes := v_changes || jsonb_build_object('name', jsonb_build_object('from', old.name, 'to', new.name));
    end if;
    if new.description is distinct from old.description then
      v_changes := v_changes || jsonb_build_object('description', jsonb_build_object('changed', true));
    end if;
    if v_changes <> '{}'::jsonb then
      perform public.write_audit(new.org_id, 'project.updated', 'project', new.id::text,
        jsonb_build_object('name', new.name, 'changes', v_changes));
    end if;
  else
    perform public.write_audit(old.org_id, 'project.deleted', 'project', old.id::text, jsonb_build_object('name', old.name));
  end if;
  return null;
end;
$$;

create trigger audit_projects after insert or update or delete on public.projects
  for each row execute function public.audit_projects();

create function public.audit_memberships()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
begin
  select email into v_email from public.profiles where id = coalesce(new.user_id, old.user_id);
  if tg_op = 'INSERT' then
    perform public.write_audit(new.org_id, 'member.added', 'user', new.user_id::text,
      jsonb_build_object('email', v_email, 'role', new.role));
  elsif tg_op = 'UPDATE' then
    if new.role is distinct from old.role then
      perform public.write_audit(new.org_id, 'member.role_changed', 'user', new.user_id::text,
        jsonb_build_object('email', v_email, 'from', old.role, 'to', new.role));
    end if;
  else
    perform public.write_audit(old.org_id,
      case when old.user_id = auth.uid() then 'member.left' else 'member.removed' end,
      'user', old.user_id::text, jsonb_build_object('email', v_email, 'role', old.role));
  end if;
  return null;
end;
$$;

create trigger audit_memberships after insert or update or delete on public.memberships
  for each row execute function public.audit_memberships();

create function public.audit_invitations()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform public.write_audit(new.org_id, 'invitation.created', 'invitation', new.id::text,
      jsonb_build_object('email', new.email, 'role', new.role));
  elsif new.revoked_at is not null and old.revoked_at is null then
    perform public.write_audit(new.org_id, 'invitation.revoked', 'invitation', new.id::text,
      jsonb_build_object('email', new.email));
  end if;
  return null;
end;
$$;

create trigger audit_invitations after insert or update on public.invitations
  for each row execute function public.audit_invitations();

create function public.audit_organizations()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.name is distinct from old.name then
    perform public.write_audit(new.id, 'organization.renamed', 'organization', new.id::text,
      jsonb_build_object('from', old.name, 'to', new.name));
  end if;
  return null;
end;
$$;

create trigger audit_organizations after update on public.organizations
  for each row execute function public.audit_organizations();

-- The audit log is append-only. No role, including service_role, may edit it.
create function public.audit_logs_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'audit_logs is append-only';
end;
$$;

create trigger audit_logs_immutable before update on public.audit_logs
  for each row execute function public.audit_logs_immutable();

-- ---------------------------------------------------------------------------
-- RPCs called by signed-in users
-- ---------------------------------------------------------------------------
create function public.create_organization(p_name text, p_slug text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_org uuid;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  insert into public.organizations (name, slug, created_by)
  values (trim(p_name), lower(p_slug), v_user)
  returning id into v_org;

  insert into public.subscriptions (org_id) values (v_org);
  perform public.write_audit(v_org, 'organization.created', 'organization', v_org::text,
    jsonb_build_object('name', trim(p_name)));
  insert into public.memberships (org_id, user_id, role) values (v_org, v_user, 'admin');
  return v_org;
end;
$$;

create function public.accept_invitation(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_inv public.invitations;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;
  select email into v_email from public.profiles where id = v_user;

  select * into v_inv from public.invitations
  where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
  for update;

  if not found or v_inv.revoked_at is not null or v_inv.accepted_at is not null or v_inv.expires_at <= now() then
    raise exception 'invitation_invalid';
  end if;
  if v_inv.email <> v_email then
    raise exception 'invitation_email_mismatch'
      using hint = format('This invitation was sent to %s.', v_inv.email);
  end if;

  update public.invitations
  set accepted_at = now(), accepted_by = v_user
  where id = v_inv.id;

  if not exists (select 1 from public.memberships where org_id = v_inv.org_id and user_id = v_user) then
    insert into public.memberships (org_id, user_id, role) values (v_inv.org_id, v_user, v_inv.role);
  end if;
  return v_inv.org_id;
end;
$$;

-- Lets the invite page show "Join Northline Freight" before the user has signed in.
-- Returns nothing for bad, used or expired tokens.
create function public.get_invitation(p_token text)
returns table (org_name text, email text, role public.org_role, expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select o.name, i.email, i.role, i.expires_at
  from public.invitations i
  join public.organizations o on o.id = i.org_id
  where i.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
    and i.accepted_at is null and i.revoked_at is null and i.expires_at > now();
$$;

-- ---------------------------------------------------------------------------
-- Stripe webhook processing. Called only by the server with the secret key.
--
-- One transaction does all of it: record the event id, apply the change,
-- write the audit rows. A duplicate event id returns 'duplicate' and changes
-- nothing. If anything fails, the event id isn't recorded either, so Stripe's
-- retry gets a clean second attempt.
-- ---------------------------------------------------------------------------
create function public.apply_stripe_event(
  p_event_id text,
  p_event_type text,
  p_event_created timestamptz,
  p_org_id uuid,
  p_customer_id text,
  p_data jsonb
) returns text language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_cur public.subscriptions;
  v_outcome text := 'applied';
  v_status text;
  v_plan text;
  v_entitled boolean;
  v_sub_id text;
begin
  -- Resolve the org through the Stripe customer we stored before checkout.
  -- Metadata is only a fallback, for a customer we haven't linked yet.
  if p_customer_id is not null then
    select org_id into v_org from public.subscriptions where stripe_customer_id = p_customer_id;
  end if;
  v_org := coalesce(v_org, p_org_id);
  if v_org is not null and not exists (select 1 from public.organizations where id = v_org) then
    v_org := null;
  end if;

  insert into public.stripe_events (id, type, org_id, stripe_created_at, outcome)
  values (p_event_id, p_event_type, v_org, p_event_created, 'processing')
  on conflict (id) do nothing;
  if not found then
    return 'duplicate';
  end if;

  if v_org is null then
    update public.stripe_events set outcome = 'ignored' where id = p_event_id;
    return 'ignored';
  end if;

  insert into public.subscriptions (org_id) values (v_org) on conflict (org_id) do nothing;
  select * into v_cur from public.subscriptions where org_id = v_org for update;

  -- Remember the customer the first time we see it.
  if p_customer_id is not null and v_cur.stripe_customer_id is null then
    update public.subscriptions set stripe_customer_id = p_customer_id where org_id = v_org;
  end if;

  if p_event_type = 'checkout.session.completed' then
    null; -- customer linked above; the subscription events carry the state

  elsif p_event_type in ('customer.subscription.created', 'customer.subscription.updated',
                         'customer.subscription.deleted', 'customer.subscription.paused',
                         'customer.subscription.resumed') then
    v_sub_id := p_data ->> 'id';
    v_status := p_data ->> 'status';

    if v_cur.last_stripe_event_at is not null and p_event_created < v_cur.last_stripe_event_at then
      v_outcome := 'stale';
    elsif v_cur.stripe_subscription_id is not null
          and v_cur.stripe_subscription_id <> v_sub_id
          and v_cur.status in ('active', 'trialing', 'past_due')
          and v_status not in ('active', 'trialing', 'past_due') then
      -- An old subscription ending must not wipe out the current one.
      v_outcome := 'stale';
    else
      v_entitled := v_status in ('active', 'trialing', 'past_due');
      v_plan := case when v_entitled then coalesce(p_data ->> 'plan_id', 'free') else 'free' end;
      if not exists (select 1 from public.plans where id = v_plan) then
        raise exception 'unknown plan %', v_plan;
      end if;

      update public.subscriptions set
        plan_id = v_plan,
        status = v_status,
        stripe_subscription_id = v_sub_id,
        stripe_price_id = p_data ->> 'price_id',
        current_period_end = (p_data ->> 'current_period_end')::timestamptz,
        cancel_at_period_end = coalesce((p_data ->> 'cancel_at_period_end')::boolean, false),
        canceled_at = (p_data ->> 'canceled_at')::timestamptz,
        payment_failed_at = case when v_entitled and v_status <> 'past_due' then null else payment_failed_at end,
        last_stripe_event_at = p_event_created,
        updated_at = now()
      where org_id = v_org;

      if v_cur.plan_id = 'free' and v_plan <> 'free' then
        perform public.write_audit(v_org, 'billing.subscription_started', 'subscription', v_sub_id,
          jsonb_build_object('plan', v_plan, 'status', v_status));
      elsif v_cur.plan_id <> 'free' and v_plan = 'free' then
        perform public.write_audit(v_org, 'billing.subscription_ended', 'subscription', v_sub_id,
          jsonb_build_object('previous_plan', v_cur.plan_id, 'status', v_status));
      elsif v_cur.plan_id <> v_plan then
        perform public.write_audit(v_org, 'billing.plan_changed', 'subscription', v_sub_id,
          jsonb_build_object('from', v_cur.plan_id, 'to', v_plan));
      end if;

      if v_entitled and v_cur.status <> 'past_due' and v_status = 'past_due' then
        perform public.write_audit(v_org, 'billing.past_due', 'subscription', v_sub_id, '{}'::jsonb);
      end if;
      if v_entitled and not v_cur.cancel_at_period_end and coalesce((p_data ->> 'cancel_at_period_end')::boolean, false) then
        perform public.write_audit(v_org, 'billing.cancellation_scheduled', 'subscription', v_sub_id,
          jsonb_build_object('ends_at', p_data ->> 'current_period_end'));
      elsif v_entitled and v_cur.cancel_at_period_end and not coalesce((p_data ->> 'cancel_at_period_end')::boolean, false)
            and v_cur.plan_id <> 'free' then
        perform public.write_audit(v_org, 'billing.cancellation_reverted', 'subscription', v_sub_id, '{}'::jsonb);
      end if;
    end if;

  elsif p_event_type = 'invoice.payment_failed' then
    update public.subscriptions set payment_failed_at = p_event_created, updated_at = now() where org_id = v_org;
    perform public.write_audit(v_org, 'billing.payment_failed', 'invoice', p_data ->> 'invoice_id',
      jsonb_build_object(
        'amount_due', (p_data ->> 'amount_due')::integer,
        'attempt_count', (p_data ->> 'attempt_count')::integer,
        'next_attempt_at', p_data ->> 'next_payment_attempt'));

  elsif p_event_type = 'invoice.paid' then
    if v_cur.payment_failed_at is not null and v_cur.payment_failed_at <= p_event_created then
      update public.subscriptions set payment_failed_at = null, updated_at = now() where org_id = v_org;
      perform public.write_audit(v_org, 'billing.payment_recovered', 'invoice', p_data ->> 'invoice_id',
        jsonb_build_object('amount_paid', (p_data ->> 'amount_paid')::integer));
    end if;

  -- Risk events don't change the plan. They go in the audit log so an admin
  -- sees them next to the billing history, and the platform admin page lists them.
  elsif p_event_type = 'charge.refunded' then
    perform public.write_audit(v_org, 'billing.refunded', 'charge', p_data ->> 'object_id',
      jsonb_build_object('amount_refunded', (p_data ->> 'amount')::integer));
  elsif p_event_type = 'charge.dispute.created' then
    perform public.write_audit(v_org, 'billing.dispute_opened', 'dispute', p_data ->> 'object_id',
      jsonb_build_object('amount', (p_data ->> 'amount')::integer, 'reason', p_data ->> 'reason'));
  elsif p_event_type = 'radar.early_fraud_warning.created' then
    perform public.write_audit(v_org, 'billing.fraud_warning', 'charge', p_data ->> 'charge_id',
      jsonb_build_object('fraud_type', p_data ->> 'reason'));

  else
    v_outcome := 'ignored';
  end if;

  update public.stripe_events set outcome = v_outcome where id = p_event_id;
  return v_outcome;
end;
$$;

-- Called before redirecting to Checkout, so two admins clicking at once still
-- end up with one Stripe customer. Returns the customer id that won.
create function public.set_stripe_customer(p_org_id uuid, p_customer_id text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_existing text;
begin
  insert into public.subscriptions (org_id) values (p_org_id) on conflict (org_id) do nothing;
  update public.subscriptions set stripe_customer_id = p_customer_id
  where org_id = p_org_id and stripe_customer_id is null;
  select stripe_customer_id into v_existing from public.subscriptions where org_id = p_org_id;
  return v_existing;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.plans enable row level security;
alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.invitations enable row level security;
alter table public.projects enable row level security;
alter table public.subscriptions enable row level security;
alter table public.stripe_events enable row level security;
alter table public.audit_logs enable row level security;

create policy "plans are public" on public.plans
  for select to anon, authenticated using (true);

create policy "see yourself and people in your orgs" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.shares_org_with(id));
create policy "edit your own profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "members see their orgs" on public.organizations
  for select to authenticated using (public.is_org_member(id));
create policy "admins rename their orgs" on public.organizations
  for update to authenticated
  using (public.is_org_admin(id)) with check (public.is_org_admin(id));

create policy "members see co-members" on public.memberships
  for select to authenticated using (public.is_org_member(org_id));
create policy "admins change roles" on public.memberships
  for update to authenticated
  using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));
create policy "admins remove members, anyone can leave" on public.memberships
  for delete to authenticated
  using (public.is_org_admin(org_id) or user_id = (select auth.uid()));

create policy "admins see invitations" on public.invitations
  for select to authenticated using (public.is_org_admin(org_id));
create policy "admins invite" on public.invitations
  for insert to authenticated
  with check (public.is_org_admin(org_id) and invited_by = (select auth.uid()));
create policy "admins revoke invitations" on public.invitations
  for update to authenticated
  using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

create policy "members see projects" on public.projects
  for select to authenticated using (public.is_org_member(org_id));
create policy "members create projects" on public.projects
  for insert to authenticated
  with check (public.is_org_member(org_id) and created_by = (select auth.uid()));
create policy "members edit projects" on public.projects
  for update to authenticated
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy "admins or the creator delete projects" on public.projects
  for delete to authenticated
  using (public.is_org_admin(org_id) or (created_by = (select auth.uid()) and public.is_org_member(org_id)));

create policy "members see billing state" on public.subscriptions
  for select to authenticated using (public.is_org_member(org_id));

create policy "admins read the audit log" on public.audit_logs
  for select to authenticated using (public.is_org_admin(org_id));

-- stripe_events: RLS on, no policies. Only the secret key can touch it.

-- ---------------------------------------------------------------------------
-- Grants. Column grants narrow what UPDATE policies allow: an admin can
-- rename an org but can't edit its slug; a role update can't move a
-- membership to another org.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant select on public.plans to anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;
grant select on public.organizations to authenticated;
grant update (name) on public.organizations to authenticated;
grant select, delete on public.memberships to authenticated;
grant update (role) on public.memberships to authenticated;
grant select on public.invitations to authenticated;
grant insert (org_id, email, role, token_hash, invited_by, expires_at) on public.invitations to authenticated;
grant update (revoked_at) on public.invitations to authenticated;
grant select, delete on public.projects to authenticated;
grant insert (org_id, name, description, created_by) on public.projects to authenticated;
grant update (name, description) on public.projects to authenticated;
grant select on public.subscriptions to authenticated;
grant select on public.audit_logs to authenticated;

grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.is_org_admin(uuid) to authenticated;
grant execute on function public.shares_org_with(uuid) to authenticated;
grant execute on function public.create_organization(text, text) to authenticated;
grant execute on function public.accept_invitation(text) to authenticated;
grant execute on function public.get_invitation(text) to anon, authenticated;

grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Tables created later don't get open grants by default.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;
