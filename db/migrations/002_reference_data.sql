-- =============================================================================
-- 002 — Reference data: roles, permissions, default contribution & loan types,
--       project categories, organisational root records and system settings.
-- Idempotent: safe to re-run on an existing installation.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ORGANISATIONAL ROOT
-- ---------------------------------------------------------------------------
INSERT INTO countries (code, name, currency, phone_code)
VALUES ('KE', 'Kenya', 'KES', '+254')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- ROLES
-- ---------------------------------------------------------------------------
INSERT INTO roles (key, name, description, level, scope, is_system) VALUES
 ('super_admin',    'Super Administrator', 'Full control of the entire system across all parishes, dioceses and the national body.', 100, 'system', TRUE),
 ('admin',          'CMA Administrator',   'Manages members, contribution campaigns, reports and day-to-day system administration.', 90, 'parish', TRUE),
 ('chairman',       'Chairman',            'Views reports, approves loans and confirms member status.', 80, 'parish', TRUE),
 ('treasurer',      'Treasurer / Finance Officer', 'Records and verifies payments, reconciles M-Pesa, issues receipts and produces financial reports.', 75, 'parish', TRUE),
 ('secretary',      'Secretary',           'Manages member records, documents, meetings, attendance, notices and communication.', 70, 'parish', TRUE),
 ('sacco_officer',  'SDP / Sacco Officer', 'Manages sacco savings, shares, dividends and loan administration.', 65, 'parish', TRUE),
 ('loan_committee', 'Loan Committee Member','Reviews and approves/rejects loan applications and guarantor requests.', 60, 'parish', TRUE),
 ('auditor',        'Auditor',             'Read-only access to all financial records, audit trail and reports.', 50, 'diocese', TRUE),
 ('member',         'CMA Member',          'Access to own profile, contributions, sacco account, loans and statements.', 10, 'member', TRUE)
ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, level = EXCLUDED.level;

-- ---------------------------------------------------------------------------
-- PERMISSIONS  (module.action)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  mods text[] := ARRAY['dashboard','members','contributions','welfare','funerals','weddings','projects',
                       'sacco','savings','shares','loans','loan_approvals','guarantors','payments','receipts',
                       'statements','attendance','meetings','reports','notifications','notices','documents',
                       'audit','users','roles','organisation','settings','system'];
  acts text[] := ARRAY['view','create','update','delete','approve','export','reverse','manage'];
  m text; a text;
BEGIN
  FOREACH m IN ARRAY mods LOOP
    FOREACH a IN ARRAY acts LOOP
      INSERT INTO permissions (key, module, action, description)
      VALUES (m || '.' || a, m, a, initcap(replace(m,'_',' ')) || ' – ' || initcap(a))
      ON CONFLICT (key) DO NOTHING;
    END LOOP;
  END LOOP;
  -- self-service permissions used by ordinary members
  INSERT INTO permissions (key, module, action, description) VALUES
   ('profile.update_own','profile','update','Member may edit their own profile'),
   ('payments.pay_own','payments','create','Member may initiate Pay Now / STK push for own obligations'),
   ('loans.apply','loans','create','Member may apply for a loan online'),
   ('guarantors.respond','guarantors','update','Member may accept or reject a guarantee request'),
   ('documents.upload_own','documents','create','Member may upload their own supporting documents')
  ON CONFLICT (key) DO NOTHING;
END $$;

-- ---------------------------------------------------------------------------
-- ROLE → PERMISSION GRANTS
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION grant_perms(role_key text, perm_keys text[]) RETURNS void AS $$
DECLARE rid bigint; k text;
BEGIN
  SELECT id INTO rid FROM roles WHERE key = role_key;
  IF rid IS NULL THEN RETURN; END IF;
  FOREACH k IN ARRAY perm_keys LOOP
    IF k = '*' THEN
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT rid, id FROM permissions ON CONFLICT DO NOTHING;
    ELSIF left(k, 7) = 'MODULE:' THEN
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT rid, id FROM permissions WHERE module = substr(k, 8) ON CONFLICT DO NOTHING;
    ELSE
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT rid, id FROM permissions WHERE key = k ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Super Administrator: everything
SELECT grant_perms('super_admin', ARRAY['*']);

