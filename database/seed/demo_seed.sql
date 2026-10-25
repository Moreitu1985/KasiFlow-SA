-- KasiFlow SA — FICTIONAL demonstration data: "Thato's Barber Studio" (Gauteng).
--
-- Every person, business, amount and message below is invented. Dates are relative to today
-- (South African time) so the demo always shows the same situation whenever it is seeded.
--
-- Usage (the user must already exist in Supabase Auth — sign up in the app first):
--   psql "$DATABASE_URL" -v user_id=<supabase-user-uuid> -f database/seed/demo_seed.sql
-- or
--   dotnet run --project KasiFlow.Api -- seed-demo --user-id <supabase-user-uuid>
--
-- Expected numbers (D = today):
--   Opening balance R800.00 on D-45
--   Counted income  R6,890.00  (7 cash/card sales R6,690.00 + R200.00 debt collection)
--   Counted expense R6,190.00  (includes R100.00 of actual house-call costs from yesterday's visit)
--   => Cash balance today R1,500.00   (a R300.00 sale and a R200.00 house-call EFT awaiting confirmation are NOT counted:
--      their proofs of payment are unverified)
--   Forecast (30 days, buffer R500.00):
--     D+3  bill Gauteng Barber Supplies  -R1,450.00 -> R50.00   (below buffer)
--     D+5  scheduled airtime/data        -R150.00   -> -R100.00 (CASH SHORTFALL in 5 days)
--     D+9  expected from Lerato K.       +R1,200.00 -> R1,100.00 (expected, not confirmed)
--     D+17 rent due                      -R1,500.00 -> -R400.00 (lowest point)
--   Sipho M. owes R400.00, overdue since D-10 (excluded from forecast).
--   Kabelo D. owes R250.00 with no due date (excluded; flagged as missing information).
--   About six months of earlier history is dated before the opening-balance date: it fills the reports and
--   charts but does not change today's cash balance.

CREATE TEMP TABLE IF NOT EXISTS kasiflow_seed_params (user_id uuid NOT NULL);
TRUNCATE kasiflow_seed_params;
INSERT INTO kasiflow_seed_params VALUES (:'user_id');

DO $$
DECLARE
    v_user uuid := (SELECT user_id FROM kasiflow_seed_params LIMIT 1);
    d date := (now() AT TIME ZONE 'Africa/Johannesburg')::date;
    b uuid;
    c_sipho uuid; c_lerato uuid; c_kabelo uuid;
    s_supplies uuid; s_landlord uuid;
    r_sipho uuid; r_lerato uuid; r_kabelo uuid;
    p_supplies uuid; p_rent uuid;
    t uuid;
    o uuid;
    br uuid;
    pr uuid;
    st_thato uuid; st_bongani uuid; st_ayanda uuid; st_neo uuid;
    sv_cut uuid; sv_fade uuid; sv_beard uuid; sv_lineup uuid; sv_wash uuid; sv_combo uuid; sv_kids uuid;
    c_mandla uuid; c_tumi uuid; r_tumi uuid;
    bk uuid; bk_hc uuid;
    cu_nomsa uuid := gen_random_uuid();
    hd date; hh int; hm int; hs uuid; hsv uuid; hcust int; hstatus text; hk int;
    names text[] := ARRAY['Sipho M.','Lerato K.','Kabelo D.','Thabo N.','Karabo S.','Lwazi M.','Mpho R.','Tshepo L.','Bongani K.','Andile Z.','Katlego P.','Neo M.','Themba G.','Kagiso P.','Mandla Z.','Tumi N.','Vusi B.','Sello T.','Jabu C.','Lebo F.','Musa H.','Kamo V.','Tebogo W.','Dumi X.','Ofentse Y.'];  -- fictional customer account (no sign-in exists for it)
    sh uuid;
    tz text := 'Africa/Johannesburg';
BEGIN
    IF EXISTS (SELECT 1 FROM businesses bb JOIN business_members m ON m.business_id = bb.id
               WHERE m.user_id = v_user AND bb.name = 'Thato''s Barber Studio') THEN
        RAISE NOTICE 'Demo business already exists for this user; nothing to do.';
        RETURN;
    END IF;

    INSERT INTO businesses (name, business_type, owner_name, contact_email, contact_phone, province, town, registration_status, created_by, is_demo)
    VALUES ('Thato''s Barber Studio', 'Barber / hair salon', 'Thato Mokoena (fictional)', 'demo@example.com', '+27 00 000 0000',
            'gauteng', 'Soweto (fictional demo)', 'in_progress', v_user, TRUE)
    RETURNING id INTO b;
    INSERT INTO business_members (business_id, user_id, role, display_name) VALUES (b, v_user, 'owner', 'Owner (you)');
    -- One branch. No fictional staff accounts are created: staff join through real invitations.
    INSERT INTO branches (business_id, name, area) VALUES (b, 'Main studio', 'Soweto (fictional demo)') RETURNING id INTO br;
    INSERT INTO business_settings (business_id, opening_cash_balance_cents, opening_balance_date, cash_buffer_cents, forecast_days)
    VALUES (b, 80000, d - 45, 50000, 30);

    -- Six months of earlier trading history (dated BEFORE the opening-balance date, so it appears in
    -- reports and charts but is already reflected in the opening balance and does not change today's cash).
    -- Amounts vary deterministically so the demo is identical every time it is seeded.
    INSERT INTO transactions (business_id, type, description, amount_cents, category, transaction_date, payment_method, created_by)
    SELECT b, 'income', 'Haircuts — week takings', 85000 + ((w * 37) % 9) * 5000, 'Sales', d - 46 - 7 * w,
           CASE WHEN w % 3 = 0 THEN 'mobile_payment' WHEN w % 3 = 1 THEN 'cash' ELSE 'card' END, v_user
    FROM generate_series(0, 19) AS w;

    INSERT INTO transactions (business_id, type, description, amount_cents, category, transaction_date, payment_method, created_by)
    SELECT b, x.type, x.descr, x.amount, x.cat, d - 46 - 30 * m - x.offs, x.method, v_user
    FROM generate_series(0, 4) AS m
    CROSS JOIN LATERAL (VALUES
        ('expense', 'Shop rent', 150000, 'Rent', 1, 'eft'),
        ('expense', 'Clipper oil, blades and products', 38000 + (m % 3) * 3000, 'Stock & supplies', 6, 'cash'),
        ('expense', 'Hair products restock', 35000 + (m % 2) * 4000, 'Stock & supplies', 20, 'cash'),
        ('expense', 'Airtime and data bundle', 15000, 'Airtime & data', 12, 'mobile_payment'),
        ('expense', 'Prepaid electricity', 28000 + (m % 2) * 3000, 'Utilities', 2, 'card'),
        ('expense', 'Assistant barber wages', 110000, 'Wages', 25, 'eft'),
        ('income', 'Kids'' back-to-school cuts (group booking)', 45000 + m * 2500, 'Services', 15, 'cash')
    ) AS x(type, descr, amount, cat, offs, method);

    -- Posted, confirmed sales (R6,690.00)
    INSERT INTO transactions (business_id, type, description, amount_cents, category, transaction_date, payment_method, created_by) VALUES
      (b, 'income', 'Haircuts and fades — week takings', 85000, 'Sales', d - 44, 'cash', v_user),
      (b, 'income', 'Haircuts and beard trims — week takings', 92000, 'Sales', d - 37, 'cash', v_user),
      (b, 'income', 'Haircuts — week takings (mobile payments)', 110000, 'Sales', d - 30, 'mobile_payment', v_user),
      (b, 'income', 'Haircuts — week takings', 98000, 'Sales', d - 23, 'cash', v_user),
      (b, 'income', 'Haircuts and colour — week takings (card)', 105000, 'Sales', d - 16, 'card', v_user),
      (b, 'income', 'Haircuts — week takings', 115000, 'Sales', d - 9, 'cash', v_user),
      (b, 'income', 'Haircuts — weekend takings', 64000, 'Sales', d - 2, 'cash', v_user);

    -- Posted, confirmed expenses (R6,190.00)
    INSERT INTO transactions (business_id, type, description, amount_cents, category, transaction_date, payment_method, created_by) VALUES
      (b, 'expense', 'Shop rent', 150000, 'Rent', d - 43, 'eft', v_user),
      (b, 'expense', 'Clipper oil, blades and neck strips', 42000, 'Stock & supplies', d - 40, 'cash', v_user),
      (b, 'expense', 'Airtime and data bundle', 15000, 'Airtime & data', d - 29, 'mobile_payment', v_user),
      (b, 'expense', 'Hair products and disinfectant', 38000, 'Stock & supplies', d - 26, 'cash', v_user),
      (b, 'expense', 'Shop rent', 150000, 'Rent', d - 13, 'eft', v_user),
      (b, 'expense', 'Prepaid electricity', 30000, 'Utilities', d - 12, 'card', v_user),
      (b, 'expense', 'Taxi fare to supplier', 12000, 'Transport', d - 7, 'cash', v_user),
      (b, 'expense', 'Replacement clipper blade set', 55000, 'Equipment', d - 3, 'card', v_user),
      (b, 'expense', 'Assistant barber wages', 117000, 'Wages', d - 1, 'eft', v_user);

    -- A sale paid by "EFT" with proof sent over WhatsApp — not yet visible in the account
    INSERT INTO transactions (business_id, type, description, amount_cents, category, transaction_date, payment_method, payment_status, reference, notes, created_by)
    VALUES (b, 'income', 'Group booking — EFT proof received by message', 30000, 'Sales', d - 1, 'eft', 'awaiting_confirmation',
            'POP-DEMO-001', 'Fictional: check the bank app before treating this as paid.', v_user);

    -- Scheduled (planned) expense
    INSERT INTO transactions (business_id, type, description, amount_cents, category, transaction_date, payment_method, status, created_by)
    VALUES (b, 'expense', 'Monthly airtime and data bundle', 15000, 'Airtime & data', d + 5, 'mobile_payment', 'scheduled', v_user);

    -- Customers and debts
    INSERT INTO customers (business_id, name, phone, notes) VALUES (b, 'Sipho M. (fictional)', '+27 00 000 0001', 'Soccer club coach')
      RETURNING id INTO c_sipho;
    INSERT INTO customers (business_id, name, phone, notes) VALUES (b, 'Lerato K. (fictional)', '+27 00 000 0002', 'Wedding party booking')
      RETURNING id INTO c_lerato;
    INSERT INTO customers (business_id, name) VALUES (b, 'Kabelo D. (fictional)') RETURNING id INTO c_kabelo;

    INSERT INTO receivables (business_id, customer_id, description, original_amount_cents, issue_date, due_date)
    VALUES (b, c_sipho, 'Team haircuts for under-12 soccer side (on credit)', 60000, d - 20, d - 10) RETURNING id INTO r_sipho;
    INSERT INTO receivables (business_id, customer_id, description, original_amount_cents, issue_date, due_date)
    VALUES (b, c_lerato, 'Wedding party grooming — balance owed', 120000, d - 5, d + 9) RETURNING id INTO r_lerato;
    INSERT INTO receivables (business_id, customer_id, description, original_amount_cents, issue_date, due_date)
    VALUES (b, c_kabelo, 'Haircut and dye (pay later)', 25000, d - 6, NULL) RETURNING id INTO r_kabelo;

    -- Sipho paid R200.00 of R600.00 (creates exactly one Debt collection income transaction)
    INSERT INTO transactions (business_id, type, description, amount_cents, category, transaction_date, payment_method, source, created_by)
    VALUES (b, 'income', 'Payment from Sipho M. (fictional): Team haircuts for under-12 soccer side (on credit)', 20000, 'Debt collection',
            d - 8, 'cash', 'receivable_payment', v_user) RETURNING id INTO t;
    INSERT INTO receivable_payments (business_id, receivable_id, transaction_id, amount_cents, payment_date) VALUES (b, r_sipho, t, 20000, d - 8);

    -- Suppliers and bills
    INSERT INTO suppliers (business_id, name, phone, notes) VALUES (b, 'Gauteng Barber Supplies (fictional)', '+27 00 000 0003', 'Monthly stock order')
      RETURNING id INTO s_supplies;
    INSERT INTO suppliers (business_id, name, notes) VALUES (b, 'Mrs Dlamini — landlord (fictional)', 'Shop rent, due monthly') RETURNING id INTO s_landlord;

    INSERT INTO payables (business_id, supplier_id, description, category, original_amount_cents, bill_date, due_date, reference)
    VALUES (b, s_supplies, 'Monthly stock order: clipper oil, blades and products', 'Stock & supplies', 145000, d - 6, d + 3, 'INV-DEMO-104')
      RETURNING id INTO p_supplies;
    INSERT INTO payables (business_id, supplier_id, description, category, original_amount_cents, bill_date, due_date)
    VALUES (b, s_landlord, 'Shop rent for next month', 'Rent', 150000, d, d + 17) RETURNING id INTO p_rent;

    -- Readiness progress
    INSERT INTO registration_checklist_items (business_id, item_key, completed, notes) VALUES
      (b, 'choose_structure', TRUE, 'Decided to register a private company.'),
      (b, 'business_bank_account', TRUE, NULL);
    INSERT INTO funding_profiles (business_id, funding_purpose, amount_requested_cents, business_bank_account_status)
    VALUES (b, 'Buy a second barber chair and clippers so the assistant can serve clients at the same time.', 1500000, 'has_business_account');
    INSERT INTO funding_readiness_items (business_id, item_key, completed) VALUES (b, 'business_plan', TRUE);

    -- Public profile
    INSERT INTO public_profiles (business_id, slug, is_published, description, category, products_services, show_phone, show_email,
                                 show_town, service_area, opening_hours)
    VALUES (b,
            -- Public links are unique across all accounts: the first demo gets the short link, later copies a suffix.
            CASE WHEN EXISTS (SELECT 1 FROM public_profiles WHERE slug = 'thatos-barber-studio-demo')
                 THEN 'thatos-barber-studio-demo-' || left(replace(b::text, '-', ''), 8)
                 ELSE 'thatos-barber-studio-demo' END,
            TRUE,
            'A fictional demo barber shop: neat fades, beard trims and kids'' cuts in a friendly neighbourhood studio.',
            'Barber / hair salon', E'Fades and haircuts\nBeard trims\nKids'' cuts\nHair colour', TRUE, FALSE, TRUE,
            'Fictional demo area', 'Tue–Sat 08:00–18:00, Sun 09:00–14:00');

    -- Fraud incident (fictional)
    INSERT INTO fraud_incidents (business_id, incident_type, description, incident_date, status, action_taken, private_notes)
    VALUES (b, 'bank_detail_change',
            'Received a message claiming to be from the stock supplier, saying their bank account has changed and asking for the next payment to go to a new account.',
            d - 4, 'monitoring',
            'Did not pay. Phoned the supplier on the number already saved in the phone; they confirmed their banking details have NOT changed.',
            'Fictional demo incident.');

    -- Track a sample opportunity
    SELECT id INTO o FROM opportunities WHERE business_id IS NULL AND verification_status = 'sample' AND opportunity_type = 'training' LIMIT 1;
    IF o IS NOT NULL THEN
        INSERT INTO saved_opportunities (business_id, opportunity_id, application_status, notes)
        VALUES (b, o, 'preparing', 'Demo: sample opportunity, not real.');
    END IF;

    -- Every demo transaction belongs to the one branch.
    UPDATE transactions SET branch_id = br WHERE business_id = b AND branch_id IS NULL;

    -- Retail stock (fictional products). Opening stock, then a month of sales so reorder suggestions have history.
    INSERT INTO products (business_id, sku, barcode, name, kind, unit_price_cents, unit_cost_cents, min_stock_qty, lead_time_days, supplier_id)
    VALUES (b, 'POMADE-100', '600000000001', 'Styling pomade 100 ml (demo)', 'product', 8500, 4500, 5, 5, s_supplies),
           (b, 'BEARD-OIL-30', '600000000002', 'Beard oil 30 ml (demo)', 'product', 12000, 6000, 4, 7, s_supplies),
           (b, 'SHAMPOO-250', '600000000003', 'Shampoo 250 ml (demo)', 'product', 9500, 5000, 6, 5, s_supplies),
           (b, 'CUT-ADULT', NULL, 'Adult haircut', 'service', 8000, 0, 0, NULL, NULL);
    FOR pr IN SELECT id FROM products WHERE business_id = b AND kind = 'product' LOOP
        INSERT INTO stock_movements (business_id, product_id, branch_id, movement_type, quantity_delta, unit_cost_cents, reason, created_by, created_at)
        SELECT b, pr, br, 'received', CASE WHEN p.sku = 'BEARD-OIL-30' THEN 18 ELSE 24 END, p.unit_cost_cents, 'Opening stock (demo)', v_user, (d - 30)::timestamp + time '09:00'
        FROM products p WHERE p.id = pr;
        INSERT INTO stock_movements (business_id, product_id, branch_id, movement_type, quantity_delta, reason, created_by, created_at)
        SELECT b, pr, br, 'sold', -1, 'Counter sale (demo)', v_user, (d - k)::timestamp + time '14:00'
        FROM generate_series(1, 28) AS k
        WHERE (k + (SELECT ascii(right(sku, 1)) FROM products WHERE id = pr)) % (CASE WHEN (SELECT sku FROM products WHERE id = pr) = 'BEARD-OIL-30' THEN 2 ELSE 3 END) = 0;
        INSERT INTO inventory_levels (business_id, product_id, branch_id, quantity)
        SELECT b, pr, br, COALESCE(SUM(quantity_delta), 0) FROM stock_movements WHERE product_id = pr AND branch_id = br;
    END LOOP;

    -- -----------------------------------------------------------------------------------------------
    -- Barbershop platform (all people below are fictional; they have no logins except the owner)
    -- -----------------------------------------------------------------------------------------------
    UPDATE business_settings SET house_calls_enabled = TRUE, travel_fee_mode = 'flat', travel_fee_flat_cents = 10000, min_travel_fee_cents = 10000,
        max_travel_km = 25, booking_auto_confirm = FALSE, allow_off_duty_override = FALSE,
        debt_charge_enabled = FALSE, debt_charge_cents = 500, debt_charge_overdue_days = 7, debt_charge_legal_reviewed = FALSE,
        debt_charge_terms = 'If an amount you owe is more than 7 days overdue, a once-off R5 late charge applies. (Demo wording — not legally reviewed.)'
    WHERE business_id = b;

    INSERT INTO services (business_id, name, description, category, price_cents, duration_minutes, allows_house_call, sort_order) VALUES
      (b, 'Haircut', 'Classic clipper or scissor cut.', 'Hair', 8000, 30, TRUE, 1) RETURNING id INTO sv_cut;
    INSERT INTO services (business_id, name, description, category, price_cents, duration_minutes, allows_house_call, sort_order) VALUES
      (b, 'Fade', 'Skin, low, mid or high fade.', 'Hair', 10000, 40, TRUE, 2) RETURNING id INTO sv_fade;
    INSERT INTO services (business_id, name, description, category, price_cents, duration_minutes, allows_house_call, sort_order) VALUES
      (b, 'Beard trim', 'Shape-up and trim.', 'Beard', 5000, 20, TRUE, 3) RETURNING id INTO sv_beard;
    INSERT INTO services (business_id, name, description, category, price_cents, duration_minutes, allows_house_call, sort_order) VALUES
      (b, 'Line-up', 'Sharp edges and hairline.', 'Hair', 4000, 15, TRUE, 4) RETURNING id INTO sv_lineup;
    INSERT INTO services (business_id, name, description, category, price_cents, duration_minutes, allows_house_call, sort_order) VALUES
      (b, 'Wash and styling', 'Wash, condition and style.', 'Hair', 7000, 30, FALSE, 5) RETURNING id INTO sv_wash;
    INSERT INTO services (business_id, name, description, category, price_cents, duration_minutes, allows_house_call, sort_order) VALUES
      (b, 'Haircut and beard combo', 'Haircut plus beard trim.', 'Combo', 12000, 50, TRUE, 6) RETURNING id INTO sv_combo;
    INSERT INTO services (business_id, name, description, category, price_cents, duration_minutes, allows_house_call, sort_order) VALUES
      (b, 'Kids cut (under 12)', NULL, 'Hair', 6000, 25, TRUE, 7) RETURNING id INTO sv_kids;

    INSERT INTO staff_profiles (business_id, user_id, display_name, role_title, branch_id, accepts_house_calls)
      VALUES (b, v_user, 'Thato (owner)', 'Owner & barber', br, TRUE) RETURNING id INTO st_thato;
    INSERT INTO staff_profiles (business_id, display_name, role_title, branch_id, accepts_house_calls)
      VALUES (b, 'Bongani (fictional)', 'Barber', br, FALSE) RETURNING id INTO st_bongani;
    INSERT INTO staff_profiles (business_id, display_name, role_title, branch_id, accepts_house_calls)
      VALUES (b, 'Ayanda (fictional)', 'Barber', br, TRUE) RETURNING id INTO st_ayanda;
    INSERT INTO staff_profiles (business_id, display_name, role_title, branch_id, accepts_house_calls)
      VALUES (b, 'Neo (fictional)', 'Junior barber (student)', br, FALSE) RETURNING id INTO st_neo;

    UPDATE staff_profiles SET bio = 'Owner. Clean fades and beard work since 2015 (fictional).', specialties = 'Fades, beard sculpting' WHERE id = st_thato;
    UPDATE staff_profiles SET bio = 'Patient with first-timers (fictional).', specialties = 'Classic cuts, line-ups' WHERE id = st_bongani;
    UPDATE staff_profiles SET bio = 'Does house calls for families and events (fictional).', specialties = 'Kids cuts, house calls',
        emergency_contact_name = 'Sister (fictional)', emergency_contact_phone = '+27 00 000 0020' WHERE id = st_ayanda;
    UPDATE staff_profiles SET bio = 'Junior barber, studying part-time (fictional).', specialties = 'Line-ups' WHERE id = st_neo;

    -- Working hours: Mon–Sat 08:00–18:00, Sun 09:00–14:00 (Neo works afternoons around classes).
    INSERT INTO staff_working_hours (business_id, staff_id, weekday, start_time, end_time)
    SELECT b, s.id, w.d, CASE WHEN w.d = 0 THEN time '09:00' ELSE time '08:00' END, CASE WHEN w.d = 0 THEN time '14:00' ELSE time '18:00' END
    FROM (VALUES (st_thato), (st_bongani), (st_ayanda)) AS s(id) CROSS JOIN generate_series(0, 6) AS w(d);
    INSERT INTO staff_working_hours (business_id, staff_id, weekday, start_time, end_time)
    SELECT b, st_neo, w.d, time '14:00', time '18:00' FROM generate_series(1, 6) AS w(d);
    INSERT INTO staff_time_off (business_id, staff_id, starts_at, ends_at, kind, note, created_by)
    VALUES (b, st_neo, ((d + 3) + time '08:00') AT TIME ZONE tz, ((d + 3) + time '18:00') AT TIME ZONE tz, 'exam', 'Exam day (fictional)', v_user);

    -- Everyone can do every service; Thato charges his own price for the combo.
    INSERT INTO staff_services (business_id, staff_id, service_id, price_cents)
    SELECT b, s.id, sv.id, CASE WHEN s.id = st_thato AND sv.id = sv_combo THEN 13000 ELSE NULL END
    FROM (VALUES (st_thato), (st_bongani), (st_ayanda), (st_neo)) AS s(id) CROSS JOIN services sv WHERE sv.business_id = b;

    -- Current statuses and a history of switching between them.
    INSERT INTO staff_status (staff_id, business_id, status, note, updated_by, updated_at) VALUES
      (st_thato, b, 'available', NULL, v_user, now() - interval '20 minutes'),
      (st_bongani, b, 'busy', 'With a customer', v_user, now() - interval '10 minutes'),
      (st_ayanda, b, 'house_call', 'Orlando West visit', v_user, now() - interval '30 minutes'),
      (st_neo, b, 'off_duty', 'Class today', v_user, now() - interval '3 hours');
    INSERT INTO staff_status_history (business_id, staff_id, status, note, source, changed_by, created_at) VALUES
      (b, st_bongani, 'available', NULL, 'manual', v_user, now() - interval '3 hours'),
      (b, st_bongani, 'busy', 'With a customer', 'manual', v_user, now() - interval '150 minutes'),
      (b, st_bongani, 'on_break', 'Lunch', 'manual', v_user, now() - interval '90 minutes'),
      (b, st_bongani, 'available', NULL, 'expiry', NULL, now() - interval '60 minutes'),
      (b, st_bongani, 'busy', 'With a customer', 'manual', v_user, now() - interval '10 minutes'),
      (b, st_ayanda, 'available', NULL, 'manual', v_user, now() - interval '4 hours'),
      (b, st_ayanda, 'house_call', 'Orlando West visit', 'manual', v_user, now() - interval '30 minutes'),
      (b, st_neo, 'off_duty', 'Class today', 'manual', v_user, now() - interval '3 hours'),
      (b, st_thato, 'available', NULL, 'manual', v_user, now() - interval '20 minutes');

    INSERT INTO customers (business_id, name, phone) VALUES (b, 'Mandla Z. (fictional)', '+27 00 000 0004') RETURNING id INTO c_mandla;
    INSERT INTO customers (business_id, name, phone) VALUES (b, 'Tumi N. (fictional)', '+27 00 000 0005') RETURNING id INTO c_tumi;

    -- Today: confirmed appointments
    INSERT INTO bookings (business_id, reference, customer_id, customer_name, customer_phone, staff_id, branch_id, starts_at, ends_at, status,
        services_total_cents, total_cents, source, confirmed_by, confirmed_at, created_by)
    VALUES (b, 'BK-' || upper(substr(md5(random()::text), 1, 8)), c_mandla, 'Mandla Z. (fictional)', '+27 00 000 0004', st_thato, br,
        (d + time '10:00') AT TIME ZONE tz, (d + time '10:50') AT TIME ZONE tz, 'confirmed', 13000, 13000, 'staff', v_user, now(), v_user) RETURNING id INTO bk;
    INSERT INTO booking_items (business_id, booking_id, service_id, service_name, unit_price_cents, duration_minutes) VALUES (b, bk, sv_combo, 'Haircut and beard combo', 13000, 50);
    INSERT INTO booking_events (business_id, booking_id, event, to_status, actor_kind, actor_user_id) VALUES (b, bk, 'confirmed', 'confirmed', 'staff', v_user);

    INSERT INTO bookings (business_id, reference, customer_name, customer_phone, staff_id, branch_id, starts_at, ends_at, status,
        services_total_cents, total_cents, source, confirmed_by, confirmed_at, created_by)
    VALUES (b, 'BK-' || upper(substr(md5(random()::text), 1, 8)), 'Kagiso P. (fictional)', '+27 00 000 0006', st_bongani, br,
        (d + time '11:00') AT TIME ZONE tz, (d + time '11:40') AT TIME ZONE tz, 'confirmed', 10000, 10000, 'staff', v_user, now(), v_user) RETURNING id INTO bk;
    INSERT INTO booking_items (business_id, booking_id, service_id, service_name, unit_price_cents, duration_minutes) VALUES (b, bk, sv_fade, 'Fade', 10000, 40);

    -- Today: a house call for three people at one address (address is private)
    INSERT INTO bookings (business_id, reference, customer_name, customer_phone, staff_id, branch_id, location_type, starts_at, ends_at, status,
        people_count, services_total_cents, travel_fee_cents, total_cents, source, confirmed_by, confirmed_at, created_by, customer_note)
    VALUES (b, 'BK-' || upper(substr(md5(random()::text), 1, 8)), 'Nomsa R. (fictional)', '+27 00 000 0007', st_ayanda, br, 'house_call',
        (d + time '14:00') AT TIME ZONE tz, (d + time '15:25') AT TIME ZONE tz, 'confirmed', 3, 22000, 10000, 32000, 'public', v_user, now(), NULL,
        'Two boys and their dad, before a family function.') RETURNING id INTO bk;
    -- The house call was booked with a (fictional) verified customer account, which house calls require.
    INSERT INTO customer_accounts (user_id, full_name, contact_phone, verified_email, address_line, suburb, town, access_notes,
        house_call_terms_version, house_call_terms_accepted_at)
    VALUES (cu_nomsa, 'Nomsa R. (fictional)', '+27 00 000 0007', 'nomsa.demo@example.com', '12 Example Street (fictional)', 'Orlando West', 'Soweto',
        'Blue gate, ring twice.', 'house-call-safety-v1', now() - interval '20 days');
    UPDATE bookings SET customer_user_id = cu_nomsa, verified_contact = 'nomsa.demo@example.com' WHERE id = bk;
    INSERT INTO customer_safety_notes (business_id, customer_user_id, booking_id, category, note, created_by)
    VALUES (b, cu_nomsa, bk, 'pets', 'Friendly dog in the yard; the customer ties it up when you arrive (fictional).', v_user);
    -- Safety check-ins so far (only those that would already have happened at seeding time).
    IF now() > (d + time '13:35') AT TIME ZONE tz THEN
        INSERT INTO house_call_checkins (business_id, booking_id, staff_id, kind, note, created_by, created_at)
        VALUES (b, bk, st_ayanda, 'departed', 'Taking a taxi from the shop (fictional).', v_user, (d + time '13:35') AT TIME ZONE tz);
    END IF;
    IF now() > (d + time '14:02') AT TIME ZONE tz THEN
        INSERT INTO house_call_checkins (business_id, booking_id, staff_id, kind, latitude, longitude, accuracy_m, note, created_by, created_at)
        VALUES (b, bk, st_ayanda, 'arrived', -26.237650, 27.909120, 18, 'Shared my location with this check-in.', v_user, (d + time '14:02') AT TIME ZONE tz);
    END IF;
    INSERT INTO booking_items (business_id, booking_id, service_id, service_name, person_label, unit_price_cents, duration_minutes) VALUES
      (b, bk, sv_kids, 'Kids cut (under 12)', 'Person 1', 6000, 25), (b, bk, sv_kids, 'Kids cut (under 12)', 'Person 2', 6000, 25),
      (b, bk, sv_fade, 'Fade', 'Person 3', 10000, 35);
    INSERT INTO house_call_details (booking_id, business_id, address_line, suburb, town, access_notes, distance_km, distance_source,
        estimated_travel_cost_cents, estimated_other_cost_cents)
    VALUES (bk, b, '12 Example Street (fictional)', 'Orlando West', 'Soweto', 'Blue gate, ring twice.', 6.5, 'manual', 6000, 2000);
    UPDATE house_call_details SET latitude = -26.237800, longitude = 27.908900 WHERE booking_id = bk;   -- the customer's map pin (fictional address)
    INSERT INTO booking_events (business_id, booking_id, event, to_status, actor_kind, note) VALUES
      (b, bk, 'requested', 'requested', 'customer', 'Requested through the public booking page.');
    INSERT INTO booking_events (business_id, booking_id, event, from_status, to_status, actor_kind, actor_user_id) VALUES
      (b, bk, 'confirmed', 'requested', 'confirmed', 'staff', v_user);

    -- Tomorrow: a new request from the public page, waiting for confirmation
    INSERT INTO bookings (business_id, reference, customer_name, customer_phone, staff_id, branch_id, starts_at, ends_at, status,
        services_total_cents, total_cents, source, customer_note)
    VALUES (b, 'BK-' || upper(substr(md5(random()::text), 1, 8)), 'Lwazi M. (fictional)', '+27 00 000 0008', st_thato, br,
        ((d + 1) + time '09:30') AT TIME ZONE tz, ((d + 1) + time '10:05') AT TIME ZONE tz, 'requested', 9000, 9000, 'public', 'First visit.') RETURNING id INTO bk;
    INSERT INTO booking_items (business_id, booking_id, service_id, service_name, unit_price_cents, duration_minutes) VALUES
      (b, bk, sv_lineup, 'Line-up', 4000, 15), (b, bk, sv_beard, 'Beard trim', 5000, 20);
    INSERT INTO booking_events (business_id, booking_id, event, to_status, actor_kind, note) VALUES (b, bk, 'requested', 'requested', 'customer', 'Requested through the public booking page.');

    -- A booking being rescheduled: the barber proposed a new time, waiting for the customer
    INSERT INTO bookings (business_id, reference, customer_name, customer_phone, staff_id, branch_id, starts_at, ends_at, status,
        proposed_starts_at, proposed_ends_at, proposed_staff_id, proposed_by, proposal_note, services_total_cents, total_cents, source, created_by)
    VALUES (b, 'BK-' || upper(substr(md5(random()::text), 1, 8)), 'Sizwe K. (fictional)', '+27 00 000 0009', st_bongani, br,
        ((d + 1) + time '15:00') AT TIME ZONE tz, ((d + 1) + time '15:40') AT TIME ZONE tz, 'reschedule_proposed',
        ((d + 2) + time '15:00') AT TIME ZONE tz, ((d + 2) + time '15:40') AT TIME ZONE tz, st_bongani, 'business',
        'Bongani is at a training course tomorrow afternoon. Could we do the same time the day after?', 10000, 10000, 'staff', v_user) RETURNING id INTO bk;
    INSERT INTO booking_items (business_id, booking_id, service_id, service_name, unit_price_cents, duration_minutes) VALUES (b, bk, sv_fade, 'Fade', 10000, 40);
    INSERT INTO booking_events (business_id, booking_id, event, from_status, to_status, actor_kind, actor_user_id, note) VALUES
      (b, bk, 'confirmed', 'requested', 'confirmed', 'staff', v_user, NULL),
      (b, bk, 'reschedule_proposed', 'confirmed', 'reschedule_proposed', 'staff', v_user, 'Proposed the day after at 15:00.');

    -- Yesterday: completed in-shop visit with NO payment and NO debt recorded (payment mismatch to review)
    INSERT INTO bookings (business_id, reference, customer_name, staff_id, branch_id, starts_at, ends_at, status, services_total_cents, total_cents,
        source, confirmed_by, confirmed_at, completed_at, created_by)
    VALUES (b, 'BK-' || upper(substr(md5(random()::text), 1, 8)), 'Walk-in (fictional)', st_bongani, br,
        ((d - 1) + time '16:00') AT TIME ZONE tz, ((d - 1) + time '17:05') AT TIME ZONE tz, 'completed', 16000, 16000, 'staff', v_user, now(), now(), v_user) RETURNING id INTO bk;
    INSERT INTO booking_items (business_id, booking_id, service_id, service_name, unit_price_cents, duration_minutes) VALUES
      (b, bk, sv_combo, 'Haircut and beard combo', 12000, 50), (b, bk, sv_lineup, 'Line-up', 4000, 15);

    -- Yesterday: completed house call, paid by EFT with an unverified proof; actual trip costs recorded
    INSERT INTO bookings (business_id, reference, customer_id, customer_name, customer_phone, staff_id, branch_id, location_type, starts_at, ends_at, status,
        services_total_cents, travel_fee_cents, total_cents, source, confirmed_by, confirmed_at, completed_at, created_by)
    VALUES (b, 'BK-' || upper(substr(md5(random()::text), 1, 8)), c_mandla, 'Mandla Z. (fictional)', '+27 00 000 0004', st_ayanda, br, 'house_call',
        ((d - 1) + time '12:00') AT TIME ZONE tz, ((d - 1) + time '12:40') AT TIME ZONE tz, 'completed', 10000, 10000, 20000, 'staff', v_user, now(), now(), v_user)
        RETURNING id INTO bk_hc;
    INSERT INTO booking_items (business_id, booking_id, service_id, service_name, unit_price_cents, duration_minutes) VALUES (b, bk_hc, sv_fade, 'Fade', 10000, 40);
    INSERT INTO house_call_details (booking_id, business_id, address_line, suburb, town, distance_km, distance_source, estimated_travel_cost_cents, estimated_other_cost_cents)
    VALUES (bk_hc, b, '7 Sample Avenue (fictional)', 'Dube', 'Soweto', 4.0, 'manual', 5000, 2000);
    UPDATE house_call_details SET latitude = -26.242900, longitude = 27.896400 WHERE booking_id = bk_hc;
    INSERT INTO transactions (business_id, type, description, amount_cents, category, transaction_date, payment_method, payment_status, reference, notes, created_by, booking_id, branch_id)
    VALUES (b, 'income', 'House call — Fade + travel fee (EFT, proof received)', 20000, 'Services', d - 1, 'eft', 'awaiting_confirmation', 'POP-DEMO-002',
            'Fictional: proof of payment received; not yet seen in the bank account.', v_user, bk_hc, br) RETURNING id INTO t;
    INSERT INTO payment_proofs (business_id, transaction_id, booking_id, file_name, content_type, size_bytes, sha256, content, claimed_amount_cents, claimed_reference, payer_name, submitted_by, created_at)
    VALUES (b, t, bk_hc, 'proof-of-payment-demo.png', 'image/png', 67,
            encode(sha256(decode('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082', 'hex')), 'hex'),
            decode('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082', 'hex'),
            20000, 'POP-DEMO-002', 'Mandla Z. (fictional)', v_user, now() - interval '26 hours');
    INSERT INTO transactions (business_id, type, description, amount_cents, category, transaction_date, payment_method, reference, notes, created_by, booking_id, branch_id) VALUES
      (b, 'expense', 'Taxi to Dube and back (house call)', 6000, 'Transport', d - 1, 'cash', 'House-call cost', 'House-call cost', v_user, bk_hc, br),
      (b, 'expense', 'Disposable capes and wipes (house call)', 4000, 'Stock & supplies', d - 1, 'cash', 'House-call cost', 'House-call cost', v_user, bk_hc, br);

    -- Three days ago: a no-show
    INSERT INTO bookings (business_id, reference, customer_name, customer_phone, staff_id, branch_id, starts_at, ends_at, status, services_total_cents, total_cents, source, created_by)
    VALUES (b, 'BK-' || upper(substr(md5(random()::text), 1, 8)), 'Thabo L. (fictional)', '+27 00 000 0010', st_thato, br,
        ((d - 3) + time '09:00') AT TIME ZONE tz, ((d - 3) + time '09:30') AT TIME ZONE tz, 'no_show', 8000, 8000, 'staff', v_user);

    -- Tumi owed R200 and paid R50 (before the opening-balance date, so today's cash is unchanged): R150 principal is overdue.
    INSERT INTO receivables (business_id, customer_id, description, original_amount_cents, issue_date, due_date)
    VALUES (b, c_tumi, 'Haircut and dye on account', 20000, d - 50, d - 20) RETURNING id INTO r_tumi;
    INSERT INTO transactions (business_id, type, description, amount_cents, category, transaction_date, payment_method, source, created_by)
    VALUES (b, 'income', 'Payment from Tumi N. (fictional): Haircut and dye on account', 5000, 'Debt collection', d - 46, 'cash', 'receivable_payment', v_user) RETURNING id INTO t;
    INSERT INTO receivable_payments (business_id, receivable_id, transaction_id, amount_cents, payment_date) VALUES (b, r_tumi, t, 5000, d - 46);
    INSERT INTO receivable_reminders (business_id, receivable_id, channel, outcome, note, created_by, created_at) VALUES
      (b, r_sipho, 'whatsapp', 'sent', 'Friendly reminder sent', v_user, now() - interval '8 days'),
      (b, r_sipho, 'call', 'no_answer', NULL, v_user, now() - interval '5 days'),
      (b, r_sipho, 'call', 'no_answer', NULL, v_user, now() - interval '2 days');

    -- Yesterday's cash-up: counted R60.00 less than expected (for review — not an accusation)
    INSERT INTO shifts (business_id, branch_id, staff_user_id, opened_by, opened_at, opening_float_cents, closed_at, counted_cash_cents,
        expected_cash_cents, variance_cents, needs_review, status, close_note)
    VALUES (b, br, v_user, v_user, ((d - 1) + time '08:00') AT TIME ZONE tz, 50000, ((d - 1) + time '18:00') AT TIME ZONE tz, 44000,
        50000, -6000, TRUE, 'closed', 'Busy afternoon, did not recount.');

    -- Supplier changed bank details by message: recorded as UNVERIFIED (only last four digits are kept)
    INSERT INTO supplier_bank_details (business_id, supplier_id, bank_name, account_holder, account_last4, account_fingerprint, status,
        change_source, verification_method, verification_note, verified_by, verified_at, created_by, created_at)
    VALUES (b, s_supplies, 'Example Bank (fictional)', 'Gauteng Barber Supplies', '4821', 'seed-' || md5(random()::text), 'verified',
        'owner_entry', 'called_known_number', 'Confirmed on the number saved in the phone.', v_user, now() - interval '90 days', v_user, now() - interval '90 days');
    INSERT INTO supplier_bank_details (business_id, supplier_id, bank_name, account_holder, account_last4, account_fingerprint, status, change_source, created_by, created_at)
    VALUES (b, s_supplies, 'Other Bank (fictional)', 'G B Supplies', '9930', 'seed-' || md5(random()::text), 'unverified', 'supplier_message', v_user, now() - interval '4 days');

    -- Equipment is tracked separately from consumables and retail stock.
    INSERT INTO products (business_id, sku, name, kind, stock_class, unit_price_cents, unit_cost_cents, min_stock_qty, condition_note)
    VALUES (b, 'CLIPPER-01', 'Cordless clipper (demo)', 'product', 'equipment', 0, 180000, 0, 'Blade replaced recently'),
           (b, 'DISINF-1L', 'Disinfectant 1 L (demo)', 'product', 'consumable', 0, 6500, 2, NULL),
           (b, 'BLADES-10', 'Razor blades, pack of 10 (demo)', 'product', 'consumable', 0, 4500, 3, NULL);
    FOR pr IN SELECT id FROM products WHERE business_id = b AND sku IN ('CLIPPER-01','DISINF-1L','BLADES-10') LOOP
        INSERT INTO stock_movements (business_id, product_id, branch_id, movement_type, quantity_delta, reason, created_by, created_at)
        SELECT b, pr, br, 'received', CASE p.sku WHEN 'CLIPPER-01' THEN 2 WHEN 'DISINF-1L' THEN 2 ELSE 6 END, 'Opening stock (demo)', v_user, (d - 30)::timestamp + time '09:00'
        FROM products p WHERE p.id = pr;
        INSERT INTO inventory_levels (business_id, product_id, branch_id, quantity)
        SELECT b, pr, br, COALESCE(SUM(quantity_delta), 0) FROM stock_movements WHERE product_id = pr AND branch_id = br;
    END LOOP;
    UPDATE products SET stock_class = 'retail' WHERE business_id = b AND sku IN ('POMADE-100','BEARD-OIL-30','SHAMPOO-250');
    UPDATE products SET is_active = FALSE WHERE business_id = b AND sku = 'CUT-ADULT';   -- services now live in the service catalogue

    -- Public profile now links to booking
    UPDATE public_profiles SET products_services = E'Haircut R80\nFade R100\nBeard trim R50\nLine-up R40\nHaircut and beard combo R120\nKids cut R60\nHouse calls (travel fee R100)'
    WHERE business_id = b;

    -- Barber pay terms: commission, wage (chair rent is also supported)
    INSERT INTO staff_pay_terms (staff_id, business_id, mode, commission_percent, updated_by) VALUES (st_bongani, b, 'commission', 40, v_user), (st_ayanda, b, 'commission', 45, v_user);
    INSERT INTO staff_pay_terms (staff_id, business_id, mode, wage_weekly_cents, updated_by) VALUES (st_neo, b, 'wage', 90000, v_user);

    -- Visits copied in from the shop's paper appointment book (last 90 days): they feed the owner's insights and the barbers'
    -- statements. They carry no linked payments (the cash for them is in the takings already recorded), so they are marked
    -- source 'history' and payment-mismatch checks skip them. Busier on Fridays and Saturdays, as in most shops.
    FOR hk IN 1..420 LOOP
        hd := d - (1 + floor(random() * 89))::int;
        CONTINUE WHEN random() > (ARRAY[0.25, 0.45, 0.45, 0.5, 0.6, 0.95, 1.0])[extract(dow FROM hd)::int + 1];
        hh := (ARRAY[9, 10, 10, 11, 11, 12, 13, 14, 15, 15, 16, 16, 17, 17, 18])[1 + floor(random() * 15)::int];
        CONTINUE WHEN extract(dow FROM hd) = 0 AND hh >= 14;
        hs := (ARRAY[st_thato, st_bongani, st_bongani, st_ayanda, st_ayanda, st_neo])[1 + floor(random() * 6)::int];
        CONTINUE WHEN hs = st_neo AND hh < 14;
        hsv := (ARRAY[sv_cut, sv_cut, sv_fade, sv_fade, sv_fade, sv_beard, sv_lineup, sv_combo, sv_combo, sv_kids, sv_wash])[1 + floor(random() * 11)::int];
        hcust := 1 + floor(power(random(), 1.6) * 25)::int;
        hstatus := CASE WHEN random() < 0.05 THEN 'no_show' ELSE 'completed' END;
        hm := (floor(random() * 4) * 15)::int;
        INSERT INTO bookings (business_id, reference, customer_name, customer_phone, staff_id, branch_id, starts_at, ends_at, status, services_total_cents, total_cents,
            source, completed_at, created_by, internal_note)
        SELECT b, 'BK-' || upper(substr(md5(random()::text), 1, 8)), names[hcust] || ' (fictional)', '+27 00 000 1' || lpad(hcust::text, 3, '0'), hs, br,
               (hd + make_time(hh, hm, 0)) AT TIME ZONE tz,
               (hd + make_time(hh, hm, 0)) AT TIME ZONE tz + make_interval(mins => sv.duration_minutes),
               hstatus, sv.price_cents, sv.price_cents, 'history', CASE WHEN hstatus = 'completed' THEN (hd + time '19:00') AT TIME ZONE tz END, v_user, 'From the appointment book'
        FROM services sv WHERE sv.id = hsv
        RETURNING id INTO bk;
        INSERT INTO booking_items (business_id, booking_id, service_id, service_name, unit_price_cents, duration_minutes)
        SELECT b, bk, sv.id, sv.name, sv.price_cents, sv.duration_minutes FROM services sv WHERE sv.id = hsv;
    END LOOP;

    -- Today's walk-in queue
    INSERT INTO walkin_tickets (business_id, branch_id, ticket_date, number, customer_name, service_ids, services_summary, est_minutes, staff_id, status, joined_at, called_at, started_at, source, created_by)
    VALUES (b, br, d, 1, 'Thabo N. (fictional)', ARRAY[sv_fade], 'Fade', 40, st_bongani, 'in_chair', now() - interval '35 minutes', now() - interval '20 minutes', now() - interval '18 minutes', 'desk', v_user);
    INSERT INTO walkin_tickets (business_id, branch_id, ticket_date, number, customer_name, service_ids, services_summary, est_minutes, preferred_staff_id, status, joined_at, source, created_by) VALUES
      (b, br, d, 2, 'Lwazi M. (fictional)', ARRAY[sv_cut], 'Haircut', 30, NULL, 'waiting', now() - interval '22 minutes', 'desk', v_user),
      (b, br, d, 3, 'Kamo V. (fictional)', ARRAY[sv_lineup, sv_beard], 'Line-up, Beard trim', 35, st_ayanda, 'waiting', now() - interval '12 minutes', 'desk', v_user),
      (b, br, d, 4, 'Jabu C. (fictional)', ARRAY[sv_kids], 'Kids cut (under 12)', 25, NULL, 'waiting', now() - interval '4 minutes', 'desk', v_user);

    RAISE NOTICE 'Seeded demo business % for user %', b, v_user;
END $$;
