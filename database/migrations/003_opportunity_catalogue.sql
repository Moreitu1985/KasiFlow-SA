-- KasiFlow SA — shared opportunity catalogue (reference data).
--
-- Rules followed here:
--  * No live tender, grant offer or closing date is invented.
--  * Real programmes/portals link to official sources and are labelled by how far they were checked
--    on 2026-10-16: 'verified_official' only where the official source itself confirmed the details
--    described; otherwise 'requires_verification'. None of these has an application deadline.
--  * Fictional examples are labelled 'sample' and say so in the title.

BEGIN;

INSERT INTO opportunities (title, description, organisation, opportunity_type, industry, eligibility_criteria,
                           required_documents, application_deadline, source_url, geographic_scope,
                           verification_status, last_checked_on)
VALUES
('eTender Publication Portal — find government tenders',
 'National Treasury''s single portal where national, provincial and local government tenders are published. Use it to search for tenders that match what your business supplies. This entry is the portal itself, not a specific tender.',
 'National Treasury', 'procurement', 'any',
 'Each tender sets its own requirements. Most government buyers expect suppliers to be registered on the Central Supplier Database (CSD) and tax compliant.',
 '["Central Supplier Database (CSD) registration number","Tax compliance status","Documents listed in the specific tender"]'::jsonb,
 NULL, 'https://www.etenders.gov.za/', 'National', 'verified_official', DATE '2026-10-16'),

('Central Supplier Database (CSD) registration',
 'Government''s consolidated supplier register used by national, provincial and local government to reduce duplicate compliance checks. Registering is generally required before you can be paid as a government supplier.',
 'National Treasury', 'supplier_registration', 'any',
 'Businesses that want to supply goods or services to government. Check the CSD site for current registration requirements.',
 '["Business registration details (if registered)","Tax details","Banking details (entered directly on the official site only)","Director/owner ID details"]'::jsonb,
 NULL, 'https://secure.csd.gov.za/', 'National', 'requires_verification', DATE '2026-10-16'),

('B-BBEE certificate for Exempted Micro Enterprises via BizPortal',
 'CIPC''s BizPortal offers free B-BBEE certificates for qualifying Exempted Micro Enterprises (private companies or close corporations with turnover of no more than R10 million). Some buyers ask for a B-BBEE certificate or affidavit.',
 'Companies and Intellectual Property Commission (CIPC)', 'market_access', 'any',
 'Registered private companies or close corporations that qualify as Exempted Micro Enterprises. Confirm the current criteria on BizPortal.',
 '["CIPC registration number","Director details"]'::jsonb,
 NULL, 'https://www.bizportal.gov.za/', 'National', 'verified_official', DATE '2026-10-16'),

('NYDA Grant Programme (youth entrepreneurs)',
 'The National Youth Development Agency offers grant funding and business support to young entrepreneurs. Amounts, intake periods and documents change, so confirm the current programme details with the NYDA before applying. Never pay anyone a fee to "guarantee" a grant.',
 'National Youth Development Agency (NYDA)', 'funding', 'any',
 'South African citizens aged 18–35 living in South Africa, running a business that operates in South Africa and involved in its day-to-day running (as described in government publications). Confirm current criteria with the NYDA.',
 '["South African ID","Proof of address","Business plan or business information","Other documents requested by the NYDA"]'::jsonb,
 NULL, 'https://www.nyda.gov.za/', 'National', 'requires_verification', DATE '2026-10-16'),

('Government small-business finance (sefa)',
 'The Small Enterprise Finance Agency (sefa) is a government development-finance agency for small businesses. Products, criteria and the agency''s structure may have changed, so check the official site or contact the agency directly for current information.',
 'Small Enterprise Finance Agency (sefa)', 'funding', 'any',
 'Set by the agency per product. Not verified in KasiFlow — confirm directly.',
 '["Documents requested by the agency for the specific product"]'::jsonb,
 NULL, 'https://www.sefa.org.za/', 'National', 'requires_verification', DATE '2026-10-16'),

('SAMPLE — School uniform supply request (fictional example)',
 'FICTIONAL EXAMPLE used to demonstrate how KasiFlow tracks an opportunity. This is not a real or live opportunity and no organisation is offering it.',
 'Example Community School (fictional)', 'procurement', 'Clothing & retail',
 'Example only: local clothing suppliers with a registered business and CSD registration.',
 '["Example: CSD registration","Example: quotation on letterhead","Example: proof of address"]'::jsonb,
 NULL, NULL, 'Example: Gauteng', 'sample', NULL),

('SAMPLE — Events catering supplier panel (fictional example)',
 'FICTIONAL EXAMPLE of a catering panel opportunity, for demonstration only. It does not exist.',
 'Example Events Company (fictional)', 'market_access', 'Food vendor',
 'Example only: food vendors with a valid certificate of acceptability from the municipality.',
 '["Example: certificate of acceptability","Example: menu and price list"]'::jsonb,
 NULL, NULL, 'Example: KwaZulu-Natal', 'sample', NULL),

('SAMPLE — Barbering skills and business workshop (fictional example)',
 'FICTIONAL EXAMPLE of a training opportunity, for demonstration only. It does not exist.',
 'Example Skills Centre (fictional)', 'training', 'Barber / hair salon',
 'Example only: owners of barber shops or salons.',
 '[]'::jsonb,
 NULL, NULL, 'Example: Gauteng', 'sample', NULL);

INSERT INTO schema_migrations(version) VALUES ('003_opportunity_catalogue');

COMMIT;