-- CMA Administrator: everything except global system/role administration
SELECT grant_perms('admin', ARRAY[
  'MODULE:dashboard','MODULE:members','MODULE:contributions','MODULE:welfare','MODULE:funerals',
  'MODULE:weddings','MODULE:projects','MODULE:sacco','MODULE:savings','MODULE:shares','MODULE:loans',
  'MODULE:loan_approvals','MODULE:guarantors','MODULE:payments','MODULE:receipts','MODULE:statements',
  'MODULE:attendance','MODULE:meetings','MODULE:reports','MODULE:notifications','MODULE:notices',
  'MODULE:documents','MODULE:audit','MODULE:users','MODULE:organisation','settings.view','settings.update'
]);

-- Chairman
SELECT grant_perms('chairman', ARRAY[
  'dashboard.view','members.view','members.update','members.approve','members.export',
  'contributions.view','contributions.export','welfare.view','welfare.approve','funerals.view','funerals.approve',
  'weddings.view','weddings.approve','projects.view','projects.approve','sacco.view','savings.view','shares.view',
  'loans.view','loans.approve','loan_approvals.view','loan_approvals.approve','guarantors.view',
  'payments.view','receipts.view','statements.view','attendance.view','meetings.view','meetings.approve',
  'reports.view','reports.export','notifications.view','notices.view','notices.create','documents.view','audit.view'
]);

-- Treasurer / Finance Officer
SELECT grant_perms('treasurer', ARRAY[
  'dashboard.view','members.view','members.export',
  'MODULE:contributions','MODULE:welfare','MODULE:funerals','MODULE:weddings','MODULE:projects',
  'sacco.view','savings.view','savings.create','savings.export','shares.view','shares.create','shares.export',
  'loans.view','loans.export','loan_approvals.view','guarantors.view',
  'MODULE:payments','MODULE:receipts','MODULE:statements','MODULE:reports','documents.view','audit.view',
  'notifications.view','notifications.create','meetings.view','attendance.view'
]);

-- Secretary
SELECT grant_perms('secretary', ARRAY[
  'dashboard.view','MODULE:members','MODULE:documents','MODULE:meetings','MODULE:attendance',
  'MODULE:notifications','MODULE:notices','reports.view','reports.export',
  'contributions.view','contributions.export','welfare.view','welfare.create','welfare.update','welfare.export',
  'funerals.view','funerals.create','funerals.update','funerals.export',
  'weddings.view','weddings.create','weddings.update','weddings.export',
  'projects.view','projects.create','projects.update','projects.export',
  'payments.view','receipts.view','statements.view','audit.view'
]);

-- SDP / Sacco Officer
SELECT grant_perms('sacco_officer', ARRAY[
  'dashboard.view','members.view','members.export',
  'MODULE:sacco','MODULE:savings','MODULE:shares','MODULE:loans','MODULE:guarantors','loan_approvals.view',
  'payments.view','payments.create','payments.update','payments.export','receipts.view','receipts.create',
  'receipts.export','statements.view','statements.export','reports.view','reports.export','documents.view',
  'contributions.view','notifications.view','notifications.create','audit.view'
]);

-- Loan Committee
SELECT grant_perms('loan_committee', ARRAY[
  'dashboard.view','members.view','sacco.view','savings.view','shares.view','loans.view','loans.approve',
  'MODULE:loan_approvals','guarantors.view','payments.view','reports.view','reports.export','documents.view',
  'notifications.view','statements.view','audit.view'
]);

-- Auditor (read only + exports)
SELECT grant_perms('auditor', ARRAY[
  'dashboard.view','members.view','members.export','contributions.view','contributions.export',
  'welfare.view','welfare.export','funerals.view','funerals.export','weddings.view','weddings.export',
  'projects.view','projects.export','sacco.view','sacco.export','savings.view','savings.export',
  'shares.view','shares.export','loans.view','loans.export','loan_approvals.view','guarantors.view',
  'payments.view','payments.export','receipts.view','receipts.export','statements.view','statements.export',
  'attendance.view','meetings.view','MODULE:reports','MODULE:audit','documents.view','notifications.view'
]);

-- Member (self service)
SELECT grant_perms('member', ARRAY[
  'dashboard.view','members.view','profile.update_own','documents.upload_own','documents.view',
  'contributions.view','welfare.view','funerals.view','weddings.view','projects.view','payments.pay_own',
  'sacco.view','savings.view','shares.view','loans.view','loans.apply','loan_approvals.view',
  'guarantors.view','guarantors.respond','receipts.view','statements.view','attendance.view',
  'meetings.view','notifications.view'
]);

DROP FUNCTION IF EXISTS grant_perms(text, text[]);

