-- 004: Last Respect Insurance — covers members in case of death
-- Provided by external insurance companies, managed by CMA

-- Insurance companies directory
CREATE TABLE IF NOT EXISTS insurance_companies (
  id              BIGSERIAL PRIMARY KEY,
  code            VARCHAR(32) NOT NULL UNIQUE,
  name            VARCHAR(160) NOT NULL,
  short_name      VARCHAR(64),
  country         VARCHAR(80) NOT NULL DEFAULT 'Kenya',
  phone           VARCHAR(32),
  email           VARCHAR(160),
  website         VARCHAR(200),
  contact_person  VARCHAR(160),
  license_no      VARCHAR(80),
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  logo_url        TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_insurance_companies_active ON insurance_companies(active);

-- Last Respect Insurance policies
-- Provides financial support for funeral and end-of-life expenses, ensuring loved ones are not burdened.
-- Immediate cash payouts to beneficiaries, helping families manage funeral arrangements without financial stress.
CREATE TABLE IF NOT EXISTS last_respect_insurances (
  id                    BIGSERIAL PRIMARY KEY,
  policy_no             VARCHAR(40) NOT NULL UNIQUE,
  member_id             BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  insurance_company_id  BIGINT NOT NULL REFERENCES insurance_companies(id),
  -- denormalized company name for reporting (keeps history if company renamed)
  insurance_company_name VARCHAR(160) NOT NULL,
  coverage_type         VARCHAR(32) NOT NULL DEFAULT 'last_respect'
                        CHECK (coverage_type IN ('last_respect','funeral','life','personal_accident','combined')),
  -- Coverage KSh 50,000 to 500,000 as per spec
  coverage_amount       NUMERIC(14,2) NOT NULL DEFAULT 100000
                        CHECK (coverage_amount >= 50000 AND coverage_amount <= 500000),
  premium_amount        NUMERIC(14,2) NOT NULL DEFAULT 500,
  premium_frequency     VARCHAR(16) NOT NULL DEFAULT 'monthly'
                        CHECK (premium_frequency IN ('monthly','quarterly','semi_annual','annual','single')),
  start_date            DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date              DATE,
  maturity_date         DATE,
  -- Eligibility: principal 18-65 or 18-60, children 1 month - 24 years (up to 25 school-going), parents/parents-in-law
  principal_dob         DATE,
  principal_age         INT CHECK (principal_age >= 18 AND principal_age <= 65),
  -- Beneficiary - immediate cash payout
  beneficiary_name      VARCHAR(200) NOT NULL,
  beneficiary_relationship VARCHAR(64) NOT NULL DEFAULT 'spouse'
                        CHECK (beneficiary_relationship IN ('spouse','child','parent','sibling','next_of_kin','other')),
  beneficiary_phone     VARCHAR(32),
  beneficiary_id_no     VARCHAR(32),
  -- member is the insured (principal)
  insured_name          VARCHAR(200),
  insured_dob           DATE,
  -- Dependent coverage flags
  covers_spouse         BOOLEAN NOT NULL DEFAULT FALSE,
  spouse_name           VARCHAR(200),
  spouse_dob            DATE,
  spouse_coverage_amount NUMERIC(14,2) DEFAULT 0,
  covers_children       BOOLEAN NOT NULL DEFAULT FALSE,
  children_count        INT DEFAULT 0,
  children_coverage_amount NUMERIC(14,2) DEFAULT 0,
  covers_parents        BOOLEAN NOT NULL DEFAULT FALSE,
  parents_count         INT DEFAULT 0,
  parents_coverage_amount NUMERIC(14,2) DEFAULT 0,
  -- Payout & claim terms: 48 hours, cause of death illness and accidents, waiting period for illness
  waiting_period_days   INT NOT NULL DEFAULT 90, -- illness waiting period, accident 0
  payout_timeline_hours INT NOT NULL DEFAULT 48,
  cause_of_death_covered VARCHAR(120) NOT NULL DEFAULT 'illness_and_accident'
                        CHECK (cause_of_death_covered IN ('illness_and_accident','accident_only','all_causes')),
  -- payment tracking
  premium_paid_to_date  DATE,
  next_premium_due      DATE,
  total_premiums_paid   NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- status
  status                VARCHAR(24) NOT NULL DEFAULT 'active'
                        CHECK (status IN ('draft','active','lapsed','suspended','claimed','matured','cancelled','expired')),
  payment_status        VARCHAR(24) NOT NULL DEFAULT 'current'
                        CHECK (payment_status IN ('current','overdue','in_arrears','lapsed')),
  -- claim info (when insured dies) - immediate cash payout
  date_of_death         DATE,
  date_claim_filed      DATE,
  claim_amount          NUMERIC(14,2),
  claim_status          VARCHAR(24) CHECK (claim_status IN ('none','pending','approved','paid','rejected')),
  claim_reference       VARCHAR(120),
  claim_paid_at         TIMESTAMPTZ,
  claim_paid_amount     NUMERIC(14,2),
  claim_payout_hours    INT, -- actual hours taken
  -- documents
  policy_document_url   TEXT,
  id_copy_url           TEXT,
  -- audit
  notes                 TEXT,
  parish_id             BIGINT REFERENCES parishes(id),
  created_by            BIGINT REFERENCES users(id),
  updated_by            BIGINT REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_last_respect_member ON last_respect_insurances(member_id);
CREATE INDEX IF NOT EXISTS idx_last_respect_company ON last_respect_insurances(insurance_company_id);
CREATE INDEX IF NOT EXISTS idx_last_respect_status ON last_respect_insurances(status);
CREATE INDEX IF NOT EXISTS idx_last_respect_policy_no ON last_respect_insurances(policy_no);
CREATE INDEX IF NOT EXISTS idx_last_respect_next_due ON last_respect_insurances(next_premium_due);
CREATE INDEX IF NOT EXISTS idx_last_respect_parish ON last_respect_insurances(parish_id);

-- Dependents covered under Last Respect (spouse, children 1 month-24y up to 25 school-going, parents/parents-in-law)
CREATE TABLE IF NOT EXISTS insurance_dependents (
  id                    BIGSERIAL PRIMARY KEY,
  insurance_id          BIGINT NOT NULL REFERENCES last_respect_insurances(id) ON DELETE CASCADE,
  member_id             BIGINT NOT NULL REFERENCES members(id),
  relationship          VARCHAR(32) NOT NULL CHECK (relationship IN ('spouse','child','parent','parent_in_law','other')),
  full_name             VARCHAR(200) NOT NULL,
  dob                   DATE,
  age                   INT,
  id_no                 VARCHAR(32),
  phone                 VARCHAR(32),
  coverage_amount       NUMERIC(14,2) NOT NULL DEFAULT 50000 CHECK (coverage_amount >= 10000 AND coverage_amount <= 500000),
  is_school_going       BOOLEAN DEFAULT FALSE, -- for children up to 25
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_insurance_dependents_insurance ON insurance_dependents(insurance_id);
CREATE INDEX IF NOT EXISTS idx_insurance_dependents_member ON insurance_dependents(member_id);
CREATE INDEX IF NOT EXISTS idx_insurance_dependents_rel ON insurance_dependents(relationship);

-- Premium payments for last respect insurance
CREATE TABLE IF NOT EXISTS insurance_premium_payments (
  id                      BIGSERIAL PRIMARY KEY,
  insurance_id            BIGINT NOT NULL REFERENCES last_respect_insurances(id) ON DELETE CASCADE,
  member_id               BIGINT NOT NULL REFERENCES members(id),
  payment_id              BIGINT REFERENCES payments(id),
  amount                  NUMERIC(14,2) NOT NULL,
  premium_period          VARCHAR(16), -- e.g. 2026-08
  period_start            DATE,
  period_end              DATE,
  paid_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  method                  VARCHAR(24) NOT NULL DEFAULT 'cash',
  receipt_no              VARCHAR(40),
  recorded_by             BIGINT REFERENCES users(id),
  notes                   VARCHAR(320),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_insurance_premiums_insurance ON insurance_premium_payments(insurance_id);
CREATE INDEX IF NOT EXISTS idx_insurance_premiums_member ON insurance_premium_payments(member_id);
CREATE INDEX IF NOT EXISTS idx_insurance_premiums_payment ON insurance_premium_payments(payment_id);

-- Add triggers for updated_at
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['insurance_companies','last_respect_insurances','insurance_dependents','insurance_premium_payments']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated ON %I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_updated BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
END $$;

-- Seed insurance companies (Kenyan + international known for Last Respect / Funeral / Life)
INSERT INTO insurance_companies (code, name, short_name, country, phone, email, website) VALUES
 ('JUB','Jubilee Insurance','Jubilee','Kenya','+254202283000','info@jubileeinsurance.com','https://jubileeinsurance.com'),
 ('BRITAM','Britam Insurance','Britam','Kenya','+254203030000','info@britam.com','https://britam.com'),
 ('CIC','CIC Insurance Group','CIC','Kenya','+254202822000','callcentre@cic.co.ke','https://cic.co.ke'),
 ('ICEA','ICEA LION Group','ICEA LION','Kenya','+254202750000','contact@icealion.com','https://icealion.com'),
 ('MADISON','Madison General Insurance','Madison','Kenya','+254202860000','info@madison.co.ke','https://madison.co.ke'),
 ('APA','APA Insurance','APA','Kenya','+254203640000','info@apainsurance.org','https://apainsurance.org'),
 ('UAP_OM','UAP Old Mutual','UAP Old Mutual','Kenya','+254202853000','info@uapoldmutual.com','https://uapoldmutual.com'),
 ('GA','GA Insurance','GA','Kenya','+254202719699','info@gakenya.com','https://gainsurance.org'),
 ('AAR','AAR Insurance','AAR','Kenya','+254202890000','info@aar.co.ke','https://aar.co.ke'),
 ('PIONEER','Pioneer Assurance','Pioneer','Kenya','+254203222000','info@pioneerassurance.co.ke','https://pioneerassurance.co.ke'),
 ('SANLAM','Sanlam Insurance','Sanlam','Kenya','+254202782000','info@ke.sanlam.com','https://sanlam.co.ke'),
 ('LIBERTY','Liberty Life Assurance','Liberty','Kenya','+254202867000','info@libertylife.co.ke','https://liberty.co.ke'),
 ('FIRST_ASSUR','First Assurance','First Assurance','Kenya','+254202998000','info@firstassurance.co.ke','https://firstassurance.co.ke'),
 ('KENINDIA','Kenindia Assurance','Kenindia','Kenya','+254203398000','info@kenindia.com','https://kenindia.com'),
 ('TAKAFUL','Takaful Insurance of Africa','Takaful','Kenya','+254202580000','info@takafulafrica.com','https://takafulafrica.com'),
 ('CORP','Corporate Insurance','Corporate','Kenya','+254202718133','info@cor.co.ke','https://corporate.co.ke'),
 ('HERITAGE','Heritage Insurance','Heritage','Kenya','+254202780000','info@heritage.co.ke','https://heritage.co.ke'),
 ('OCCIDENTAL','Occidental Insurance','Occidental','Kenya','+254202300000','info@occidental.co.ke','https://occidental.co.ke'),
 ('AMACO','AMACO Insurance','AMACO','Kenya','+254202224000','info@amaco.co.ke','https://amaco.co.ke'),
 ('XPLICO','Xplico Insurance','Xplico','Kenya','+254207600000','info@xplico.co.ke','https://xplico.co.ke'),
 -- International
 ('PRUDENTIAL','Prudential Life Assurance','Prudential','UK','+441412750000','info@prudential.co.uk','https://prudential.co.uk'),
 ('ALLIANZ','Allianz Insurance','Allianz','Germany','+4989380000','info@allianz.com','https://allianz.com'),
 ('AXA','AXA Insurance','AXA','France','+33140757575','info@axa.com','https://axa.com'),
 ('METLIFE','MetLife','MetLife','USA','+12125780000','info@metlife.com','https://metlife.com'),
 ('AIG','AIG Insurance','AIG','USA','+12127708000','info@aig.com','https://aig.com'),
 ('AVIVA','Aviva Insurance','Aviva','UK','+441603452200','info@aviva.com','https://aviva.com'),
 ('ZURICH','Zurich Insurance','Zurich','Switzerland','+41446252828','info@zurich.com','https://zurich.com'),
 ('OLD_MUTUAL','Old Mutual','Old Mutual','South Africa','+27215095000','info@oldmutual.com','https://oldmutual.com'),
 ('HOLARD','Hollard Insurance','Hollard','South Africa','+27118860000','info@hollard.co.za','https://hollard.co.za'),
 ('LEADWAY','Leadway Assurance','Leadway','Nigeria','+23412708000','info@leadway.com','https://leadway.com')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, active = TRUE;

-- Add permissions for insurance module
INSERT INTO permissions (key, module, action, description) VALUES
 ('insurance.view','insurance','view','View Last Respect Insurance policies'),
 ('insurance.create','insurance','create','Create Last Respect Insurance policy'),
 ('insurance.update','insurance','update','Update insurance policy'),
 ('insurance.delete','insurance','delete','Delete insurance policy'),
 ('insurance.approve','insurance','approve','Approve / claim insurance'),
 ('insurance.export','insurance','export','Export insurance reports')
ON CONFLICT (key) DO NOTHING;

-- Grant to relevant roles (re-create grant function if not exists from 002)
DO $$
DECLARE rid bigint;
BEGIN
  -- super_admin gets all via 002, but ensure
  SELECT id INTO rid FROM roles WHERE key = 'super_admin';
  IF rid IS NOT NULL THEN
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT rid, id FROM permissions WHERE module = 'insurance' ON CONFLICT DO NOTHING;
  END IF;

  -- admin, treasurer, secretary, chairman, sacco_officer
  FOR rid IN SELECT id FROM roles WHERE key IN ('admin','treasurer','secretary','chairman','sacco_officer','auditor') LOOP
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT rid, id FROM permissions WHERE module = 'insurance' AND action IN ('view','export') ON CONFLICT DO NOTHING;
  END LOOP;

  FOR rid IN SELECT id FROM roles WHERE key IN ('admin','treasurer','secretary') LOOP
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT rid, id FROM permissions WHERE module = 'insurance' AND action IN ('create','update','approve') ON CONFLICT DO NOTHING;
  END LOOP;

  FOR rid IN SELECT id FROM roles WHERE key = 'member' LOOP
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT rid, id FROM permissions WHERE key = 'insurance.view' ON CONFLICT DO NOTHING;
  END LOOP;
END $$;
