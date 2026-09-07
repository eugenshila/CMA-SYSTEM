-- =============================================================================
-- CMA MANAGEMENT SYSTEM — Initial relational schema (PostgreSQL)
-- Compatible with Railway PostgreSQL and any PostgreSQL 14+ instance.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. ORGANISATIONAL HIERARCHY
--    COUNTRY -> ARCHDIOCESE/DIOCESE -> DEANERY -> PARISH -> CHURCH/OUTSTATION
--    -> SMALL CHRISTIAN COMMUNITY -> CMA MEMBER
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS countries (
  id            BIGSERIAL PRIMARY KEY,
  code          VARCHAR(8)  NOT NULL UNIQUE,
  name          VARCHAR(120) NOT NULL,
  currency      VARCHAR(8)  NOT NULL DEFAULT 'KES',
  phone_code    VARCHAR(8)  NOT NULL DEFAULT '+254',
  active        BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dioceses (
  id            BIGSERIAL PRIMARY KEY,
  country_id    BIGINT NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  code          VARCHAR(16) NOT NULL UNIQUE,
  name          VARCHAR(160) NOT NULL,
  type          VARCHAR(24) NOT NULL DEFAULT 'diocese'
                CHECK (type IN ('archdiocese','diocese','apostolic_vicar','military_ordinariate')),
  bishop        VARCHAR(160),
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dioceses_country ON dioceses(country_id);

CREATE TABLE IF NOT EXISTS deaneries (
  id            BIGSERIAL PRIMARY KEY,
  diocese_id    BIGINT NOT NULL REFERENCES dioceses(id) ON DELETE CASCADE,
  code          VARCHAR(16) NOT NULL UNIQUE,
  name          VARCHAR(160) NOT NULL,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deaneries_diocese ON deaneries(diocese_id);

CREATE TABLE IF NOT EXISTS parishes (
  id            BIGSERIAL PRIMARY KEY,
  deanery_id    BIGINT REFERENCES deaneries(id) ON DELETE SET NULL,
  diocese_id    BIGINT NOT NULL REFERENCES dioceses(id) ON DELETE CASCADE,
  code          VARCHAR(16) NOT NULL UNIQUE,
  name          VARCHAR(160) NOT NULL,
  parish_priest VARCHAR(160),
  cma_chaplain  VARCHAR(160),
  address       VARCHAR(240),
  phone         VARCHAR(32),
  email         VARCHAR(160),
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_parishes_diocese ON parishes(diocese_id);
CREATE INDEX IF NOT EXISTS idx_parishes_deanery ON parishes(deanery_id);

CREATE TABLE IF NOT EXISTS churches (
  id            BIGSERIAL PRIMARY KEY,
  parish_id     BIGINT NOT NULL REFERENCES parishes(id) ON DELETE CASCADE,
  code          VARCHAR(16) NOT NULL UNIQUE,
  name          VARCHAR(160) NOT NULL,
  type          VARCHAR(24) NOT NULL DEFAULT 'outstation'
                CHECK (type IN ('parish_church','outstation','mission','chapel')),
  location      VARCHAR(160),
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_churches_parish ON churches(parish_id);

CREATE TABLE IF NOT EXISTS small_christian_communities (
  id            BIGSERIAL PRIMARY KEY,
  church_id     BIGINT REFERENCES churches(id) ON DELETE SET NULL,
  parish_id     BIGINT NOT NULL REFERENCES parishes(id) ON DELETE CASCADE,
  code          VARCHAR(24) NOT NULL UNIQUE,
  name          VARCHAR(160) NOT NULL,
  leader_name   VARCHAR(160),
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scc_parish ON small_christian_communities(parish_id);
CREATE INDEX IF NOT EXISTS idx_scc_church ON small_christian_communities(church_id);

-- ---------------------------------------------------------------------------
-- 2. ROLES, PERMISSIONS AND USERS  (Role Based Access Control)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS roles (
  id            BIGSERIAL PRIMARY KEY,
  key           VARCHAR(48) NOT NULL UNIQUE,
  name          VARCHAR(120) NOT NULL,
  description   TEXT,
  level         INTEGER NOT NULL DEFAULT 10,          -- higher = more privilege
  scope         VARCHAR(24) NOT NULL DEFAULT 'parish'
                CHECK (scope IN ('system','national','archdiocese','diocese','deanery','parish','church','member')),
  is_system     BOOLEAN NOT NULL DEFAULT FALSE,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS permissions (
  id            BIGSERIAL PRIMARY KEY,
  key           VARCHAR(96) NOT NULL UNIQUE,          -- e.g. contributions.write
  module        VARCHAR(48) NOT NULL,
  action        VARCHAR(32) NOT NULL,
  description   VARCHAR(240)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id        BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id  BIGINT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS members (
  id                     BIGSERIAL PRIMARY KEY,
  membership_no          VARCHAR(32) NOT NULL UNIQUE,      -- CMA Membership Number
  user_id                BIGINT,                           -- filled after CREATE users (FK added below)
  salutation             VARCHAR(24),
  full_name              VARCHAR(200) NOT NULL,
  first_name             VARCHAR(80),
  middle_name            VARCHAR(80),
  last_name              VARCHAR(80),
  gender                 VARCHAR(16) NOT NULL DEFAULT 'male' CHECK (gender IN ('male','female','other')),
  national_id_enc        TEXT,                             -- encrypted (AES-256-GCM)
  national_id_hash       VARCHAR(128),                     -- HMAC for exact lookups
  national_id_last4      VARCHAR(8),                       -- masked display
  passport_enc           TEXT,
  passport_hash          VARCHAR(128),
  phone                  VARCHAR(32) NOT NULL,
  alt_phone              VARCHAR(32),
  email                  VARCHAR(160),
  date_of_birth          DATE,
  marital_status         VARCHAR(24) NOT NULL DEFAULT 'single'
                         CHECK (marital_status IN ('single','married','widowed','separated','divorced')),
  occupation             VARCHAR(160),
  employer               VARCHAR(160),
  residential_area       VARCHAR(160),
  kra_pin                VARCHAR(32),
  parish_id              BIGINT NOT NULL REFERENCES parishes(id),
  church_id              BIGINT REFERENCES churches(id),
  scc_id                 BIGINT REFERENCES small_christian_communities(id),
  date_joined            DATE NOT NULL DEFAULT CURRENT_DATE,
  membership_status      VARCHAR(24) NOT NULL DEFAULT 'active'
                         CHECK (membership_status IN ('active','inactive','suspended','transferred','deceased','resigned','pending')),
  membership_type        VARCHAR(24) NOT NULL DEFAULT 'full' CHECK (membership_type IN ('full','associate','honorary')),
  baptism_date           DATE,
  photo_url              TEXT,
  card_url               TEXT,
  next_of_kin            VARCHAR(160),
  next_of_kin_relation   VARCHAR(64),
  next_of_kin_phone      VARCHAR(32),
  emergency_contact      VARCHAR(160),
  emergency_contact_rel  VARCHAR(64),
  emergency_contact_phone VARCHAR(32),
  notes                  TEXT,
  exempt_monthly         BOOLEAN NOT NULL DEFAULT FALSE,
  exemption_reason       VARCHAR(240),
  created_by             BIGINT,
  updated_by             BIGINT,
  deleted_at             TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_members_parish ON members(parish_id);
CREATE INDEX IF NOT EXISTS idx_members_church ON members(church_id);
CREATE INDEX IF NOT EXISTS idx_members_scc    ON members(scc_id);
CREATE INDEX IF NOT EXISTS idx_members_status ON members(membership_status);
CREATE INDEX IF NOT EXISTS idx_members_phone  ON members(phone);

CREATE TABLE IF NOT EXISTS users (
  id                    BIGSERIAL PRIMARY KEY,
  member_id             BIGINT REFERENCES members(id) ON DELETE SET NULL,
  role_id               BIGINT NOT NULL REFERENCES roles(id),
  scope_parish_id       BIGINT REFERENCES parishes(id),
  scope_diocese_id      BIGINT REFERENCES dioceses(id),
  name                  VARCHAR(160) NOT NULL,
  email                 VARCHAR(160) UNIQUE,
  phone                 VARCHAR(32) UNIQUE,
  login_id              VARCHAR(64) UNIQUE,              -- membership number / username login alias
  password_hash         TEXT NOT NULL,
  status                VARCHAR(24) NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','invited','suspended','locked','disabled')),
  failed_attempts       INTEGER NOT NULL DEFAULT 0,
  locked_until          TIMESTAMPTZ,
  last_login_at         TIMESTAMPTZ,
  last_login_ip         VARCHAR(64),
  password_changed_at   TIMESTAMPTZ,
  must_change_password  BOOLEAN NOT NULL DEFAULT FALSE,
  two_factor_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  two_factor_secret     TEXT,
  email_verified_at     TIMESTAMPTZ,
  phone_verified_at     TIMESTAMPTZ,
  created_by            BIGINT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at            TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_users_role   ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_users_member ON users(member_id);
CREATE INDEX IF NOT EXISTS idx_users_phone  ON users(phone);

ALTER TABLE members DROP CONSTRAINT IF EXISTS members_user_fk;
ALTER TABLE members ADD CONSTRAINT members_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE members DROP CONSTRAINT IF EXISTS members_created_by_fk;
ALTER TABLE members ADD CONSTRAINT members_created_by_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS user_sessions (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    VARCHAR(128) NOT NULL UNIQUE,
  ip_address    VARCHAR(64),
  user_agent    VARCHAR(320),
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ,
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);

CREATE TABLE IF NOT EXISTS otp_codes (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose       VARCHAR(32) NOT NULL CHECK (purpose IN ('password_reset','two_factor','phone_verify','email_verify')),
  code_hash     VARCHAR(128) NOT NULL,
  channel       VARCHAR(16) NOT NULL DEFAULT 'sms' CHECK (channel IN ('sms','email','whatsapp')),
  destination   VARCHAR(160),
  attempts      INTEGER NOT NULL DEFAULT 0,
  expires_at    TIMESTAMPTZ NOT NULL,
  consumed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_otp_user ON otp_codes(user_id, purpose);

CREATE TABLE IF NOT EXISTS login_attempts (
  id            BIGSERIAL PRIMARY KEY,
  identifier    VARCHAR(160),
  ip_address    VARCHAR(64),
  user_agent    VARCHAR(320),
  success       BOOLEAN NOT NULL DEFAULT FALSE,
  reason        VARCHAR(120),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_identifier ON login_attempts(identifier, created_at DESC);

-- ---------------------------------------------------------------------------
-- 3. DOCUMENTS / SECURE FILE STORAGE
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS member_documents (
  id            BIGSERIAL PRIMARY KEY,
  member_id     BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  doc_type      VARCHAR(48) NOT NULL
                CHECK (doc_type IN ('membership_card','national_id','passport','photo','birth_certificate',
                                    'baptism_certificate','marriage_certificate','title_deed','payslip',
                                    'bank_statement','recommendation','other')),
  title         VARCHAR(200) NOT NULL,
  file_name     VARCHAR(240) NOT NULL,
  file_url      TEXT NOT NULL,
  mime_type     VARCHAR(120),
  size_bytes    BIGINT,
  checksum      VARCHAR(128),
  verified      BOOLEAN NOT NULL DEFAULT FALSE,
  verified_by   BIGINT REFERENCES users(id),
  notes         VARCHAR(320),
  uploaded_by   BIGINT REFERENCES users(id),
  deleted_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_member_docs_member ON member_documents(member_id);

-- Generic attachments for welfare/funeral/wedding/project/loan entities
CREATE TABLE IF NOT EXISTS documents (
  id            BIGSERIAL PRIMARY KEY,
  entity_type   VARCHAR(48) NOT NULL,     -- welfare_case | funeral_case | wedding_case | project | loan_application | loan | meeting | notice | member
  entity_id     BIGINT NOT NULL,
  doc_type      VARCHAR(48) NOT NULL DEFAULT 'supporting',
  title         VARCHAR(200) NOT NULL,
  file_name     VARCHAR(240) NOT NULL,
  file_url      TEXT NOT NULL,
  mime_type     VARCHAR(120),
  size_bytes    BIGINT,
  uploaded_by   BIGINT REFERENCES users(id),
  deleted_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_documents_entity ON documents(entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- 4. FINANCIAL YEARS, CONTRIBUTION TYPES AND MONTHLY CONTRIBUTIONS
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS financial_years (
  id            BIGSERIAL PRIMARY KEY,
  name          VARCHAR(24) NOT NULL UNIQUE,       -- FY 2026
  start_date    DATE NOT NULL,
  end_date      DATE NOT NULL,
  is_current    BOOLEAN NOT NULL DEFAULT FALSE,
  parish_id     BIGINT REFERENCES parishes(id),    -- NULL = global default
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contribution_types (
  id              BIGSERIAL PRIMARY KEY,
  key             VARCHAR(48) NOT NULL UNIQUE,
  name            VARCHAR(160) NOT NULL,
  category        VARCHAR(32) NOT NULL
                  CHECK (category IN ('monthly','welfare','funeral','wedding','special','project','savings','shares')),
  description     TEXT,
  is_recurring    BOOLEAN NOT NULL DEFAULT FALSE,
  is_mandatory    BOOLEAN NOT NULL DEFAULT TRUE,
  default_amount  NUMERIC(14,2) NOT NULL DEFAULT 0,
  penalty_amount  NUMERIC(14,2) NOT NULL DEFAULT 0,
  due_day         INTEGER,                          -- day of month for recurring contributions
  account_code    VARCHAR(32),                      -- chart of accounts / fund code
  parish_id       BIGINT REFERENCES parishes(id),
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_by      BIGINT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contribution_types_category ON contribution_types(category);

-- One row per member per period for recurring (monthly) contributions = the "bill"
CREATE TABLE IF NOT EXISTS member_contributions (
  id                  BIGSERIAL PRIMARY KEY,
  member_id           BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  contribution_type_id BIGINT NOT NULL REFERENCES contribution_types(id),
  financial_year_id   BIGINT REFERENCES financial_years(id),
  period              VARCHAR(16) NOT NULL,           -- 2026-03
  period_label        VARCHAR(48),                    -- March 2026
  amount_due          NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount_paid         NUMERIC(14,2) NOT NULL DEFAULT 0,
  penalty             NUMERIC(14,2) NOT NULL DEFAULT 0,
  due_date            DATE NOT NULL,
  status              VARCHAR(24) NOT NULL DEFAULT 'unpaid'
                      CHECK (status IN ('paid','partial','unpaid','overdue','exempted')),
  exempted            BOOLEAN NOT NULL DEFAULT FALSE,
  exemption_reason    VARCHAR(240),
  billed_at           TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (member_id, contribution_type_id, period)
);
CREATE INDEX IF NOT EXISTS idx_mc_member   ON member_contributions(member_id);
CREATE INDEX IF NOT EXISTS idx_mc_period   ON member_contributions(period);
CREATE INDEX IF NOT EXISTS idx_mc_status   ON member_contributions(status);
CREATE INDEX IF NOT EXISTS idx_mc_type     ON member_contributions(contribution_type_id, period);

-- ---------------------------------------------------------------------------
-- 5. PAYMENTS, ALLOCATIONS AND RECEIPTS
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS payments (
  id                BIGSERIAL PRIMARY KEY,
  receipt_no        VARCHAR(40) UNIQUE,
  member_id         BIGINT NOT NULL REFERENCES members(id),
  parish_id         BIGINT REFERENCES parishes(id),
  amount            NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  allocated_amount  NUMERIC(14,2) NOT NULL DEFAULT 0,
  unallocated_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  payment_date      TIMESTAMPTZ NOT NULL DEFAULT now(),
  method            VARCHAR(24) NOT NULL DEFAULT 'cash'
                    CHECK (method IN ('mpesa','airtel','bank','cash','cheque','card','manual','reversal')),
  reference         VARCHAR(120),
  transaction_id    VARCHAR(120),
  status            VARCHAR(24) NOT NULL DEFAULT 'completed'
                    CHECK (status IN ('pending','completed','failed','reversed','cancelled')),
  channel           VARCHAR(24) NOT NULL DEFAULT 'manual' CHECK (channel IN ('manual','stk_push','callback','webhook','bank_import','bulk')),
  category          VARCHAR(48),                       -- primary category label for reporting
  balance_after     NUMERIC(14,2),
  notes             VARCHAR(320),
  recorded_by       BIGINT REFERENCES users(id),
  reversed_by       BIGINT REFERENCES users(id),
  reversed_at       TIMESTAMPTZ,
  reversal_reason   VARCHAR(240),
  original_payment_id BIGINT REFERENCES payments(id),
  reconciled        BOOLEAN NOT NULL DEFAULT FALSE,
  reconciled_at     TIMESTAMPTZ,
  reconciled_by     BIGINT REFERENCES users(id),
  ip_address        VARCHAR(64),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_member ON payments(member_id);
CREATE INDEX IF NOT EXISTS idx_payments_date   ON payments(payment_date DESC);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_ref    ON payments(transaction_id);

-- A payment can be split across several obligations (contribution + savings + loan)
CREATE TABLE IF NOT EXISTS payment_allocations (
  id               BIGSERIAL PRIMARY KEY,
  payment_id       BIGINT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  member_id        BIGINT NOT NULL REFERENCES members(id),
  allocation_type  VARCHAR(48) NOT NULL
                   CHECK (allocation_type IN ('monthly_contribution','welfare','funeral','wedding','project',
                                              'savings','shares','loan','loan_principal','loan_interest',
                                              'loan_penalty','penalty','fee','donation','other')),
  reference_type   VARCHAR(48),       -- entity name e.g. welfare_cases
  reference_id     BIGINT,            -- entity id   e.g. welfare case id
  period           VARCHAR(16),       -- for monthly contributions e.g. 2026-03
  amount           NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_alloc_payment ON payment_allocations(payment_id);
CREATE INDEX IF NOT EXISTS idx_alloc_ref     ON payment_allocations(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_alloc_member  ON payment_allocations(member_id);

CREATE TABLE IF NOT EXISTS receipts (
  id              BIGSERIAL PRIMARY KEY,
  receipt_no      VARCHAR(40) NOT NULL UNIQUE,
  payment_id      BIGINT REFERENCES payments(id),
  member_id       BIGINT NOT NULL REFERENCES members(id),
  organisation    VARCHAR(200) NOT NULL,
  parish_name     VARCHAR(200),
  category        VARCHAR(64) NOT NULL,
  description     VARCHAR(320),
  amount          NUMERIC(14,2) NOT NULL,
  balance_after   NUMERIC(14,2),
  payment_method  VARCHAR(24) NOT NULL,
  reference       VARCHAR(120),
  issued_by       BIGINT REFERENCES users(id),
  issued_to_name  VARCHAR(200),
  status          VARCHAR(24) NOT NULL DEFAULT 'valid' CHECK (status IN ('valid','void','reversed')),
  issued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  voided_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_receipts_member ON receipts(member_id);
CREATE INDEX IF NOT EXISTS idx_receipts_payment ON receipts(payment_id);

-- M-Pesa (Safaricom Daraja) / mobile money integration records
CREATE TABLE IF NOT EXISTS mpesa_transactions (
  id                 BIGSERIAL PRIMARY KEY,
  member_id          BIGINT REFERENCES members(id),
  payment_id         BIGINT REFERENCES payments(id),
  provider           VARCHAR(24) NOT NULL DEFAULT 'mpesa' CHECK (provider IN ('mpesa','airtel','other')),
  transaction_type   VARCHAR(32) NOT NULL DEFAULT 'stk_push'
                     CHECK (transaction_type IN ('stk_push','c2b','b2c','status_check','manual')),
  checkout_request_id VARCHAR(120),
  merchant_request_id VARCHAR(120),
  mpesa_receipt_no   VARCHAR(64),
  phone_number       VARCHAR(32) NOT NULL,
  amount             NUMERIC(14,2) NOT NULL,
  account_reference  VARCHAR(64),        -- paybill account no = allocation hint
  description        VARCHAR(240),
  result_code        INTEGER,
  result_desc        VARCHAR(240),
  status             VARCHAR(24) NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','success','failed','timeout','reversed')),
  allocation_type    VARCHAR(48),
  reference_type     VARCHAR(48),
  reference_id       BIGINT,
  request_payload    JSONB,
  response_payload   JSONB,
  callback_payload   JSONB,
  requested_by       BIGINT REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mpesa_checkout ON mpesa_transactions(checkout_request_id);
CREATE INDEX IF NOT EXISTS idx_mpesa_receipt  ON mpesa_transactions(mpesa_receipt_no);
CREATE INDEX IF NOT EXISTS idx_mpesa_status   ON mpesa_transactions(status);

-- ---------------------------------------------------------------------------
-- 6. WELFARE (SICK MEMBER ASSISTANCE)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS welfare_cases (
  id                    BIGSERIAL PRIMARY KEY,
  case_no               VARCHAR(40) NOT NULL UNIQUE,
  member_id             BIGINT NOT NULL REFERENCES members(id),
  beneficiary_name      VARCHAR(200),
  beneficiary_relationship VARCHAR(64),
  category              VARCHAR(48) NOT NULL DEFAULT 'sickness'
                        CHECK (category IN ('sickness','hospitalisation','surgery','maternity','accident',
                                            'disaster','education','bereavement','other')),
  nature_of_assistance  VARCHAR(320),
  hospital              VARCHAR(200),
  ward                  VARCHAR(120),
  admission_date        DATE,
  discharge_date        DATE,
  visitation_date       DATE,
  target_amount         NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount_per_member     NUMERIC(14,2) NOT NULL DEFAULT 0,
  opening_date          DATE NOT NULL DEFAULT CURRENT_DATE,
  deadline              DATE,
  amount_collected      NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount_disbursed      NUMERIC(14,2) NOT NULL DEFAULT 0,
  disbursed_at          TIMESTAMPTZ,
  disbursement_reference VARCHAR(120),
  scope_type            VARCHAR(24) NOT NULL DEFAULT 'parish' CHECK (scope_type IN ('parish','church','scc','diocese','all')),
  parish_id             BIGINT REFERENCES parishes(id),
  church_id             BIGINT REFERENCES churches(id),
  scc_id                BIGINT REFERENCES small_christian_communities(id),
  status                VARCHAR(24) NOT NULL DEFAULT 'open'
                        CHECK (status IN ('draft','open','closed','disbursed','cancelled')),
  notes                 TEXT,
  created_by            BIGINT REFERENCES users(id),
  updated_by            BIGINT REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_welfare_member ON welfare_cases(member_id);
CREATE INDEX IF NOT EXISTS idx_welfare_status ON welfare_cases(status);

CREATE TABLE IF NOT EXISTS welfare_payments (
  id              BIGSERIAL PRIMARY KEY,
  welfare_case_id BIGINT NOT NULL REFERENCES welfare_cases(id) ON DELETE CASCADE,
  member_id       BIGINT NOT NULL REFERENCES members(id),
  payment_id      BIGINT REFERENCES payments(id),
  amount          NUMERIC(14,2) NOT NULL,
  paid_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes           VARCHAR(240),
  recorded_by     BIGINT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_welfare_payments_case   ON welfare_payments(welfare_case_id);
CREATE INDEX IF NOT EXISTS idx_welfare_payments_member ON welfare_payments(member_id);

-- ---------------------------------------------------------------------------
-- 7. FUNERAL / BEREAVEMENT CONTRIBUTIONS
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS funeral_cases (
  id                    BIGSERIAL PRIMARY KEY,
  case_no               VARCHAR(40) NOT NULL UNIQUE,
  member_id             BIGINT NOT NULL REFERENCES members(id),
  deceased_name         VARCHAR(200) NOT NULL,
  relationship          VARCHAR(48) NOT NULL
                        CHECK (relationship IN ('member','spouse','child','parent','sibling','grandparent',
                                                'other_dependant','other')),
  relationship_other    VARCHAR(120),
  date_of_death         DATE NOT NULL,
  funeral_date          DATE,
  burial_place          VARCHAR(200),
  mortuary              VARCHAR(200),
  amount_per_member     NUMERIC(14,2) NOT NULL DEFAULT 0,
  deadline              DATE,
  total_expected        NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount_collected      NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount_disbursed      NUMERIC(14,2) NOT NULL DEFAULT 0,
  disbursed_at          TIMESTAMPTZ,
  disbursement_reference VARCHAR(120),
  in_kind_support       VARCHAR(320),
  scope_type            VARCHAR(24) NOT NULL DEFAULT 'parish' CHECK (scope_type IN ('parish','church','scc','diocese','all')),
  parish_id             BIGINT REFERENCES parishes(id),
  church_id             BIGINT REFERENCES churches(id),
  scc_id                BIGINT REFERENCES small_christian_communities(id),
  status                VARCHAR(24) NOT NULL DEFAULT 'open'
                        CHECK (status IN ('draft','open','closed','disbursed','cancelled')),
  notes                 TEXT,
  created_by            BIGINT REFERENCES users(id),
  updated_by            BIGINT REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_funeral_member ON funeral_cases(member_id);
CREATE INDEX IF NOT EXISTS idx_funeral_status ON funeral_cases(status);

CREATE TABLE IF NOT EXISTS funeral_payments (
  id              BIGSERIAL PRIMARY KEY,
  funeral_case_id BIGINT NOT NULL REFERENCES funeral_cases(id) ON DELETE CASCADE,
  member_id       BIGINT NOT NULL REFERENCES members(id),
  payment_id      BIGINT REFERENCES payments(id),
  amount          NUMERIC(14,2) NOT NULL,
  paid_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes           VARCHAR(240),
  recorded_by     BIGINT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_funeral_payments_case   ON funeral_payments(funeral_case_id);
CREATE INDEX IF NOT EXISTS idx_funeral_payments_member ON funeral_payments(member_id);

-- ---------------------------------------------------------------------------
-- 8. WEDDING SUPPORT CONTRIBUTIONS
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS wedding_cases (
  id                    BIGSERIAL PRIMARY KEY,
  case_no               VARCHAR(40) NOT NULL UNIQUE,
  member_id             BIGINT NOT NULL REFERENCES members(id),
  spouse_name           VARCHAR(200),
  wedding_date          DATE NOT NULL,
  venue                 VARCHAR(200),
  church_id             BIGINT REFERENCES churches(id),
  amount_per_member     NUMERIC(14,2) NOT NULL DEFAULT 0,
  target_amount         NUMERIC(14,2) NOT NULL DEFAULT 0,
  deadline              DATE,
  amount_collected      NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount_disbursed      NUMERIC(14,2) NOT NULL DEFAULT 0,
  disbursed_at          TIMESTAMPTZ,
  disbursement_reference VARCHAR(120),
  scope_type            VARCHAR(24) NOT NULL DEFAULT 'parish' CHECK (scope_type IN ('parish','church','scc','diocese','all')),
  parish_id             BIGINT REFERENCES parishes(id),
  scc_id                BIGINT REFERENCES small_christian_communities(id),
  status                VARCHAR(24) NOT NULL DEFAULT 'open'
                        CHECK (status IN ('draft','open','closed','disbursed','cancelled')),
  notes                 TEXT,
  created_by            BIGINT REFERENCES users(id),
  updated_by            BIGINT REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wedding_member ON wedding_cases(member_id);

CREATE TABLE IF NOT EXISTS wedding_payments (
  id              BIGSERIAL PRIMARY KEY,
  wedding_case_id BIGINT NOT NULL REFERENCES wedding_cases(id) ON DELETE CASCADE,
  member_id       BIGINT NOT NULL REFERENCES members(id),
  payment_id      BIGINT REFERENCES payments(id),
  amount          NUMERIC(14,2) NOT NULL,
  paid_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes           VARCHAR(240),
  recorded_by     BIGINT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wedding_payments_case   ON wedding_payments(wedding_case_id);
CREATE INDEX IF NOT EXISTS idx_wedding_payments_member ON wedding_payments(member_id);

-- ---------------------------------------------------------------------------
-- 9. SPECIAL CONTRIBUTIONS AND PROJECTS (unlimited administrator categories)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS special_projects (
  id                   BIGSERIAL PRIMARY KEY,
  project_no           VARCHAR(40) NOT NULL UNIQUE,
  name                 VARCHAR(200) NOT NULL,
  category             VARCHAR(64) NOT NULL DEFAULT 'parish_project',
  description          TEXT,
  target_amount        NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount_per_member    NUMERIC(14,2) NOT NULL DEFAULT 0,
  start_date           DATE NOT NULL DEFAULT CURRENT_DATE,
  deadline             DATE,
  event_date           DATE,
  amount_collected     NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount_disbursed     NUMERIC(14,2) NOT NULL DEFAULT 0,
  disbursed_at         TIMESTAMPTZ,
  disbursement_reference VARCHAR(120),
  scope_type           VARCHAR(24) NOT NULL DEFAULT 'parish' CHECK (scope_type IN ('parish','church','scc','diocese','all')),
  parish_id            BIGINT REFERENCES parishes(id),
  church_id            BIGINT REFERENCES churches(id),
  scc_id               BIGINT REFERENCES small_christian_communities(id),
  status               VARCHAR(24) NOT NULL DEFAULT 'open'
                       CHECK (status IN ('draft','open','closed','completed','cancelled')),
  committee            VARCHAR(320),
  notes                TEXT,
  created_by           BIGINT REFERENCES users(id),
  updated_by           BIGINT REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_projects_category ON special_projects(category);
CREATE INDEX IF NOT EXISTS idx_projects_status   ON special_projects(status);

CREATE TABLE IF NOT EXISTS project_contributions (
  id                 BIGSERIAL PRIMARY KEY,
  project_id         BIGINT NOT NULL REFERENCES special_projects(id) ON DELETE CASCADE,
  member_id          BIGINT NOT NULL REFERENCES members(id),
  payment_id         BIGINT REFERENCES payments(id),
  amount_pledged     NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount_paid        NUMERIC(14,2) NOT NULL DEFAULT 0,
  status             VARCHAR(24) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','partial','paid','exempted')),
  paid_at            TIMESTAMPTZ,
  notes              VARCHAR(240),
  recorded_by        BIGINT REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, member_id)
);
CREATE INDEX IF NOT EXISTS idx_project_contrib_project ON project_contributions(project_id);
CREATE INDEX IF NOT EXISTS idx_project_contrib_member  ON project_contributions(member_id);

-- Administrator-managed project categories (unlimited)
CREATE TABLE IF NOT EXISTS project_categories (
  id           BIGSERIAL PRIMARY KEY,
  key          VARCHAR(64) NOT NULL UNIQUE,
  name         VARCHAR(120) NOT NULL,
  description  VARCHAR(320),
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 10. SDP / SACCO — ACCOUNTS, SAVINGS, SHARES, DIVIDENDS
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sacco_accounts (
  id                  BIGSERIAL PRIMARY KEY,
  account_no          VARCHAR(40) NOT NULL UNIQUE,
  member_id           BIGINT NOT NULL REFERENCES members(id) UNIQUE,
  parish_id           BIGINT REFERENCES parishes(id),
  account_type        VARCHAR(24) NOT NULL DEFAULT 'sdp' CHECK (account_type IN ('sdp','sacco','both')),
  savings_balance     NUMERIC(14,2) NOT NULL DEFAULT 0,
  share_capital       NUMERIC(14,2) NOT NULL DEFAULT 0,
  shares_count        INTEGER NOT NULL DEFAULT 0,
  total_deposits      NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_withdrawals   NUMERIC(14,2) NOT NULL DEFAULT 0,
  loan_outstanding    NUMERIC(14,2) NOT NULL DEFAULT 0,
  min_monthly_savings NUMERIC(14,2) NOT NULL DEFAULT 0,
  status              VARCHAR(24) NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','dormant','frozen','closed')),
  opened_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at           TIMESTAMPTZ,
  created_by          BIGINT REFERENCES users(id),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sacco_member ON sacco_accounts(member_id);

CREATE TABLE IF NOT EXISTS savings (
  id               BIGSERIAL PRIMARY KEY,
  sacco_account_id BIGINT NOT NULL REFERENCES sacco_accounts(id) ON DELETE CASCADE,
  member_id        BIGINT NOT NULL REFERENCES members(id),
  receipt_no       VARCHAR(40),
  transaction_type VARCHAR(24) NOT NULL DEFAULT 'deposit'
                   CHECK (transaction_type IN ('deposit','withdrawal','interest','dividend','transfer_in','transfer_out','adjustment','penalty')),
  amount           NUMERIC(14,2) NOT NULL,
  running_balance  NUMERIC(14,2) NOT NULL DEFAULT 0,
  payment_id       BIGINT REFERENCES payments(id),
  payment_method   VARCHAR(24) NOT NULL DEFAULT 'cash',
  reference        VARCHAR(120),
  transaction_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  period           VARCHAR(16),
  notes            VARCHAR(320),
  recorded_by      BIGINT REFERENCES users(id),
  reversed         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_savings_account ON savings(sacco_account_id);
CREATE INDEX IF NOT EXISTS idx_savings_member  ON savings(member_id, transaction_date DESC);

CREATE TABLE IF NOT EXISTS shares (
  id               BIGSERIAL PRIMARY KEY,
  certificate_no   VARCHAR(48) UNIQUE,
  sacco_account_id BIGINT NOT NULL REFERENCES sacco_accounts(id) ON DELETE CASCADE,
  member_id        BIGINT NOT NULL REFERENCES members(id),
  shares_count     INTEGER NOT NULL DEFAULT 0,
  value_per_share  NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_value      NUMERIC(14,2) NOT NULL DEFAULT 0,
  issued_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  status           VARCHAR(24) NOT NULL DEFAULT 'active' CHECK (status IN ('active','transferred','cancelled','redeemed')),
  notes            VARCHAR(320),
  created_by       BIGINT REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shares_member ON shares(member_id);

CREATE TABLE IF NOT EXISTS share_transactions (
  id               BIGSERIAL PRIMARY KEY,
  member_id        BIGINT NOT NULL REFERENCES members(id),
  sacco_account_id BIGINT REFERENCES sacco_accounts(id),
  share_id         BIGINT REFERENCES shares(id),
  transaction_type VARCHAR(32) NOT NULL DEFAULT 'purchase'
                   CHECK (transaction_type IN ('purchase','transfer_in','transfer_out','dividend','bonus','redeem','adjustment','split')),
  shares_count     INTEGER NOT NULL DEFAULT 0,
  value_per_share  NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount           NUMERIC(14,2) NOT NULL DEFAULT 0,
  payment_id       BIGINT REFERENCES payments(id),
  from_member_id   BIGINT REFERENCES members(id),
  to_member_id     BIGINT REFERENCES members(id),
  certificate_no   VARCHAR(48),
  transaction_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes            VARCHAR(320),
  recorded_by      BIGINT REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_share_tx_member ON share_transactions(member_id, transaction_date DESC);

CREATE TABLE IF NOT EXISTS sacco_transactions (
  id               BIGSERIAL PRIMARY KEY,
  sacco_account_id BIGINT NOT NULL REFERENCES sacco_accounts(id) ON DELETE CASCADE,
  member_id        BIGINT NOT NULL REFERENCES members(id),
  ledger_type      VARCHAR(32) NOT NULL
                   CHECK (ledger_type IN ('savings','shares','loan','loan_interest','loan_penalty','dividend','fee','withdrawal','adjustment')),
  direction        VARCHAR(8)  NOT NULL CHECK (direction IN ('debit','credit')),
  amount           NUMERIC(14,2) NOT NULL,
  balance_after    NUMERIC(14,2),
  payment_id       BIGINT REFERENCES payments(id),
  reference_type   VARCHAR(48),
  reference_id     BIGINT,
  description      VARCHAR(320),
  transaction_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_by      BIGINT REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sacco_tx_account ON sacco_transactions(sacco_account_id, transaction_date DESC);

CREATE TABLE IF NOT EXISTS dividends (
  id              BIGSERIAL PRIMARY KEY,
  financial_year  VARCHAR(24) NOT NULL,
  description     VARCHAR(240),
  rate_per_share  NUMERIC(14,2) NOT NULL DEFAULT 0,
  percentage      NUMERIC(8,4) NOT NULL DEFAULT 0,
  total_amount    NUMERIC(14,2) NOT NULL DEFAULT 0,
  declared_date   DATE,
  paid_date       DATE,
  status          VARCHAR(24) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','declared','paid','cancelled')),
  created_by      BIGINT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (financial_year, description)
);

CREATE TABLE IF NOT EXISTS dividend_allocations (
  id             BIGSERIAL PRIMARY KEY,
  dividend_id    BIGINT NOT NULL REFERENCES dividends(id) ON DELETE CASCADE,
  member_id      BIGINT NOT NULL REFERENCES members(id),
  shares_held    INTEGER NOT NULL DEFAULT 0,
  amount         NUMERIC(14,2) NOT NULL DEFAULT 0,
  status         VARCHAR(24) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','credited','paid','cancelled')),
  credited_at    TIMESTAMPTZ,
  payment_id     BIGINT REFERENCES payments(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (dividend_id, member_id)
);

-- ---------------------------------------------------------------------------
-- 11. LOANS
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS loan_types (
  id                    BIGSERIAL PRIMARY KEY,
  code                  VARCHAR(32) NOT NULL UNIQUE,
  name                  VARCHAR(120) NOT NULL,
  description           TEXT,
  min_amount            NUMERIC(14,2) NOT NULL DEFAULT 1000,
  max_amount            NUMERIC(14,2) NOT NULL DEFAULT 100000,
  interest_rate         NUMERIC(8,4) NOT NULL DEFAULT 1,          -- percent
  interest_period       VARCHAR(16) NOT NULL DEFAULT 'monthly' CHECK (interest_period IN ('monthly','annual','daily')),
  interest_method       VARCHAR(24) NOT NULL DEFAULT 'reducing'
                        CHECK (interest_method IN ('flat','reducing','straight','amortised')),
  max_repayment_months  INTEGER NOT NULL DEFAULT 12,
  min_repayment_months  INTEGER NOT NULL DEFAULT 1,
  min_savings_required  NUMERIC(14,2) NOT NULL DEFAULT 0,
  savings_multiplier    NUMERIC(8,2) NOT NULL DEFAULT 3,          -- loan <= multiplier x savings
  min_shares_required   INTEGER NOT NULL DEFAULT 0,
  shares_multiplier     NUMERIC(8,2) NOT NULL DEFAULT 0,
  guarantors_required   INTEGER NOT NULL DEFAULT 2,
  processing_fee_pct    NUMERIC(8,4) NOT NULL DEFAULT 1,
  processing_fee_fixed  NUMERIC(14,2) NOT NULL DEFAULT 0,
  penalty_rate_pct      NUMERIC(8,4) NOT NULL DEFAULT 0,          -- per month on arrears
  penalty_fixed         NUMERIC(14,2) NOT NULL DEFAULT 0,
  grace_days            INTEGER NOT NULL DEFAULT 0,
  eligibility_rules     JSONB NOT NULL DEFAULT '{}'::jsonb,
  min_membership_months INTEGER NOT NULL DEFAULT 0,
  max_active_loans      INTEGER NOT NULL DEFAULT 1,
  requires_collateral   BOOLEAN NOT NULL DEFAULT FALSE,
  active                BOOLEAN NOT NULL DEFAULT TRUE,
  created_by            BIGINT REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS loan_applications (
  id                    BIGSERIAL PRIMARY KEY,
  application_no        VARCHAR(40) NOT NULL UNIQUE,
  member_id             BIGINT NOT NULL REFERENCES members(id),
  loan_type_id          BIGINT NOT NULL REFERENCES loan_types(id),
  amount_requested      NUMERIC(14,2) NOT NULL,
  purpose               VARCHAR(320) NOT NULL,
  repayment_months      INTEGER NOT NULL,
  interest_rate         NUMERIC(8,4) NOT NULL,
  interest_method       VARCHAR(24) NOT NULL DEFAULT 'reducing',
  monthly_repayment     NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_interest        NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_repayable       NUMERIC(14,2) NOT NULL DEFAULT 0,
  processing_fee        NUMERIC(14,2) NOT NULL DEFAULT 0,
  savings_balance       NUMERIC(14,2) NOT NULL DEFAULT 0,
  shares_value          NUMERIC(14,2) NOT NULL DEFAULT 0,
  shares_count          INTEGER NOT NULL DEFAULT 0,
  outstanding_loans     NUMERIC(14,2) NOT NULL DEFAULT 0,
  eligibility_json      JSONB NOT NULL DEFAULT '{}'::jsonb,
  eligibility_passed    BOOLEAN,
  status                VARCHAR(32) NOT NULL DEFAULT 'submitted'
                        CHECK (status IN ('draft','submitted','under_review','guarantor_pending','committee_review',
                                          'approved','rejected','disbursed','cancelled','completed','withdrawn')),
  applied_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by           BIGINT REFERENCES users(id),
  reviewed_at           TIMESTAMPTZ,
  review_notes          TEXT,
  approved_amount       NUMERIC(14,2),
  approved_at           TIMESTAMPTZ,
  approved_by           BIGINT REFERENCES users(id),
  committee_members     JSONB,
  rejection_reason      VARCHAR(320),
  disbursement_date     DATE,
  disbursement_method   VARCHAR(24),
  disbursement_reference VARCHAR(120),
  loan_id               BIGINT,               -- FK added after loans table
  parish_id             BIGINT REFERENCES parishes(id),
  created_by            BIGINT REFERENCES users(id),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_loan_app_member ON loan_applications(member_id);
CREATE INDEX IF NOT EXISTS idx_loan_app_status ON loan_applications(status);

CREATE TABLE IF NOT EXISTS loans (
  id                    BIGSERIAL PRIMARY KEY,
  loan_no               VARCHAR(40) NOT NULL UNIQUE,
  application_id        BIGINT REFERENCES loan_applications(id),
  member_id             BIGINT NOT NULL REFERENCES members(id),
  loan_type_id          BIGINT NOT NULL REFERENCES loan_types(id),
  sacco_account_id      BIGINT REFERENCES sacco_accounts(id),
  principal             NUMERIC(14,2) NOT NULL,
  interest_rate         NUMERIC(8,4) NOT NULL,
  interest_method       VARCHAR(24) NOT NULL DEFAULT 'reducing',
  term_months           INTEGER NOT NULL,
  processing_fee        NUMERIC(14,2) NOT NULL DEFAULT 0,
  monthly_repayment     NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_interest        NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_repayable       NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount_paid           NUMERIC(14,2) NOT NULL DEFAULT 0,
  principal_paid        NUMERIC(14,2) NOT NULL DEFAULT 0,
  interest_paid         NUMERIC(14,2) NOT NULL DEFAULT 0,
  penalties_charged     NUMERIC(14,2) NOT NULL DEFAULT 0,
  penalties_paid        NUMERIC(14,2) NOT NULL DEFAULT 0,
  outstanding_balance   NUMERIC(14,2) NOT NULL DEFAULT 0,
  outstanding_principal NUMERIC(14,2) NOT NULL DEFAULT 0,
  arrears               NUMERIC(14,2) NOT NULL DEFAULT 0,
  next_due_date         DATE,
  first_due_date        DATE,
  maturity_date         DATE,
  disbursed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  disbursed_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
  disbursement_method   VARCHAR(24),
  disbursement_reference VARCHAR(120),
  completed_at          TIMESTAMPTZ,
  status                VARCHAR(24) NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','completed','defaulted','written_off','restructured','closed')),
  notes                 VARCHAR(320),
  created_by            BIGINT REFERENCES users(id),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_loans_member ON loans(member_id);
CREATE INDEX IF NOT EXISTS idx_loans_status ON loans(status);

ALTER TABLE loan_applications DROP CONSTRAINT IF EXISTS loan_app_loan_fk;
ALTER TABLE loan_applications ADD CONSTRAINT loan_app_loan_fk FOREIGN KEY (loan_id) REFERENCES loans(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS loan_schedules (
  id               BIGSERIAL PRIMARY KEY,
  loan_id          BIGINT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  member_id        BIGINT NOT NULL REFERENCES members(id),
  installment_no   INTEGER NOT NULL,
  due_date         DATE NOT NULL,
  opening_balance  NUMERIC(14,2) NOT NULL DEFAULT 0,
  principal        NUMERIC(14,2) NOT NULL DEFAULT 0,
  interest         NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_due        NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount_paid      NUMERIC(14,2) NOT NULL DEFAULT 0,
  balance_after    NUMERIC(14,2) NOT NULL DEFAULT 0,
  paid_at          TIMESTAMPTZ,
  status           VARCHAR(24) NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','due','paid','partial','overdue')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (loan_id, installment_no)
);
CREATE INDEX IF NOT EXISTS idx_loan_schedule_loan ON loan_schedules(loan_id);
CREATE INDEX IF NOT EXISTS idx_loan_schedule_due  ON loan_schedules(due_date);

CREATE TABLE IF NOT EXISTS loan_repayments (
  id                BIGSERIAL PRIMARY KEY,
  loan_id           BIGINT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  member_id         BIGINT NOT NULL REFERENCES members(id),
  payment_id        BIGINT REFERENCES payments(id),
  receipt_no        VARCHAR(40),
  amount            NUMERIC(14,2) NOT NULL,
  principal_portion NUMERIC(14,2) NOT NULL DEFAULT 0,
  interest_portion  NUMERIC(14,2) NOT NULL DEFAULT 0,
  penalty_portion   NUMERIC(14,2) NOT NULL DEFAULT 0,
  balance_after     NUMERIC(14,2) NOT NULL DEFAULT 0,
  repayment_date    TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_early          BOOLEAN NOT NULL DEFAULT FALSE,
  method            VARCHAR(24) NOT NULL DEFAULT 'cash',
  notes             VARCHAR(320),
  recorded_by       BIGINT REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_loan_repay_loan   ON loan_repayments(loan_id);
CREATE INDEX IF NOT EXISTS idx_loan_repay_member ON loan_repayments(member_id, repayment_date DESC);

CREATE TABLE IF NOT EXISTS loan_guarantors (
  id                   BIGSERIAL PRIMARY KEY,
  loan_application_id  BIGINT NOT NULL REFERENCES loan_applications(id) ON DELETE CASCADE,
  loan_id              BIGINT REFERENCES loans(id) ON DELETE CASCADE,
  member_id            BIGINT NOT NULL REFERENCES members(id),          -- borrower
  guarantor_member_id  BIGINT NOT NULL REFERENCES members(id),          -- guarantor
  amount_guaranteed    NUMERIC(14,2) NOT NULL DEFAULT 0,
  guarantor_share_pct  NUMERIC(8,4) NOT NULL DEFAULT 0,
  status               VARCHAR(24) NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','accepted','rejected','released','revoked')),
  requested_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at         TIMESTAMPTZ,
  response_notes       VARCHAR(320),
  relationship         VARCHAR(120),
  notified_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (loan_application_id, guarantor_member_id)
);
CREATE INDEX IF NOT EXISTS idx_guarantors_guarantor ON loan_guarantors(guarantor_member_id);
CREATE INDEX IF NOT EXISTS idx_guarantors_app       ON loan_guarantors(loan_application_id);

CREATE TABLE IF NOT EXISTS penalties (
  id            BIGSERIAL PRIMARY KEY,
  member_id     BIGINT NOT NULL REFERENCES members(id),
  penalty_type  VARCHAR(48) NOT NULL
                CHECK (penalty_type IN ('late_contribution','late_loan','late_savings','late_shares','other')),
  reference_type VARCHAR(48),
  reference_id  BIGINT,
  period        VARCHAR(16),
  amount        NUMERIC(14,2) NOT NULL,
  amount_paid   NUMERIC(14,2) NOT NULL DEFAULT 0,
  reason        VARCHAR(320),
  status        VARCHAR(24) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','waived','cancelled')),
  waived_by     BIGINT REFERENCES users(id),
  waiver_reason VARCHAR(240),
  payment_id    BIGINT REFERENCES payments(id),
  created_by    BIGINT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_penalties_member ON penalties(member_id, status);

-- ---------------------------------------------------------------------------
-- 12. MEETINGS AND ATTENDANCE
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS meetings (
  id            BIGSERIAL PRIMARY KEY,
  title         VARCHAR(200) NOT NULL,
  meeting_type  VARCHAR(32) NOT NULL DEFAULT 'monthly'
                CHECK (meeting_type IN ('monthly','general_assembly','committee','executive','deanery','diocesan',
                                        'national','retreat','training','emergency','other')),
  meeting_date  DATE NOT NULL,
  start_time    TIME,
  end_time      TIME,
  venue         VARCHAR(200),
  parish_id     BIGINT REFERENCES parishes(id),
  church_id     BIGINT REFERENCES churches(id),
  chairperson   VARCHAR(160),
  secretary     VARCHAR(160),
  agenda        TEXT,
  minutes       TEXT,
  qr_code       TEXT,
  attendance_open BOOLEAN NOT NULL DEFAULT FALSE,
  status        VARCHAR(24) NOT NULL DEFAULT 'scheduled'
                CHECK (status IN ('scheduled','ongoing','completed','cancelled')),
  recorded_by   BIGINT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_meetings_date ON meetings(meeting_date DESC);

CREATE TABLE IF NOT EXISTS attendance (
  id            BIGSERIAL PRIMARY KEY,
  meeting_id    BIGINT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  member_id     BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  status        VARCHAR(16) NOT NULL DEFAULT 'absent'
                CHECK (status IN ('present','absent','apology','late')),
  check_in_time TIMESTAMPTZ,
  method        VARCHAR(24) NOT NULL DEFAULT 'manual' CHECK (method IN ('manual','qr','barcode','self','bulk')),
  remarks       VARCHAR(240),
  recorded_by   BIGINT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (meeting_id, member_id)
);
CREATE INDEX IF NOT EXISTS idx_attendance_member ON attendance(member_id);

-- ---------------------------------------------------------------------------
-- 13. NOTIFICATIONS, NOTICES AND COMMUNICATION
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS notifications (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT REFERENCES users(id) ON DELETE CASCADE,
  member_id     BIGINT REFERENCES members(id) ON DELETE CASCADE,
  title         VARCHAR(200) NOT NULL,
  body          TEXT NOT NULL,
  category      VARCHAR(48) NOT NULL DEFAULT 'general',
  priority      VARCHAR(16) NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  channels      JSONB NOT NULL DEFAULT '["in_system"]'::jsonb,
  link          VARCHAR(320),
  reference_type VARCHAR(48),
  reference_id  BIGINT,
  read_at       TIMESTAMPTZ,
  sent_sms      BOOLEAN NOT NULL DEFAULT FALSE,
  sent_email    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user   ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_member ON notifications(member_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notification_logs (
  id             BIGSERIAL PRIMARY KEY,
  notification_id BIGINT REFERENCES notifications(id) ON DELETE CASCADE,
  channel        VARCHAR(16) NOT NULL CHECK (channel IN ('sms','email','whatsapp','in_system')),
  destination    VARCHAR(200),
  provider       VARCHAR(48),
  status         VARCHAR(24) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','delivered','failed','skipped')),
  message        VARCHAR(320),
  payload        JSONB,
  sent_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notif_logs_notification ON notification_logs(notification_id);

CREATE TABLE IF NOT EXISTS notices (
  id            BIGSERIAL PRIMARY KEY,
  title         VARCHAR(200) NOT NULL,
  body          TEXT NOT NULL,
  category      VARCHAR(48) NOT NULL DEFAULT 'general',
  audience      VARCHAR(32) NOT NULL DEFAULT 'all' CHECK (audience IN ('all','parish','church','scc','committee','members_with_debt')),
  parish_id     BIGINT REFERENCES parishes(id),
  church_id     BIGINT REFERENCES churches(id),
  pinned        BOOLEAN NOT NULL DEFAULT FALSE,
  publish_from  TIMESTAMPTZ NOT NULL DEFAULT now(),
  publish_to    TIMESTAMPTZ,
  published_by  BIGINT REFERENCES users(id),
  status        VARCHAR(24) NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','archived')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 14. AUDIT TRAIL AND SYSTEM SETTINGS
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_logs (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  user_name     VARCHAR(160),
  action        VARCHAR(64) NOT NULL,          -- create | update | delete | login | approve | reverse ...
  entity_type   VARCHAR(64),
  entity_id     BIGINT,
  entity_label  VARCHAR(200),
  description   VARCHAR(480),
  old_values    JSONB,
  new_values    JSONB,
  ip_address    VARCHAR(64),
  user_agent    VARCHAR(320),
  severity      VARCHAR(16) NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity  ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_user    ON audit_logs(user_id);

CREATE TABLE IF NOT EXISTS system_settings (
  id            BIGSERIAL PRIMARY KEY,
  key           VARCHAR(96) NOT NULL UNIQUE,
  value         JSONB NOT NULL,
  group_name    VARCHAR(48) NOT NULL DEFAULT 'general',
  description   VARCHAR(320),
  is_secret     BOOLEAN NOT NULL DEFAULT FALSE,
  parish_id     BIGINT REFERENCES parishes(id),
  updated_by    BIGINT REFERENCES users(id),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS backups (
  id            BIGSERIAL PRIMARY KEY,
  file_name     VARCHAR(240) NOT NULL,
  file_path     TEXT,
  size_bytes    BIGINT,
  backup_type   VARCHAR(24) NOT NULL DEFAULT 'manual' CHECK (backup_type IN ('manual','scheduled')),
  status        VARCHAR(24) NOT NULL DEFAULT 'completed' CHECK (status IN ('running','completed','failed')),
  message       VARCHAR(320),
  created_by    BIGINT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 15. HELPER FUNCTION — keep updated_at fresh
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['countries','dioceses','deaneries','parishes','churches','small_christian_communities',
    'members','users','contribution_types','member_contributions','payments','welfare_cases','funeral_cases',
    'wedding_cases','special_projects','sacco_accounts','shares','loan_types','loan_applications','loans',
    'meetings','mpesa_transactions','system_settings']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated ON %I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_updated BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
END $$;