-- ---------------------------------------------------------------------------
-- DEFAULT CONTRIBUTION TYPES
-- ---------------------------------------------------------------------------
INSERT INTO contribution_types (key, name, category, description, is_recurring, is_mandatory, default_amount, penalty_amount, due_day, account_code) VALUES
 ('monthly_contribution','Monthly CMA Contribution','monthly','Statutory monthly CMA membership contribution paid by every active member.', TRUE, TRUE, 200, 50, 10, 'CMA-1000'),
 ('sick_welfare','Sick Member Assistance (Welfare)','welfare','Welfare fund contribution collected when a member is sick or hospitalised.', FALSE, FALSE, 200, 0, NULL, 'CMA-2100'),
 ('funeral_contribution','Funeral / Bereavement Contribution','funeral','Bereavement contribution collected on the death of a member or approved dependant.', FALSE, FALSE, 500, 0, NULL, 'CMA-2200'),
 ('wedding_contribution','Wedding Support Contribution','wedding','Contribution collected to support a member getting married.', FALSE, FALSE, 300, 0, NULL, 'CMA-2300'),
 ('special_project','Special Project / Fundraiser Contribution','special','Flexible contributions for projects, retreats, pilgrimages, uniforms and other CMA activities.', FALSE, FALSE, 0, 0, NULL, 'CMA-2400'),
 ('sacco_savings','SDP / Sacco Monthly Savings','savings','Minimum monthly sacco savings deposit.', TRUE, FALSE, 500, 0, 10, 'SDP-3000'),
 ('share_capital','Share Capital Purchase','shares','Purchase of CMA SDP/Sacco shares.', FALSE, FALSE, 1000, 0, NULL, 'SDP-4000')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- DEFAULT PROJECT CATEGORIES (administrators may add unlimited more)
-- ---------------------------------------------------------------------------
INSERT INTO project_categories (key, name, description) VALUES
 ('parish_project','Parish Project','Projects run by or for the parish.'),
 ('retreat','Retreat','CMA retreats and spiritual formations.'),
 ('pilgrimage','Pilgrimage','Diocesan, national or international pilgrimages.'),
 ('charity','Charity Activity','Almsgiving and outreach to the vulnerable.'),
 ('development','Development Project','Construction and infrastructure development.'),
 ('fundraiser','Fundraiser','General fundraising activities.'),
 ('annual_function','Annual Function','CMA day, anniversary and annual general meetings.'),
 ('uniform','Uniforms','CMA regalia, uniforms and badges.'),
 ('special_event','Special Event','Weddings, ordinations, installations and celebrations.'),
 ('emergency','Emergency Contribution','Urgent response to disasters and emergencies.')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- DEFAULT LOAN TYPES
-- ---------------------------------------------------------------------------
INSERT INTO loan_types (code, name, description, min_amount, max_amount, interest_rate, interest_period,
  interest_method, max_repayment_months, min_repayment_months, min_savings_required, savings_multiplier,
  min_shares_required, shares_multiplier, guarantors_required, processing_fee_pct, processing_fee_fixed,
  penalty_rate_pct, penalty_fixed, grace_days, min_membership_months, max_active_loans, requires_collateral) VALUES
 ('EMG','Emergency Loan','Quick relief loan for emergencies. Fast approval, short tenure.',1000,50000,1,'monthly','reducing',6,1,1000,3,0,0,1,1,0,2,100,3,3,1,FALSE),
 ('DEV','Development Loan','Longer tenure loan for member development projects such as building or land.',10000,1000000,1,'monthly','reducing',48,6,10000,3,5,2,3,1,500,2,200,7,6,1,TRUE),
 ('SCH','School Fees Loan','Loan to pay school fees, disbursed directly to the institution where possible.',5000,300000,1,'monthly','reducing',12,3,5000,3,3,2,2,1,300,2,150,5,6,2,FALSE),
 ('BIZ','Business Loan','Capital for member business ventures, requires a business plan.',20000,800000,1.5,'monthly','reducing',36,6,20000,3,5,2,3,2,1000,3,300,7,12,1,TRUE),
 ('MED','Medical Loan','Loan for medical bills and hospitalisation costs.',5000,200000,1,'monthly','reducing',18,3,5000,3,2,2,2,1,300,2,150,5,3,2,FALSE),
 ('SHT','Short-Term Loan','Salary bridging loan repaid within 1 to 3 months.',1000,80000,2,'monthly','flat',3,1,2000,2,0,0,1,1,200,3,100,3,3,2,FALSE),
 ('AST','Asset Loan','Financing of household or productive assets such as motorcycles, water tanks or appliances.',10000,500000,1.25,'monthly','reducing',36,6,10000,3,5,2,2,1.5,500,2,200,7,6,1,TRUE),
 ('SPL','Special Loan','Special-purpose loan approved by the loan committee outside standard products.',5000,300000,1.5,'monthly','reducing',24,3,5000,3,3,2,3,2,500,3,200,7,6,1,FALSE)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- SYSTEM SETTINGS
-- ---------------------------------------------------------------------------
INSERT INTO system_settings (key, value, group_name, description, is_secret) VALUES
 ('organisation', '{"name":"Catholic Men Association (CMA)","short_name":"CMA","parish":"St. Monica Parish, Kamakis","diocese":"Archdiocese of Nairobi","motto":"Men of Faith, Men of Service","email":"cma@stmonica.or.ke","phone":"+254700000000","address":"P.O. Box 1234-00100, Nairobi","currency":"KES","currency_symbol":"KSh","logo_url":null,"stamp_url":null}'::jsonb,'general','Organisation identity printed on receipts, statements and reports.', FALSE),

 ('contributions', '{"monthly_amount":200,"due_day":10,"financial_year_start_month":1,"penalty_enabled":true,"penalty_amount":50,"penalty_after_days":7,"auto_bill":true,"sacco_min_monthly_savings":500,"exemptions":["deceased","suspended"]}'::jsonb,'finance','Monthly CMA contribution configuration.', FALSE),

 ('shares', '{"value_per_share":1000,"min_shares":1,"max_shares_per_member":500,"transferable":true,"certificate_prefix":"CMA/SH"}'::jsonb,'sacco','Share capital configuration.', FALSE),

 ('sacco', '{"account_prefix":"SDP","min_monthly_savings":500,"max_savings_withdrawal_pct":50,"withdrawal_notice_days":30,"interest_on_deposits_pct":3,"dividend_policy":"pro-rata on share capital"}'::jsonb,'sacco','SDP / Sacco module configuration.', FALSE),

 ('loans', '{"default_interest_method":"reducing","first_due_date_offset_days":30,"max_loan_to_savings_ratio":3,"allow_early_repayment":true,"early_repayment_fee_pct":0,"arrears_grace_days":7,"auto_penalty":true,"committee_role":"loan_committee"}'::jsonb,'loans','Loan processing configuration.', FALSE),

 ('guarantors', '{"max_exposure_multiple":3,"max_guarantees_active":5,"count_savings_as_capacity":true,"notify_on_request":true}'::jsonb,'loans','Guarantor capacity rules.', FALSE),

 ('payments', '{"mpesa":{"enabled":false,"mode":"sandbox","short_code":null,"passkey":null,"consumer_key":null,"consumer_secret":null,"callback_url":null,"stk_timeout_seconds":60},"airtel":{"enabled":false,"client_id":null,"client_secret":null},"bank":{"enabled":true,"account_name":"CMA St. Monica","account_number":"01000000000","bank":"Catholic Bank","swift":null},"cash":{"enabled":true},"manual_entry":{"enabled":true,"requires_verification":true}}'::jsonb,'payments','Payment channels and mobile money (Daraja) configuration.', TRUE),

 ('notifications', '{"channels":{"in_system":true,"sms":false,"email":false,"whatsapp":false},"sms_provider":"none","sms_api_key":null,"sms_sender_id":"CMA","email_provider":"none","smtp_host":null,"smtp_port":587,"smtp_user":null,"smtp_password":null,"smtp_from":"no-reply@cma.or.ke","whatsapp_provider":"none","reminder_days_before_due":3,"escalation_days_after_due":7}'::jsonb,'notifications','Notification channels and provider credentials.', TRUE),

 ('security', '{"password_min_length":8,"max_failed_attempts":5,"lockout_minutes":30,"session_hours":12,"remember_me_days":30,"two_factor_enabled":false,"two_factor_methods":["sms","email"],"force_password_reset_days":180,"ip_allowlist_enabled":false,"data_protection_notice":"Personal data is processed under the Kenya Data Protection Act, 2019 for CMA membership, welfare and financial administration only."}'::jsonb,'security','Authentication, session and data protection policy.', FALSE),

 ('backup', '{"enabled":true,"frequency":"daily","time":"02:00","retention_days":30,"destination":"local","compress":true,"last_backup_at":null}'::jsonb,'system','Automated database backup configuration.', FALSE),

 ('hierarchy', '{"active_level":"parish","levels":["country","archdiocese","diocese","deanery","parish","church","scc","member"],"multi_parish_enabled":false}'::jsonb,'general','Organisational hierarchy configuration for future expansion.', FALSE)
ON CONFLICT (key) DO NOTHING;
